// compile(): turn a library of component specs into a Program. Every
// expression is parsed and compiled exactly once here (PLAN.md principle 4);
// render() only evaluates. Problems become diagnostics on the node/param they
// belong to instead of exceptions (principle 7).

import {
  compileExpr,
  constant,
  expectNumber,
  expectString,
  formatNumber,
} from './expr.ts'
import type { Evaluator } from './expr.ts'
import { NODE_TYPES } from './nodes.ts'
import type { ParamKind } from './nodes.ts'
import { renderProgram } from './render.ts'
import type { RenderResult } from './render.ts'
import type { Frame } from './scope.ts'
import { SPEC_FORMAT } from './spec.ts'
import type { ComponentSpec, InputDecl, Library, ParamValue } from './spec.ts'
import { compileTransform } from './transform.ts'

export interface Diagnostic {
  /** The definition the problem is in. */
  component: string
  node?: string
  param?: string
  message: string
  /**
   * Render-time problems only: the chain of instance node ids from the
   * top-level component down to the instance whose definition has the problem.
   * Empty when the problem is in the top-level component itself.
   */
  path?: string[]
}

export interface CompiledParam {
  name: string
  /** Throws on evaluation errors. `text` is the attribute text; `value` is what `expose` makes visible. */
  evaluate(scope: Frame): { text: string; value: unknown }
}

export interface CompiledElement {
  kind: 'element'
  id: string
  tag: string
  attrs: CompiledParam[]
  content?: CompiledParam
  expose: { name: string; param: string }[]
  children: CompiledNode[]
}

export interface CompiledEach {
  kind: 'each'
  id: string
  /** Absent when the list param was missing or didn't compile. */
  list?: Evaluator
  as: string
  index: string
  children: CompiledNode[]
}

export interface CompiledInstance {
  kind: 'instance'
  id: string
  ref: string
  /** Absent when the reference is missing or would create a cycle. */
  target?: CompiledComponent
  bindings: Map<string, CompiledParam>
}

export type CompiledNode = CompiledElement | CompiledEach | CompiledInstance

export interface CompiledComponent {
  name: string
  inputs: Readonly<Record<string, InputDecl>>
  /** Absent when the spec's root node couldn't be compiled. */
  root?: CompiledNode
}

export interface Program {
  /** Name of the top-level component. */
  readonly root: string
  /** Problems found while compiling. Render-time problems come with each render. */
  readonly errors: readonly Diagnostic[]
  /** Every definition reachable from the root, by name. */
  readonly components: ReadonlyMap<string, CompiledComponent>
  /** Render the top-level component with `data` as its inputs. */
  render(data?: Readonly<Record<string, unknown>>): RenderResult
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Compile the component `rootName` and every definition it uses, looked up in
 * `library`. Never throws for problems in the specs; see `Program.errors`.
 */
export function compile(rootName: string, library: Library): Program {
  const errors: Diagnostic[] = []
  const components = new Map<string, CompiledComponent>()
  const inProgress: string[] = [] // definitions currently being compiled, for cycle detection

  function load(name: string): CompiledComponent | undefined {
    const done = components.get(name)
    if (done) return done
    const spec = library[name]
    if (!spec) return undefined
    const component: CompiledComponent = { name, inputs: spec.inputs ?? {} }
    components.set(name, component)
    inProgress.push(name)
    component.root = compileComponentTree(name, spec)
    inProgress.pop()
    return component
  }

  function compileComponentTree(
    component: string,
    spec: ComponentSpec,
  ): CompiledNode | undefined {
    const report = (message: string, node?: string, param?: string) =>
      errors.push({
        component,
        message,
        ...(node && { node }),
        ...(param && { param }),
      })

    if (spec.format !== SPEC_FORMAT) {
      report(
        `unknown spec format "${String(spec.format)}" (expected "${SPEC_FORMAT}")`,
      )
    }
    for (const [name, decl] of Object.entries(spec.inputs ?? {})) {
      if (!IDENTIFIER.test(name))
        report(`input name "${name}" isn't a valid variable name`)
      if (
        decl.type === 'string' &&
        decl.default !== undefined &&
        typeof decl.default !== 'string'
      ) {
        report(`default for input "${name}" should be text`)
      }
    }
    const nodes = spec.nodes ?? {}
    const used = new Set<string>()

    const compileNode = (id: string): CompiledNode | undefined => {
      const node = nodes[id]
      if (!node) {
        report(`node "${id}" doesn't exist`)
        return undefined
      }
      if (used.has(id)) {
        report(
          'node is used in more than one place; a node can only have one parent',
          id,
        )
        return undefined
      }
      used.add(id)
      const def = NODE_TYPES[node.type]
      if (!def) {
        report(`unknown node type "${node.type}"`, id)
        return undefined
      }
      const childIds = node.children ?? []
      if (def.children === 'none' && childIds.length > 0) {
        report(`a ${node.type} node can't have children; they are ignored`, id)
      }
      const children = (): CompiledNode[] =>
        def.children === 'none'
          ? []
          : childIds
              .map(compileNode)
              .filter((c): c is CompiledNode => c !== undefined)
      const params = node.params ?? {}
      const param = (
        name: string,
        kind: ParamKind,
        value: ParamValue,
      ): CompiledParam | undefined => {
        try {
          return { name, evaluate: compileParam(kind, value) }
        } catch (e) {
          report(message(e), id, name)
          return undefined
        }
      }

      if (node.type === 'each') {
        for (const name of Object.keys(params)) {
          if (!(name in def.params))
            report(`unknown param "${name}" for each`, id, name)
        }
        let list: Evaluator | undefined
        if (params.list === undefined) {
          report('each needs a list to repeat over', id, 'list')
        } else {
          const compiled = param('list', 'expr', params.list)
          if (compiled) list = (scope) => compiled.evaluate(scope).value
        }
        const bindingName = (key: 'as' | 'index', fallback: string): string => {
          const value = params[key]
          if (value === undefined) return fallback
          if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
            report(`"${String(value)}" isn't a valid variable name`, id, key)
            return fallback
          }
          return value
        }
        return {
          kind: 'each',
          id,
          ...(list && { list }),
          as: bindingName('as', 'd'),
          index: bindingName('index', 'i'),
          children: children(),
        }
      }

      if (node.type === 'component') {
        const instance: CompiledInstance = {
          kind: 'instance',
          id,
          ref: node.ref ?? '',
          bindings: new Map(),
        }
        if (!node.ref) {
          report('component node has no "ref" naming its definition', id)
          return instance
        }
        if (inProgress.includes(node.ref)) {
          const cycle = [
            ...inProgress.slice(inProgress.indexOf(node.ref)),
            node.ref,
          ].join(' → ')
          report(`component cycle: ${cycle}`, id)
          return instance
        }
        const target = load(node.ref)
        if (!target) {
          report(`no component named "${node.ref}" in the library`, id)
          return instance
        }
        instance.target = target
        for (const [name, value] of Object.entries(params)) {
          const decl = target.inputs[name]
          if (!decl) {
            report(`${node.ref} has no input named "${name}"`, id, name)
            continue
          }
          const compiled = param(name, bindingKind(decl), value)
          if (compiled) instance.bindings.set(name, compiled)
        }
        return instance
      }

      // An SVG element.
      const element: CompiledElement = {
        kind: 'element',
        id,
        tag: def.tag!,
        attrs: [],
        expose: [],
        children: [],
      }
      for (const [name, value] of Object.entries(params)) {
        const paramDef = def.params[name]
        if (!paramDef) {
          report(`unknown param "${name}" for ${node.type}`, id, name)
          continue
        }
        const compiled = param(name, paramDef.kind, value)
        if (!compiled) continue
        if (name === def.contentParam) element.content = compiled
        else element.attrs.push(compiled)
      }
      for (const [varName, paramName] of Object.entries(node.expose ?? {})) {
        if (!IDENTIFIER.test(varName))
          report(`"${varName}" isn't a valid variable name`, id)
        else if (!(paramName in params))
          report(`can't expose "${paramName}": this node doesn't set it`, id)
        else element.expose.push({ name: varName, param: paramName })
      }
      element.children = children()
      return element
    }

    if (!(spec.root in nodes)) {
      report(`root node "${spec.root}" doesn't exist`)
      return undefined
    }
    const root = compileNode(spec.root)
    for (const id of Object.keys(nodes)) {
      if (!used.has(id))
        report('node is not connected to the root and is not rendered', id)
    }
    return root
  }

