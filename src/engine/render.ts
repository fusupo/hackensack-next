// render(): walk a compiled component tree with a chain of scope frames and
// produce SVG nodes. Only evaluates; all parsing happened in compile().
//
// Scoping (PLAN.md, "Compound nodes"):
// - Within a component, a node sees what its ancestors expose: the component's
//   inputs, `each` bindings, and params a node opted to `expose`.
// - A component instance starts a fresh chain holding only the definition's
//   declared inputs. Caller variables are visible inside only when an input
//   is bound to them or declared `inherit`.

import type { CompiledComponent, CompiledNode, Diagnostic } from './compile.ts'
import { describe } from './expr.ts'
import { Frame } from './scope.ts'
import type { InputDecl } from './spec.ts'
import type { SvgNode } from './svg.ts'

export interface RenderResult {
  output: SvgNode[]
  /** Problems found while rendering, each reported once even if repeated by an `each`. */
  errors: Diagnostic[]
}

export interface RenderOptions {
  /**
   * Tag each element drawn inside an instance with `origin`, the path of
   * instance ids that drew it. Off by default; the output is otherwise
   * identical either way.
   */
  trackOrigins?: boolean
}

interface Context {
  component: string
  path: string[]
  errors: Map<string, Diagnostic>
  trackOrigins: boolean
}

const FAILED = Symbol('failed')

export function renderProgram(
  top: CompiledComponent | undefined,
  data: Readonly<Record<string, unknown>>,
  options: RenderOptions = {},
): RenderResult {
  const errors = new Map<string, Diagnostic>()
  if (!top?.root) return { output: [], errors: [] } // already reported by compile()

  const ctx: Context = {
    component: top.name,
    path: [],
    errors,
    trackOrigins: options.trackOrigins ?? false,
  }
  const vars = resolveInputs(
    top,
    (message, input) => report(ctx, { param: input, message }),
    (name) => (Object.hasOwn(data, name) ? { value: data[name] } : undefined),
    undefined,
  )
  const output = renderNode(
    top.root,
    new Frame(vars, undefined, { kind: 'inputs', component: top.name }),
    ctx,
  )
  return { output, errors: [...errors.values()] }
}

function renderNode(node: CompiledNode, frame: Frame, ctx: Context): SvgNode[] {
  switch (node.kind) {
    case 'element': {
      const attrs: Record<string, string> = {}
      const values = new Map<string, unknown>()
      const children: SvgNode[] = []
      for (const param of node.attrs) {
        const result = attempt(ctx, node.id, param.name, () =>
          param.evaluate(frame),
        )
        if (result === FAILED) continue
        if (result.text !== '') attrs[param.name] = result.text
        values.set(param.name, result.value)
      }
      if (node.content) {
        const content = node.content
        const result = attempt(ctx, node.id, content.name, () =>
          content.evaluate(frame),
        )
        if (result !== FAILED) {
          if (result.text !== '') children.push(result.text)
          values.set(content.name, result.value)
        }
      }
      let childFrame = frame
      if (node.expose.length > 0) {
        const exposed = new Map<string, unknown>()
        for (const { name, param } of node.expose) {
          if (values.has(param)) exposed.set(name, values.get(param))
        }
        childFrame = new Frame(exposed, frame, {
          kind: 'expose',
          component: ctx.component,
          node: node.id,
        })
      }
      for (const child of node.children)
        children.push(...renderNode(child, childFrame, ctx))
      return ctx.trackOrigins && ctx.path.length > 0
        ? [{ tag: node.tag, attrs, children, origin: ctx.path }]
        : [{ tag: node.tag, attrs, children }]
    }

    case 'each': {
      const evaluateList = node.list
      if (!evaluateList) return [] // reported by compile()
      const list = attempt(ctx, node.id, 'list', () => evaluateList(frame))
      if (list === FAILED) return []
      if (!Array.isArray(list)) {
        report(ctx, {
          node: node.id,
          param: 'list',
          message: `each needs a list, got ${describe(list)}`,
        })
        return []
      }
      const source = {
        kind: 'each',
        component: ctx.component,
        node: node.id,
      } as const
      return list.flatMap((item: unknown, index) => {
        const itemFrame = new Frame(
          new Map<string, unknown>([
            [node.as, item],
            [node.index, index],
          ]),
          frame,
          source,
        )
        return node.children.flatMap((child) =>
          renderNode(child, itemFrame, ctx),
        )
      })
    }

    case 'instance': {
      const target = node.target
      if (!target?.root) return [] // reported by compile()
      const vars = resolveInputs(
        target,
        (message, input) =>
          report(ctx, { node: node.id, param: input, message }),
        (name) => {
          const binding = node.bindings.get(name)
          if (!binding) return undefined
          const result = attempt(ctx, node.id, name, () =>
            binding.evaluate(frame),
          )
          return result === FAILED ? FAILED : { value: result.value }
        },
        frame,
      )
      const inner: Context = {
        component: target.name,
        path: [...ctx.path, node.id],
        errors: ctx.errors,
        trackOrigins: ctx.trackOrigins,
      }
      // A fresh chain: no parent frame, so undeclared caller variables are invisible.
      return renderNode(
        target.root,
        new Frame(vars, undefined, { kind: 'inputs', component: target.name }),
        inner,
      )
    }
  }
}

