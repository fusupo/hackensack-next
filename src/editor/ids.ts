// Definition ids: short random strings that stay with a component for life,
// so instances keep pointing at it when it is renamed (#3).

/** Fills `n` random bytes. Injectable so tests can make ids predictable. */
export type RandomBytes = (n: number) => Uint8Array

export const defaultRandom: RandomBytes = (n) =>
  globalThis.crypto.getRandomValues(new Uint8Array(n))

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** A new 8-hex-character id that isn't in `taken`. */
export function newId(
  taken: Iterable<string>,
  random: RandomBytes = defaultRandom,
): string {
  const used = new Set(taken)
  for (;;) {
    const id = hex(random(4))
    if (!used.has(id)) return id
  }
}

/** The ids the definitions in a library already use. */
export function idsIn(library: Readonly<Record<string, { id?: unknown }>>) {
  return Object.values(library)
    .map((spec) => spec.id)
    .filter((id): id is string => typeof id === 'string' && id !== '')
}
