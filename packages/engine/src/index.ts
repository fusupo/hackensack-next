// The engine: compiles specs and renders them with data. Pure TypeScript with
// no DOM, React or editor imports (PLAN.md principle 5); it must run in Node.
//
//   const program = compile('spinner', library)   // parse and compile once
//   const { output, errors } = program.render({ l: [1, 2, 3], cy: 25 })
//   toSvgString(output)

export { BUNDLE_FORMAT, bundle, readBundle, withDefaults } from './bundle.ts'
export type { Bundle, BundleProblem } from './bundle.ts'
export { compile, isVariableName, readVars } from './compile.ts'
export type {
  CompiledComponent,
  CompiledEach,
  CompiledElement,
  CompiledGrid,
  CompiledInstance,
  CompiledNode,
  CompiledParam,
  CompiledVars,
  Diagnostic,
  Program,
  VarsEntry,
} from './compile.ts'
export { exprNames, isReservedName, MATH_CONSTANTS } from './expr.ts'
export { eachNames, gridNames, paramNames, varsNames } from './names.ts'
export { childProblem, NODE_TYPES, takesChildren } from './nodes.ts'
export type { NodeTypeDef, ParamDef, ParamKind } from './nodes.ts'
export type { RenderOptions, RenderResult } from './render.ts'
export { Frame } from './scope.ts'
export type { FrameSource } from './scope.ts'
export { indexById, OLDER_SPEC_FORMATS, SPEC_FORMAT } from './spec.ts'
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
