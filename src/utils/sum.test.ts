import { describe, it, expect } from 'vitest'
import { sum } from './sum'

describe('sum utility', () => {
  it('adds two positive numbers correctly', () => {
    expect(sum(1, 2)).toBe(3)
  })

  it('handles zero', () => {
    expect(sum(0, 5)).toBe(5)
  })

  it('handles negative numbers', () => {
    expect(sum(-1, 1)).toBe(0)
  })
})
