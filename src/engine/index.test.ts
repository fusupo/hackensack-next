import { describe, expect, it } from 'vitest'
import { SPEC_FORMAT } from './index.ts'

describe('engine', () => {
  it('declares the spec format it handles', () => {
    expect(SPEC_FORMAT).toBe('hackensack/2')
  })
})