/**
 * Work out a component's input values. Order per input: the binding, then
 * (if `inherit`) the same name in the surroundings, then the default.
 * Inputs that can't be resolved, or whose value has the wrong type, are
 * reported and left out of the frame, so only expressions that use them fail.
 * A wrong-type value does not fall back to the default: the mistake stays
 * visible.
 */
function resolveInputs(
  component: CompiledComponent,
  reportProblem: (message: string, input: string) => void,
  bound: (name: string) => { value: unknown } | typeof FAILED | undefined,
  surroundings: Frame | undefined,
): Map<string, unknown> {
  const vars = new Map<string, unknown>()
  for (const [name, decl] of Object.entries(component.inputs)) {
    const binding = bound(name)
    if (binding === FAILED) continue // the binding's own error is already reported
    let value: unknown
    if (binding) value = binding.value
    else if (decl.inherit && surroundings?.has(name))
      value = surroundings.get(name)
    else if ('default' in decl) value = decl.default
    else {
      reportProblem(
        decl.inherit
          ? `input "${name}" isn't set, and there's no "${name}" in scope here to inherit`
          : `missing required input "${name}"`,
        name,
      )
      continue
    }
    const problem = typeProblem(decl, value)
    if (problem) {
      reportProblem(`input "${name}" ${problem}, so it was left unset`, name)
      continue
    }
    vars.set(name, value)
  }
  return vars
}

function typeProblem(decl: InputDecl, value: unknown): string | undefined {
  const ok = (() => {
    switch (decl.type ?? 'any') {
      case 'number':
        return typeof value === 'number'
      case 'string':
        return typeof value === 'string'
      case 'boolean':
        return typeof value === 'boolean'
      case 'list':
        return Array.isArray(value)
      case 'object':
        return (
          typeof value === 'object' && value !== null && !Array.isArray(value)
        )
      case 'any':
        return true
    }
  })()
  return ok
    ? undefined
    : `should be ${decl.type === 'list' ? 'a list' : `a ${decl.type}`}, got ${describe(value)}`
}

function attempt<T>(
  ctx: Context,
  node: string,
  param: string,
  fn: () => T,
): T | typeof FAILED {
  try {
    return fn()
  } catch (e) {
    report(ctx, {
      node,
      param,
      message: e instanceof Error ? e.message : String(e),
    })
    return FAILED
  }
}

function report(
  ctx: Context,
  problem: Omit<Diagnostic, 'component' | 'path'>,
): void {
  const diagnostic: Diagnostic = {
    component: ctx.component,
    ...problem,
    path: ctx.path,
  }
  const key = JSON.stringify([
    diagnostic.component,
    diagnostic.node,
    diagnostic.param,
    diagnostic.message,
    ctx.path,
  ])
  if (!ctx.errors.has(key)) ctx.errors.set(key, diagnostic)
}
