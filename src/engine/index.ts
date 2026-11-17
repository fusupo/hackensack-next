// The engine: compiles specs and renders them with data. Pure TypeScript with
// no DOM, React or editor imports (PLAN.md principle 5); it must run in Node.
// M1 adds the spec types, compile() and render().

/** Identifies the spec format this engine reads and writes (PLAN.md, "Spec format v2"). */
export const SPEC_FORMAT = 'hackensack/2'
