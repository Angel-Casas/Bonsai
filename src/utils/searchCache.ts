/**
 * Search Cache Service
 *
 * Provides in-memory caching of searchable text for performance optimization.
 * Key features:
 * - Caches decrypted content when encryption is enabled
 * - Clears cache on lock (security requirement)
 * - Invalidates entries on message edits/deletes
 * - Progressive search support for large datasets
 *
 * IMPORTANT: This cache is NEVER persisted to disk when encryption is enabled.
 * It only exists in memory for the duration of an unlocked session.
 */

import type { Message } from '@/db/types'
import { searchMessages as baseSearchMessages, type SearchResult, type SearchOptions } from './searchUtils'

/** Cached searchable entry for a message */
interface SearchableCacheEntry {
  messageId: string
  conversationId: string
  /** Lowercase content for fast matching */
  contentLower: string
  /** Lowercase branch title for fast matching */
  branchTitleLower: string | null
  /** Original content (for result display) */
  content: string
  /** Original branch title */
  branchTitle: string | null
  /** Message role */
  role: Message['role']
  /** Creation timestamp for sorting */
  createdAt: string
}

/** Cache for a single conversation */
interface ConversationCache {
  conversationId: string
  /** Cached entries indexed by message ID */
  entries: Map<string, SearchableCacheEntry>
  /** When the cache was last built */
  builtAt: number
  /** Total message count when built */
  messageCount: number
}

// Global cache state
let cache: ConversationCache | null = null
let isCacheEnabled = true

/**
 * Enable or disable the search cache
 * Called when encryption state changes
 */
export function setSearchCacheEnabled(enabled: boolean): void {
  isCacheEnabled = enabled
  if (!enabled) {
    clearSearchCache()
  }
}

/**
 * Clear the search cache
 * MUST be called when encryption is locked (security requirement)
 */
export function clearSearchCache(): void {
  cache = null
}

/**
 * Check if cache is currently populated for a conversation
 */
export function isCachePopulated(conversationId: string): boolean {
  return cache !== null && cache.conversationId === conversationId
}

/**
 * Get cache statistics for diagnostics
 */
export function getCacheStats(): { enabled: boolean; populated: boolean; entryCount: number; conversationId: string | null } {
  return {
    enabled: isCacheEnabled,
    populated: cache !== null,
    entryCount: cache?.entries.size ?? 0,
    conversationId: cache?.conversationId ?? null,
  }
}

/**
 * Build search cache for a conversation
 * Should be called when loading a conversation's messages
 */
export function buildSearchCache(conversationId: string, messages: Message[]): void {
  if (!isCacheEnabled) return

  const entries = new Map<string, SearchableCacheEntry>()

  for (const msg of messages) {
    entries.set(msg.id, {
      messageId: msg.id,
      conversationId: msg.conversationId,
      contentLower: msg.content.toLowerCase(),
      branchTitleLower: msg.branchTitle?.toLowerCase() ?? null,
      content: msg.content,
      branchTitle: msg.branchTitle ?? null,
      role: msg.role,
      createdAt: msg.createdAt,
    })
  }

  cache = {
    conversationId,
    entries,
    builtAt: Date.now(),
    messageCount: messages.length,
  }
}

/**
 * Update cache for a single message (edit/new message)
 */
export function updateCacheEntry(message: Message): void {
  if (!isCacheEnabled || !cache || cache.conversationId !== message.conversationId) return

  cache.entries.set(message.id, {
    messageId: message.id,
    conversationId: message.conversationId,
    contentLower: message.content.toLowerCase(),
    branchTitleLower: message.branchTitle?.toLowerCase() ?? null,
    content: message.content,
    branchTitle: message.branchTitle ?? null,
    role: message.role,
    createdAt: message.createdAt,
  })
}

/**
 * Remove cache entry for a deleted message
 */
export function removeCacheEntry(messageId: string): void {
  if (!cache) return
  cache.entries.delete(messageId)
}

/**
 * Progressive search configuration
 */
export interface ProgressiveSearchOptions extends SearchOptions {
  /** Number of results to return in first batch (default: 20) */
  initialBatchSize?: number
  /** Callback for progress updates */
  onProgress?: (results: SearchResult[], isComplete: boolean) => void
}

/**
 * Perform cached search on a conversation
 * Uses pre-computed lowercase strings for faster matching
 */
