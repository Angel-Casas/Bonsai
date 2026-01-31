/**
 * Tests for search utilities
 *
 * Covers:
 * - Case-insensitive substring matching
 * - Branch title matching
 * - Message content matching
 * - Stable ordering (by createdAt asc, then id)
 * - Edge cases (empty query, no results, special characters)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchMessages, getMatchSnippet, debounce } from './searchUtils'
import type { Message } from '@/db/types'

// Helper to create test messages
function createMessage(overrides: Partial<Message> & { id: string; content: string }): Message {
  return {
    conversationId: 'conv-1',
    parentId: null,
    role: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('searchMessages', () => {
  describe('basic matching', () => {
    it('returns empty array for empty query', () => {
      const messages = [createMessage({ id: '1', content: 'Hello world' })]
      expect(searchMessages(messages, '')).toEqual([])
    })

    it('returns empty array for whitespace-only query', () => {
      const messages = [createMessage({ id: '1', content: 'Hello world' })]
      expect(searchMessages(messages, '   ')).toEqual([])
    })

    it('returns empty array when no matches found', () => {
      const messages = [createMessage({ id: '1', content: 'Hello world' })]
      expect(searchMessages(messages, 'xyz')).toEqual([])
    })

    it('matches message content (substring)', () => {
      const messages = [createMessage({ id: '1', content: 'Hello world' })]
      const results = searchMessages(messages, 'world')

      expect(results).toHaveLength(1)
      expect(results[0]!.matchType).toBe('content')
      expect(results[0]!.message.id).toBe('1')
      expect(results[0]!.matchStart).toBe(6)
      expect(results[0]!.matchEnd).toBe(11)
    })

    it('matches branch titles', () => {
      const messages = [
        createMessage({ id: '1', content: 'Some content', branchTitle: 'Marketing Plan' }),
      ]
      const results = searchMessages(messages, 'Marketing')

      expect(results).toHaveLength(1)
      expect(results[0]!.matchType).toBe('branchTitle')
      expect(results[0]!.matchedText).toBe('Marketing Plan')
    })

    it('returns two results when message matches in both branchTitle and content', () => {
      const messages = [
        createMessage({
          id: '1',
          content: 'Let me explain the marketing strategy',
          branchTitle: 'Marketing Plan',
        }),
      ]
      const results = searchMessages(messages, 'marketing')

      expect(results).toHaveLength(2)
      expect(results.find((r) => r.matchType === 'branchTitle')).toBeDefined()
      expect(results.find((r) => r.matchType === 'content')).toBeDefined()
    })
  })

  describe('case-insensitivity', () => {
    it('matches regardless of case in query', () => {
      const messages = [createMessage({ id: '1', content: 'Hello World' })]

      expect(searchMessages(messages, 'hello')).toHaveLength(1)
      expect(searchMessages(messages, 'HELLO')).toHaveLength(1)
      expect(searchMessages(messages, 'HeLLo')).toHaveLength(1)
    })

    it('matches regardless of case in content', () => {
      const messages = [createMessage({ id: '1', content: 'HELLO WORLD' })]

      expect(searchMessages(messages, 'hello')).toHaveLength(1)
      expect(searchMessages(messages, 'world')).toHaveLength(1)
    })

    it('matches case-insensitively in branch titles', () => {
      const messages = [
        createMessage({ id: '1', content: 'x', branchTitle: 'MARKETING' }),
      ]

      expect(searchMessages(messages, 'marketing')).toHaveLength(1)
      expect(searchMessages(messages, 'MARKETING')).toHaveLength(1)
    })
  })

  describe('ordering', () => {
    it('orders results by createdAt ascending (older first)', () => {
      const messages = [
        createMessage({ id: '2', content: 'Hello second', createdAt: '2026-01-02T00:00:00Z' }),
        createMessage({ id: '1', content: 'Hello first', createdAt: '2026-01-01T00:00:00Z' }),
        createMessage({ id: '3', content: 'Hello third', createdAt: '2026-01-03T00:00:00Z' }),
      ]
      const results = searchMessages(messages, 'Hello')

      expect(results.map((r) => r.message.id)).toEqual(['1', '2', '3'])
    })

    it('uses id as tiebreaker for same createdAt (stable ordering)', () => {
      const sameTime = '2026-01-01T00:00:00Z'
      const messages = [
        createMessage({ id: 'bbb', content: 'Hello B', createdAt: sameTime }),
        createMessage({ id: 'aaa', content: 'Hello A', createdAt: sameTime }),
        createMessage({ id: 'ccc', content: 'Hello C', createdAt: sameTime }),
      ]
      const results = searchMessages(messages, 'Hello')

      expect(results.map((r) => r.message.id)).toEqual(['aaa', 'bbb', 'ccc'])
    })

    it('maintains stable ordering across multiple runs', () => {
      const messages = [
        createMessage({ id: '1', content: 'test', createdAt: '2026-01-01T00:00:00Z' }),
        createMessage({ id: '2', content: 'test', createdAt: '2026-01-01T00:00:00Z' }),
      ]

      // Run multiple times to verify stability
      for (let i = 0; i < 5; i++) {
        const results = searchMessages(messages, 'test')
        expect(results.map((r) => r.message.id)).toEqual(['1', '2'])
      }
    })
  })

  describe('limit option', () => {
    it('respects limit option', () => {
      const messages = Array.from({ length: 100 }, (_, i) =>
        createMessage({
          id: String(i).padStart(3, '0'),
          content: 'test message',
          createdAt: new Date(2026, 0, 1 + i).toISOString(),
        })
      )
      const results = searchMessages(messages, 'test', { limit: 10 })

      expect(results).toHaveLength(10)
      // Should be the first 10 by date
      expect(results[0]!.message.id).toBe('000')
      expect(results[9]!.message.id).toBe('009')
    })

    it('defaults to limit of 50', () => {
      const messages = Array.from({ length: 100 }, (_, i) =>
        createMessage({
          id: String(i).padStart(3, '0'),
          content: 'test message',
          createdAt: new Date(2026, 0, 1 + i).toISOString(),
        })
      )
      const results = searchMessages(messages, 'test')

      expect(results).toHaveLength(50)
    })

    it('returns all results if fewer than limit', () => {
      const messages = [
        createMessage({ id: '1', content: 'test' }),
        createMessage({ id: '2', content: 'test' }),
      ]
      const results = searchMessages(messages, 'test', { limit: 100 })

      expect(results).toHaveLength(2)
    })
  })

  describe('match position tracking', () => {
    it('correctly tracks match start and end positions', () => {
      const messages = [createMessage({ id: '1', content: 'The quick brown fox' })]
      const results = searchMessages(messages, 'quick')

      expect(results[0]!.matchStart).toBe(4)
      expect(results[0]!.matchEnd).toBe(9)
    })

    it('tracks position for branchTitle matches', () => {
      const messages = [
        createMessage({ id: '1', content: 'x', branchTitle: 'Alternative Approach' }),
      ]
      const results = searchMessages(messages, 'Approach')

      expect(results[0]!.matchStart).toBe(12)
      expect(results[0]!.matchEnd).toBe(20)
    })

    it('finds first occurrence when content has multiple matches', () => {
      const messages = [createMessage({ id: '1', content: 'test test test' })]
      const results = searchMessages(messages, 'test')

      // Should find first occurrence
      expect(results).toHaveLength(1)
      expect(results[0]!.matchStart).toBe(0)
      expect(results[0]!.matchEnd).toBe(4)
    })
  })

  describe('special characters and edge cases', () => {
    it('matches special characters literally', () => {
      const messages = [createMessage({ id: '1', content: 'Hello (world)!' })]
      const results = searchMessages(messages, '(world)')

      expect(results).toHaveLength(1)
    })

    it('handles unicode characters', () => {
      const messages = [createMessage({ id: '1', content: 'Hello 世界' })]
      const results = searchMessages(messages, '世界')

      expect(results).toHaveLength(1)
    })

    it('handles emoji', () => {
      const messages = [createMessage({ id: '1', content: 'Hello 👋 world' })]
      const results = searchMessages(messages, '👋')

      expect(results).toHaveLength(1)
    })

    it('handles newlines in content', () => {
      const messages = [createMessage({ id: '1', content: 'Line 1\nLine 2\nLine 3' })]
      const results = searchMessages(messages, 'Line 2')

      expect(results).toHaveLength(1)
    })

    it('handles empty content messages', () => {
      const messages = [createMessage({ id: '1', content: '' })]
      const results = searchMessages(messages, 'test')

      expect(results).toEqual([])
    })
  })

  describe('message roles', () => {
    it('searches all message roles', () => {
      const messages = [
        createMessage({ id: '1', content: 'User message with keyword', role: 'user' }),
        createMessage({ id: '2', content: 'Assistant message with keyword', role: 'assistant' }),
        createMessage({ id: '3', content: 'System message with keyword', role: 'system' }),
      ]
      const results = searchMessages(messages, 'keyword')

      expect(results).toHaveLength(3)
      expect(results.map((r) => r.message.role)).toContain('user')
      expect(results.map((r) => r.message.role)).toContain('assistant')
      expect(results.map((r) => r.message.role)).toContain('system')
    })
  })
})

describe('getMatchSnippet', () => {
  it('returns full text when match is short', () => {
    const result = getMatchSnippet('Hello world', 6, 11, 30)

    expect(result.prefix).toBe('Hello ')
    expect(result.match).toBe('world')
    expect(result.suffix).toBe('')
    expect(result.hasMoreBefore).toBe(false)
    expect(result.hasMoreAfter).toBe(false)
  })

  it('truncates long text before match', () => {
    const longText = 'A'.repeat(100) + 'MATCH' + 'B'.repeat(10)
    const result = getMatchSnippet(longText, 100, 105, 30)

    expect(result.prefix).toHaveLength(30)
    expect(result.match).toBe('MATCH')
    expect(result.hasMoreBefore).toBe(true)
    expect(result.hasMoreAfter).toBe(false)
  })

  it('truncates long text after match', () => {
    const longText = 'A'.repeat(10) + 'MATCH' + 'B'.repeat(100)
    const result = getMatchSnippet(longText, 10, 15, 30)

    expect(result.suffix).toHaveLength(30)
    expect(result.match).toBe('MATCH')
    expect(result.hasMoreBefore).toBe(false)
    expect(result.hasMoreAfter).toBe(true)
  })

  it('truncates both sides for match in middle', () => {
    const longText = 'A'.repeat(100) + 'MATCH' + 'B'.repeat(100)
    const result = getMatchSnippet(longText, 100, 105, 20)

    expect(result.prefix).toHaveLength(20)
    expect(result.suffix).toHaveLength(20)
    expect(result.match).toBe('MATCH')
    expect(result.hasMoreBefore).toBe(true)
    expect(result.hasMoreAfter).toBe(true)
  })

  it('handles match at start of text', () => {
    const result = getMatchSnippet('MATCH and more text', 0, 5, 30)

    expect(result.prefix).toBe('')
    expect(result.match).toBe('MATCH')
    expect(result.hasMoreBefore).toBe(false)
  })

  it('handles match at end of text', () => {
    const result = getMatchSnippet('some text MATCH', 10, 15, 30)

    expect(result.suffix).toBe('')
    expect(result.match).toBe('MATCH')
    expect(result.hasMoreAfter).toBe(false)
  })
})

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delays function execution', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('only calls function once for rapid calls', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    debounced()
    debounced()
    debounced()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('passes latest arguments to function', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('first')
    debounced('second')
    debounced('third')

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledWith('third')
  })

  it('resets timer on each call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    vi.advanceTimersByTime(50)
    debounced()
    vi.advanceTimersByTime(50)
    debounced()
    vi.advanceTimersByTime(50)

    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('cancel prevents execution', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    vi.advanceTimersByTime(50)
    debounced.cancel()

    vi.advanceTimersByTime(100)
    expect(fn).not.toHaveBeenCalled()
  })

  it('allows new calls after cancel', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    debounced.cancel()
    debounced()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledOnce()
  })
})
