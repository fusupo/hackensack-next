// <hackensack-picture> (#16): a picture from a bundle, with no script of
// the page's own.
//
//   <hackensack-picture src="weather.bundle.json" data='{"precip": 40}'>
//   </hackensack-picture>
//
//   <hackensack-picture>
//     <script type="application/json">{ "format": "hackensack/bundle/1", … }</script>
//     <script type="application/json" data-hackensack="data">{ "precip": 40 }</script>
//   </hackensack-picture>
//
// The bundle comes from `src` (fetched, relative to the page) or else from
// an inline JSON script. The data comes from the `data` attribute or else an
// inline JSON script marked data-hackensack="data", and is laid over the
// bundle's default data. Problems show in a note inside the element; nothing
// is thrown. The picture is drawn in an open shadow root, so the inline
// scripts stay where they are.

import { mountWith } from './mount.ts'
import type { InternalHandle } from './mount.ts'
import type { Problem } from './core.ts'

const DATA_SCRIPT = 'script[type="application/json"][data-hackensack="data"]'
const BUNDLE_SCRIPT =
  'script[type="application/json"]:not([data-hackensack="data"])'

// In Node (the package imported outside a page) there is no HTMLElement;
// the class is still defined, only never registered.
const Base: typeof HTMLElement =
  typeof HTMLElement === 'undefined'
    ? (class {} as unknown as typeof HTMLElement)
    : HTMLElement

export class HackensackPicture extends Base {
  static observedAttributes = ['src', 'data']

  #container: HTMLElement | undefined
  #handle: InternalHandle | undefined
  #bundleProblems: Problem[] = []
  /** Bumped by every load, so a slow fetch for an old `src` is dropped. */
  #loading = 0

  connectedCallback() {
    if (!this.#container) {
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = ':host { display: block; position: relative; }'
      this.#container = document.createElement('div')
      root.replaceChildren(style, this.#container)
    }
    void this.#load()
  }

  attributeChangedCallback(
    name: string,
    before: string | null,
    after: string | null,
  ) {
    if (!this.isConnected || !this.#container || before === after) return
    if (name === 'src') void this.#load()
    else this.#redraw()
  }

  /** The data given to the picture (the attribute's, else the inline script's). */
  get data(): Record<string, unknown> | undefined {
    return this.#readData().data
  }

  /** Sets the `data` attribute, which redraws the picture. */
  set data(value: Record<string, unknown> | undefined) {
    if (value === undefined) this.removeAttribute('data')
    else this.setAttribute('data', JSON.stringify(value))
  }

  /** The problems of the last draw, the bundle's loading included. */
  get errors(): Problem[] {
    return this.#handle ? this.#handle.errors : [...this.#bundleProblems]
  }

  async #load() {
    const loading = ++this.#loading
    const { bundle, problems } = await this.#readBundle()
    if (loading !== this.#loading || !this.#container) return
    this.#bundleProblems = problems
    const { data, problems: dataProblems } = this.#readData()
    this.#handle = mountWith(this.#container, bundle, data, [
      ...problems,
      ...dataProblems,
    ])
    this.dispatchEvent(new Event('hackensack-render'))
  }

  #redraw() {
    if (!this.#handle) return
    const { data, problems } = this.#readData()
    this.#handle.updateWith(data, [...this.#bundleProblems, ...problems])
    this.dispatchEvent(new Event('hackensack-render'))
  }

  async #readBundle(): Promise<{ bundle: unknown; problems: Problem[] }> {
    const src = this.getAttribute('src')
    if (src !== null) {
      let url = src
      try {
        url = new URL(src, document.baseURI).href
        const response = await fetch(url)
        if (!response.ok) {
          return failed(
            `Can't load the bundle ${src}: ${response.status} ${response.statusText}`.trim(),
          )
        }
        const text = await response.text()
        try {
          return { bundle: JSON.parse(text) as unknown, problems: [] }
        } catch (error) {
          return failed(`The bundle ${src} is not JSON: ${messageOf(error)}`)
        }
      } catch (error) {
        return failed(`Can't load the bundle ${src}: ${messageOf(error)}`)
      }
    }
    const script = this.querySelector(BUNDLE_SCRIPT)
    if (script === null) {
      return failed(
        'No bundle: give the element a src or an inline JSON script.',
      )
    }
    try {
      return {
        bundle: JSON.parse(script.textContent ?? '') as unknown,
        problems: [],
      }
    } catch (error) {
      return failed(`The inline bundle is not JSON: ${messageOf(error)}`)
    }
  }

  #readData(): {
    data: Record<string, unknown> | undefined
    problems: Problem[]
  } {
    const attribute = this.getAttribute('data')
    const script = attribute === null ? this.querySelector(DATA_SCRIPT) : null
    const text = attribute ?? script?.textContent ?? null
    if (text === null || text.trim() === '')
      return { data: undefined, problems: [] }
    const where = attribute !== null ? 'The data attribute' : 'The inline data'
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      return {
        data: undefined,
        problems: [problem(`${where} is not JSON: ${messageOf(error)}`)],
      }
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {
        data: undefined,
        problems: [problem(`${where} must be a JSON object.`)],
      }
    }
    return { data: value as Record<string, unknown>, problems: [] }
  }
}

const problem = (message: string): Problem => ({ source: 'bundle', message })

function failed(message: string): { bundle: unknown; problems: Problem[] } {
  return { bundle: undefined, problems: [problem(message)] }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Registers <hackensack-picture> once, in a page. */
export function defineElement(name = 'hackensack-picture') {
  if (typeof customElements === 'undefined') return
  if (!customElements.get(name)) customElements.define(name, HackensackPicture)
}
