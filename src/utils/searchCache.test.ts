/**
 * Tests for Search Cache Service
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildSearchCache,
  clearSearchCache,
  searchCached,
  searchProgressive,
  searchSmart,
  updateCacheEntry,
  removeCacheEntry,
  getCacheStats,
  setSearchCacheEnabled,
  isCachePopulated,
} from './searchCache'
import type { Message } from '@/db/types'

function createMessage(id: string, content: string, options: Partial<Message> = {}): Message {
  return {
    id,
    conversationId: 'conv-1',
    parentId: null,
    role: 'user',
    content,
    createdAt: options.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...options,
  }
}

describe('searchCache', () => {
  beforeEach(() => {
    clearSearchCache()
    setSearchCacheEnabled(true)
  })

  describe('buildSearchCache', () => {
    it('builds cache for conversation messages', () => {
      const messages = [
        createMessage('1', 'Hello world'),
        createMessage('2', 'Goodbye world'),
      ]

      buildSearchCache('conv-1', messages)

      const stats = getCacheStats()
      expect(stats.populated).toBe(true)
      expect(stats.entryCount).toBe(2)
      expect(stats.conversationId).toBe('conv-1')
    })

    it('replaces existing cache for different conversation', () => {
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])
      buildSearchCache('conv-2', [createMessage('2', 'World')])

      const stats = getCacheStats()
      expect(stats.conversationId).toBe('conv-2')
      expect(stats.entryCount).toBe(1)
    })
  })

  describe('clearSearchCache', () => {
    it('clears the cache completely', () => {
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])
      expect(getCacheStats().populated).toBe(true)

      clearSearchCache()

      expect(getCacheStats().populated).toBe(false)
      expect(getCacheStats().entryCount).toBe(0)
    })

    it('is idempotent', () => {
      clearSearchCache()
      clearSearchCache()
      expect(getCacheStats().populated).toBe(false)
    })
  })

  describe('setSearchCacheEnabled', () => {
    it('disabling clears the cache', () => {
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])
      expect(getCacheStats().populated).toBe(true)

      setSearchCacheEnabled(false)

      expect(getCacheStats().populated).toBe(false)
      expect(getCacheStats().enabled).toBe(false)
    })

    it('disabled cache does not build', () => {
      setSearchCacheEnabled(false)
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])

      expect(getCacheStats().populated).toBe(false)
    })

    it('re-enabling allows building', () => {
      setSearchCacheEnabled(false)
      setSearchCacheEnabled(true)
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])

      expect(getCacheStats().populated).toBe(true)
    })
  })

  describe('searchCached', () => {
    beforeEach(() => {
      const messages = [
        createMessage('1', 'Hello world', { createdAt: '2024-01-01T00:00:00Z' }),
        createMessage('2', 'Goodbye world', { createdAt: '2024-01-01T00:00:01Z' }),
        createMessage('3', 'Test message', { createdAt: '2024-01-01T00:00:02Z', branchTitle: 'Special Branch' }),
      ]
      buildSearchCache('conv-1', messages)
    })

    it('finds content matches', () => {
      const results = searchCached('conv-1', 'world')
      expect(results.length).toBe(2)
      expect(results[0]!.message.id).toBe('1')
      expect(results[1]!.message.id).toBe('2')
    })

    it('finds branch title matches', () => {
      const results = searchCached('conv-1', 'Special')
      expect(results.length).toBe(1)
      expect(results[0]!.matchType).toBe('branchTitle')
      expect(results[0]!.message.id).toBe('3')
    })

    it('is case insensitive', () => {
      const results = searchCached('conv-1', 'HELLO')
      expect(results.length).toBe(1)
      expect(results[0]!.message.id).toBe('1')
    })

    it('returns empty for wrong conversation', () => {
      const results = searchCached('conv-2', 'world')
      expect(results.length).toBe(0)
    })

    it('returns empty for empty query', () => {
      const results = searchCached('conv-1', '  ')
      expect(results.length).toBe(0)
    })

    it('respects limit option', () => {
      const results = searchCached('conv-1', 'world', { limit: 1 })
      expect(results.length).toBe(1)
    })

    it('maintains stable ordering by createdAt', () => {
      const results = searchCached('conv-1', 'world')
      expect(results[0]!.message.createdAt).toBe('2024-01-01T00:00:00Z')
      expect(results[1]!.message.createdAt).toBe('2024-01-01T00:00:01Z')
    })
  })

  describe('updateCacheEntry', () => {
    it('updates existing entry', () => {
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])

      const updatedMsg = createMessage('1', 'Updated content')
      updateCacheEntry(updatedMsg)

      const results = searchCached('conv-1', 'Updated')
      expect(results.length).toBe(1)
    })

    it('adds new entry', () => {
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])

      const newMsg = createMessage('2', 'New message')
      updateCacheEntry(newMsg)

      const results = searchCached('conv-1', 'New')
      expect(results.length).toBe(1)
    })

    it('does nothing for different conversation', () => {
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])

      const otherMsg = createMessage('2', 'Other', { conversationId: 'conv-2' })
      updateCacheEntry(otherMsg)

      const stats = getCacheStats()
      expect(stats.entryCount).toBe(1)
    })
  })

  describe('removeCacheEntry', () => {
    it('removes entry from cache', () => {
      buildSearchCache('conv-1', [
        createMessage('1', 'Hello'),
        createMessage('2', 'World'),
      ])

      removeCacheEntry('1')

      const stats = getCacheStats()
      expect(stats.entryCount).toBe(1)
    })

    it('handles non-existent entry gracefully', () => {
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])
      removeCacheEntry('non-existent')
      expect(getCacheStats().entryCount).toBe(1)
    })
  })

  describe('searchProgressive', () => {
    it('returns results progressively', async () => {
      const messages = Array.from({ length: 200 }, (_, i) =>
        createMessage(`${i}`, `Message ${i} with searchable content`)
      )

      const progressUpdates: { count: number; complete: boolean }[] = []

      const results = await searchProgressive(messages, 'searchable', {
        onProgress: (results, isComplete) => {
          progressUpdates.push({ count: results.length, complete: isComplete })
        },
      })

      // Should have received at least one progress update
      expect(progressUpdates.length).toBeGreaterThan(0)
      // Final update should be complete
      expect(progressUpdates[progressUpdates.length - 1]!.complete).toBe(true)
      // Should have results
      expect(results.length).toBeGreaterThan(0)
    })

    it('respects limit', async () => {
      const messages = Array.from({ length: 100 }, (_, i) =>
        createMessage(`${i}`, `Message ${i}`)
      )

      const results = await searchProgressive(messages, 'Message', { limit: 10 })
      expect(results.length).toBe(10)
    })

    it('handles empty query', async () => {
      const messages = [createMessage('1', 'Hello')]
      const results = await searchProgressive(messages, '')
      expect(results.length).toBe(0)
    })
  })

  describe('searchSmart', () => {
    it('uses cache when available', () => {
      const messages = [createMessage('1', 'Hello world')]
      buildSearchCache('conv-1', messages)

      const results = searchSmart(messages, 'Hello')
      expect(results.length).toBe(1)
    })

    it('falls back to direct search when no cache', () => {
      const messages = [createMessage('1', 'Hello world')]
      // Don't build cache

      const results = searchSmart(messages, 'Hello')
      expect(results.length).toBe(1)
    })

    it('falls back when cache is for different conversation', () => {
      const messages = [createMessage('1', 'Hello world', { conversationId: 'conv-2' })]
      buildSearchCache('conv-1', [createMessage('2', 'Other')])

      const results = searchSmart(messages, 'Hello')
      expect(results.length).toBe(1)
    })
  })

  describe('isCachePopulated', () => {
    it('returns true when cache exists for conversation', () => {
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])
      expect(isCachePopulated('conv-1')).toBe(true)
    })

    it('returns false when cache is for different conversation', () => {
      buildSearchCache('conv-1', [createMessage('1', 'Hello')])
      expect(isCachePopulated('conv-2')).toBe(false)
    })

    it('returns false when no cache', () => {
      expect(isCachePopulated('conv-1')).toBe(false)
    })
  })

  describe('security properties', () => {
    it('cache is cleared when disabled (simulates lock)', () => {
      buildSearchCache('conv-1', [createMessage('1', 'Sensitive data')])
      expect(getCacheStats().populated).toBe(true)

      // Simulate encryption lock
      setSearchCacheEnabled(false)

      expect(getCacheStats().populated).toBe(false)
      // Search should return nothing
      const results = searchCached('conv-1', 'Sensitive')
      expect(results.length).toBe(0)
    })

    it('cache is memory-only (no persistence check)', () => {
      // This test documents the design - cache is in module scope only
      buildSearchCache('conv-1', [createMessage('1', 'Data')])

      // The cache variable is not exported, only accessor functions
      // This ensures no accidental persistence
      const stats = getCacheStats()
      expect(stats.populated).toBe(true)
      // There's no way to access the raw cache data from outside
    })
  })
})
