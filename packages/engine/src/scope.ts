// Scopes as linked frames (PLAN.md principle 3). Each frame holds a few
// variables and points at its parent; lookup walks up the chain. Nothing is
// ever copied down the tree.

/** Where a frame's variables come from. Used by the editor's scope panel (M3). */
export interface FrameSource {
  kind: 'inputs' | 'each' | 'grid' | 'vars'
  component: string
  /** The node that opened the frame (absent for a component's inputs). */
  node?: string
}

/**
 * A scope frame. It also implements the Map-like interface math.js accepts as
 * an evaluation scope (get/has/set/keys), so expressions read variables
 * straight from the chain.
 */
export class Frame {
  readonly vars: ReadonlyMap<string, unknown>
  readonly parent: Frame | undefined
  readonly source: FrameSource

  constructor(
    vars: ReadonlyMap<string, unknown>,
    parent: Frame | undefined,
    source: FrameSource,
  ) {
    this.vars = vars
    this.parent = parent
    this.source = source
  }

  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false)
  }

  get(name: string): unknown {
    return this.vars.has(name) ? this.vars.get(name) : this.parent?.get(name)
  }

  /** Expressions may not assign variables. */
  set(name: string): never {
    throw new Error(
      `expressions can't assign variables (tried to set "${name}")`,
    )
  }

  keys(): IterableIterator<string> {
    const names = new Set<string>(this.parent ? this.parent.keys() : [])
    for (const name of this.vars.keys()) names.add(name)
    return names.values()
  }

  /** Frames from this one up to the outermost, nearest first. */
  chain(): Frame[] {
    return [this, ...(this.parent?.chain() ?? [])]
  }
}