  const top = load(rootName)
  if (!top)
    errors.push({
      component: rootName,
      message: `no component named "${rootName}" in the library`,
    })

  return {
    root: rootName,
    errors,
    components,
    render: (data = {}) => renderProgram(top, data),
  }
}

/** How an instance's binding for an input is read, from the input's declared type. */
function bindingKind(decl: InputDecl): ParamKind {
  if (decl.type === 'string') return 'string'
  if (decl.type === 'number') return 'number'
  return 'expr'
}

/**
 * Compile one param value according to its kind. Throws (with a readable
 * message) if it can't be compiled; see ParamKind for the rules.
 */
function compileParam(
  kind: ParamKind,
  raw: ParamValue,
): CompiledParam['evaluate'] {
  const isExpression = typeof raw === 'string' && raw.startsWith('=')
  const source =
    typeof raw === 'string' ? (isExpression ? raw.slice(1) : raw).trim() : ''

  switch (kind) {
    case 'number': {
      if (typeof raw === 'boolean') throw new Error('expected a number')
      const evaluate =
        typeof raw === 'number' ? constant(raw) : compileExpr(source)
      return (scope) => {
        const n = expectNumber(evaluate(scope))
        return { text: formatNumber(n), value: n }
      }
    }
    case 'length': {
      if (typeof raw === 'boolean') throw new Error('expected a length')
      // A trailing % or px is a unit, not part of the expression (math.js reads 50% as 0.5).
      let expr = String(raw)
      let unit = ''
      if (typeof raw === 'string') {
        const match = /^(.*?)\s*(%|px)?$/s.exec(source)
        expr = match?.[1] ?? ''
        unit = match?.[2] ?? ''
      }
      if (!expr) throw new Error('expected a length')
      const evaluate = compileExpr(expr)
      return (scope) => {
        const n = expectNumber(evaluate(scope))
        const text = formatNumber(n) + unit
        return { text, value: unit === '%' ? text : n }
      }
    }
    case 'color':
    case 'string': {
      if (isExpression) {
        const evaluate = compileExpr(source)
        return (scope) => {
          const text = expectString(evaluate(scope))
          return { text, value: text }
        }
      }
      const text = String(raw)
      return () => ({ text, value: text })
    }
    case 'transform': {
      if (typeof raw !== 'string')
        throw new Error(
          'expected a transform like "translate(10, 20) rotate(45)"',
        )
      const evaluate = compileTransform(source)
      return (scope) => {
        const text = evaluate(scope)
        return { text, value: text }
      }
    }
    case 'expr': {
      const evaluate =
        typeof raw === 'string' ? compileExpr(source) : constant(raw)
      return (scope) => ({ text: '', value: evaluate(scope) })
    }
    case 'name':
      throw new Error('name params are handled by their node type')
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
