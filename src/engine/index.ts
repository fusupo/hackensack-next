// The engine: compiles specs and renders them with data. Pure TypeScript with
// no DOM, React or editor imports (PLAN.md principle 5); it must run in Node.
//
//   const program = compile('spinner', library)   // parse and compile once
//   const { output, errors } = program.render({ l: [1, 2, 3], cy: 25 })
//   toSvgString(output)

export { compile, isVariableName } from './compile.ts'
export type {
  CompiledComponent,
  CompiledEach,
  CompiledElement,
  CompiledGrid,
  CompiledInstance,
  CompiledNode,
  CompiledParam,
  Diagnostic,
  Program,
} from './compile.ts'
export { NODE_TYPES } from './nodes.ts'
export type { NodeTypeDef, ParamDef, ParamKind } from './nodes.ts'
export type { RenderOptions, RenderResult } from './render.ts'
export { Frame } from './scope.ts'
export type { FrameSource } from './scope.ts'
export { indexById, SPEC_FORMAT, SPEC_FORMAT_V2 } from './spec.ts'
export type {
  ComponentSpec,
  InputDecl,
  InputType,
  Library,
  NodeSpec,
  ParamValue,
} from './spec.ts'
export { toSvgString } from './svg.ts'
export type { SvgElement, SvgNode } from './svg.ts'
export { parseTransform } from './transform.ts'
export type { TransformStep } from './transform.ts'
