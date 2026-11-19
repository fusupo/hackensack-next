// The Sample data pane's text. It keeps the user's own text while they type
// (an invalid draft included), and follows the data when it changes under
// it: another component's data shown, or an undo or redo.

export interface DataText {
  /** Which data the text is for (`<project>/<component>`). */
  key: string
  text: string
  /** Why the text isn't usable data yet, if it isn't. */
  error?: string
  /** The data the text was last in step with, pretty-printed. */
  synced: string
}

export const prettyData = (data: unknown) => JSON.stringify(data, null, 2)

/**
 * The text to show for `sample` under `key`: `state` while it still matches
 * the data, otherwise the data pretty-printed. Serialized text is compared,
 * not objects, because a component with no sample file gets a fresh defaults
 * object whenever the library changes, and that mustn't wipe a draft.
 */
export function syncDataText(
  state: DataText,
  key: string,
  sample: unknown,
): DataText {
  const pretty = prettyData(sample)
  if (state.key === key && state.synced === pretty) return state
  return { key, text: pretty, synced: pretty }
}