export function searchCached(
  conversationId: string,
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const { limit = 50 } = options
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  // If no cache or wrong conversation, fall back
  if (!cache || cache.conversationId !== conversationId) {
    return []
  }

  const lowerQuery = trimmedQuery.toLowerCase()
  const results: SearchResult[] = []

  for (const entry of cache.entries.values()) {
    // Check branch title
    if (entry.branchTitleLower) {
      const matchIndex = entry.branchTitleLower.indexOf(lowerQuery)
      if (matchIndex !== -1) {
        results.push({
          message: {
            id: entry.messageId,
            conversationId: entry.conversationId,
            parentId: null, // Not cached, but not needed for search results
            role: entry.role,
            content: entry.content,
            branchTitle: entry.branchTitle ?? undefined,
            createdAt: entry.createdAt,
            updatedAt: entry.createdAt,
          },
          matchType: 'branchTitle',
          matchedText: entry.branchTitle!,
          matchStart: matchIndex,
          matchEnd: matchIndex + trimmedQuery.length,
        })
      }
    }

    // Check content
    const matchIndex = entry.contentLower.indexOf(lowerQuery)
    if (matchIndex !== -1) {
      results.push({
        message: {
          id: entry.messageId,
          conversationId: entry.conversationId,
          parentId: null,
          role: entry.role,
          content: entry.content,
          branchTitle: entry.branchTitle ?? undefined,
          createdAt: entry.createdAt,
          updatedAt: entry.createdAt,
        },
        matchType: 'content',
        matchedText: entry.content,
        matchStart: matchIndex,
        matchEnd: matchIndex + trimmedQuery.length,
      })
    }
  }

  // Sort by createdAt ascending, then by id for stable ordering
  results.sort((a, b) => {
    const dateCompare = a.message.createdAt.localeCompare(b.message.createdAt)
    if (dateCompare !== 0) return dateCompare
    return a.message.id.localeCompare(b.message.id)
  })

  return results.slice(0, limit)
}

/**
 * Progressive search - returns results in batches
 * First batch is returned immediately, remaining results follow
 */
export function searchProgressive(
  messages: Message[],
  query: string,
  options: ProgressiveSearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 50, initialBatchSize = 20, onProgress } = options
  const trimmedQuery = query.trim()

  return new Promise((resolve) => {
    if (!trimmedQuery) {
      onProgress?.([], true)
      resolve([])
      return
    }

    const lowerQuery = trimmedQuery.toLowerCase()
    const allResults: SearchResult[] = []
    let currentIndex = 0
    const chunkSize = 100 // Process 100 messages per tick

    const processChunk = () => {
      const endIndex = Math.min(currentIndex + chunkSize, messages.length)

      for (let i = currentIndex; i < endIndex; i++) {
        const message = messages[i]
        if (!message) continue

        // Check branch title
        if (message.branchTitle) {
          const lowerTitle = message.branchTitle.toLowerCase()
          const matchIndex = lowerTitle.indexOf(lowerQuery)
          if (matchIndex !== -1) {
            allResults.push({
              message,
              matchType: 'branchTitle',
              matchedText: message.branchTitle,
              matchStart: matchIndex,
              matchEnd: matchIndex + trimmedQuery.length,
            })
          }
        }

        // Check content
        const lowerContent = message.content.toLowerCase()
        const matchIndex = lowerContent.indexOf(lowerQuery)
        if (matchIndex !== -1) {
          allResults.push({
            message,
            matchType: 'content',
            matchedText: message.content,
            matchStart: matchIndex,
            matchEnd: matchIndex + trimmedQuery.length,
          })
        }
      }

      currentIndex = endIndex

      // Sort current results
      allResults.sort((a, b) => {
        const dateCompare = a.message.createdAt.localeCompare(b.message.createdAt)
        if (dateCompare !== 0) return dateCompare
        return a.message.id.localeCompare(b.message.id)
      })

      const limitedResults = allResults.slice(0, limit)
      const isComplete = currentIndex >= messages.length

      // Report progress
      if (onProgress) {
        // For first batch, report immediately
        if (currentIndex === endIndex && allResults.length <= initialBatchSize) {
          onProgress(limitedResults, isComplete)
        } else if (isComplete) {
          onProgress(limitedResults, true)
        }
      }

      if (isComplete) {
        resolve(limitedResults)
      } else {
        // Schedule next chunk
        setTimeout(processChunk, 0)
      }
    }

    // Start processing
    processChunk()
  })
}

/**
 * Smart search - uses cache if available, falls back to direct search
 */
export function searchSmart(
  messages: Message[],
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  // If cache is populated for this conversation, use it
  const firstMessage = messages[0]
  if (cache && firstMessage && cache.conversationId === firstMessage.conversationId) {
    return searchCached(cache.conversationId, query, options)
  }

  // Fall back to direct search
  return baseSearchMessages(messages, query, options)
}
