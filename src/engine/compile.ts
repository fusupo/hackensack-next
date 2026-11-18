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
import type { RenderOptions, RenderResult } from './render.ts'
import type { Frame } from './scope.ts'
import { indexById, SPEC_FORMAT, SPEC_FORMAT_V2 } from './spec.ts'
import type { ComponentSpec, InputDecl, Library, ParamValue } from './spec.ts'
import { compileHoles, compilePoints } from './pathdata.ts'
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
  /** The id of the definition, as written in the spec. */
  ref: string
  /** Absent when the reference is missing or would create a cycle. */
  target?: CompiledComponent
  bindings: Map<string, CompiledParam>
}

export interface CompiledGrid {
  kind: 'grid'
  id: string
  /** Absent when `count` is missing or a param didn't compile: the grid draws nothing. */
  layout?: {
    count: CompiledParam
    columns: CompiledParam
    spacing: CompiledParam
    /** Absent when unset: rows use `spacing`. */
    rowSpacing?: CompiledParam
  }
  /** The variable names a cell binds: its column, its row, and its index. */
  col: string
  row: string
  index: string
  children: CompiledNode[]
}

export type CompiledNode =
  CompiledElement | CompiledEach | CompiledGrid | CompiledInstance

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
  /**
   * Render the top-level component with `data` as its inputs. With
   * `trackOrigins`, elements drawn inside instances carry an `origin`.
   */
  render(
    data?: Readonly<Record<string, unknown>>,
    options?: RenderOptions,
  ): RenderResult
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
  const byId = indexById(library)

  function load(name: string): CompiledComponent | undefined {
    const done = components.get(name)
    if (done) return done
    if (!Object.hasOwn(library, name)) return undefined
    const spec = library[name]!
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

    if ((spec.format as string) === SPEC_FORMAT_V2) {
      report(
        `"${SPEC_FORMAT_V2}" is an older spec format whose refs are names; open it in the editor to upgrade it to "${SPEC_FORMAT}"`,
      )
    } else if (spec.format !== SPEC_FORMAT) {
      report(
        `unknown spec format "${String(spec.format)}" (expected "${SPEC_FORMAT}")`,
      )
    }
    const id: unknown = spec.id
    if (typeof id !== 'string' || id === '') {
      report('component has no "id"; instances can\'t refer to it')
    } else {
      const others = (byId.get(id) ?? []).filter((n) => n !== component)
      if (others.length > 0)
        report(`id "${id}" is also used by ${others.join(', ')}`)
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
        // Each name falls back to its own default on its own.
        const bindingName = (key: 'as' | 'index', fallback: string): string => {
          const result = readName(params[key])
          if ('problem' in result) {
            report(result.problem, id, key)
            return fallback
          }
          return result.name ?? fallback
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

      if (node.type === 'grid') {
        for (const name of Object.keys(params)) {
          if (!Object.hasOwn(def.params, name))
            report(`unknown param "${name}" for grid`, id, name)
        }
        let broken = false
        if (params.count === undefined) {
          report('grid needs a count to repeat over', id, 'count')
          broken = true
        }
        // A param that's unset takes the registry's default, if it has one.
        const number = (name: string): CompiledParam | undefined => {
          const value = params[name] ?? def.params[name]?.default
          if (value === undefined) return undefined
          const compiled = param(name, 'number', value)
          if (!compiled) broken = true
          return compiled
        }
        const count = number('count')
        const columns = number('columns')
        const spacing = number('spacing')
        const rowSpacing = number('rowSpacing')

        // The three names are checked together: if any is invalid, or two are
        // the same, all three fall back to their defaults. (The editor's scope
        // panel mirrors this rule.)
        const keys = ['col', 'row', 'index'] as const
        const defaults = keys.map((key) => String(def.params[key]?.default))
        let invalid = false
        const chosen = keys.map((key, i) => {
          const result = readName(params[key])
          if ('problem' in result) {
            report(result.problem, id, key)
            invalid = true
            return defaults[i]!
          }
          return result.name ?? defaults[i]!
        })
        let names = chosen
        if (invalid) names = defaults
        else if (new Set(chosen).size < chosen.length) {
          report(
            `a grid's column, row and index names must differ (got ${chosen.join(', ')}); using ${defaults.join(', ')}`,
            id,
          )
          names = defaults
        }
        return {
          kind: 'grid',
          id,
          ...(!broken &&
            count &&
            columns &&
            spacing && {
              layout: {
                count,
                columns,
                spacing,
                ...(rowSpacing && { rowSpacing }),
              },
            }),
          col: names[0]!,
          row: names[1]!,
          index: names[2]!,
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
          report('component node has no "ref" choosing its definition', id)
          return instance
        }
        const names = byId.get(node.ref) ?? []
        if (names.length === 0) {
          report(`no component with id "${node.ref}" in the library`, id)
          return instance
        }
        if (names.length > 1) {
          report(
            `id "${node.ref}" is used by more than one component (${names.join(', ')})`,
            id,
          )
          return instance
        }
        const targetName = names[0]!
        if (inProgress.includes(targetName)) {
          const cycle = [
            ...inProgress.slice(inProgress.indexOf(targetName)),
            targetName,
          ].join(' → ')
          report(`component cycle: ${cycle}`, id)
          return instance
        }
        const target = load(targetName)!
        instance.target = target
        for (const [name, value] of Object.entries(params)) {
          const decl = Object.hasOwn(target.inputs, name)
            ? target.inputs[name]
            : undefined
          if (!decl) {
            report(`${target.name} has no input named "${name}"`, id, name)
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
    render: (data = {}, options) => renderProgram(top, data, options),
  }
}

/**
 * Read a `name` param (a variable a node binds, like `each`'s `as`): the name
 * when it's set and valid, nothing when it's unset, or the problem.
 */
function readName(
  value: ParamValue | undefined,
): { name?: string } | { problem: string } {
  if (value === undefined) return {}
  if (typeof value !== 'string' || !IDENTIFIER.test(value))
    return { problem: `"${String(value)}" isn't a valid variable name` }
  return { name: value }
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
    case 'path': {
      if (typeof raw !== 'string')
        throw new Error('expected path data like "M 0 0 L 10 10 Z"')
      // `=`: one expression giving text, as for string params.
      let evaluate: (scope: Frame) => string
      if (isExpression) {
        const whole = compileExpr(source)
        evaluate = (scope) => expectString(whole(scope))
      } else evaluate = compileHoles(source)
      return (scope) => {
        const text = evaluate(scope)
        return { text, value: text }
      }
    }
    case 'points': {
      if (typeof raw !== 'string')
        throw new Error(
          'expected a list of [x, y] pairs, or points like "0,0 10,0 5,8"',
        )
      return compilePoints(source, isExpression)
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
