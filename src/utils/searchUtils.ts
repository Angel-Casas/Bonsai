/**
 * Search utilities for conversation messages
 *
 * Provides pure functions for searching messages by:
 * - Branch titles (message.branchTitle)
 * - Message content (message.content)
 *
 * Features:
 * - Case-insensitive substring matching
 * - Deterministic ordering (by createdAt ascending, then id for ties)
 * - Scoped to a single conversation's messages
 */

import type { Message } from '@/db/types'

/**
 * Search result with context about the match
 */
export interface SearchResult {
  /** The message that matched */
  message: Message
  /** Type of match: 'branchTitle' or 'content' */
  matchType: 'branchTitle' | 'content'
  /** The text that was matched (branchTitle or content) */
  matchedText: string
  /** Start index of match within matchedText */
  matchStart: number
  /** End index of match within matchedText */
  matchEnd: number
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Maximum number of results to return (default: 50) */
  limit?: number
}

/**
 * Search messages for a query string
 *
 * Performs case-insensitive substring matching on:
 * 1. Branch titles (message.branchTitle)
 * 2. Message content (message.content)
 *
 * Results are ordered by:
 * 1. createdAt ascending (older messages first)
 * 2. id ascending (for stable tie-breaking)
 *
 * A message can appear twice if it matches both in branchTitle and content.
 *
 * @param messages - Array of messages to search
 * @param query - Search query (case-insensitive)
 * @param options - Search options
 * @returns Array of search results with match context
 */
export function searchMessages(
  messages: Message[],
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const { limit = 50 } = options

  // Empty or whitespace-only queries return no results
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  const lowerQuery = trimmedQuery.toLowerCase()
  const results: SearchResult[] = []

  for (const message of messages) {
    // Check branch title first
    if (message.branchTitle) {
      const lowerTitle = message.branchTitle.toLowerCase()
      const matchIndex = lowerTitle.indexOf(lowerQuery)
      if (matchIndex !== -1) {
        results.push({
          message,
          matchType: 'branchTitle',
          matchedText: message.branchTitle,
          matchStart: matchIndex,
          matchEnd: matchIndex + trimmedQuery.length,
        })
      }
    }

    // Check message content
    const lowerContent = message.content.toLowerCase()
    const matchIndex = lowerContent.indexOf(lowerQuery)
    if (matchIndex !== -1) {
      results.push({
        message,
        matchType: 'content',
        matchedText: message.content,
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

  // Apply limit
  return results.slice(0, limit)
}

/**
 * Get a snippet of text around a match with highlighting markers
 *
 * @param text - Full text
 * @param matchStart - Start index of match
 * @param matchEnd - End index of match
 * @param contextChars - Number of characters to show before/after match
 * @returns Object with prefix, match, and suffix parts
 */
export function getMatchSnippet(
  text: string,
  matchStart: number,
  matchEnd: number,
  contextChars: number = 30
): { prefix: string; match: string; suffix: string; hasMoreBefore: boolean; hasMoreAfter: boolean } {
  const snippetStart = Math.max(0, matchStart - contextChars)
  const snippetEnd = Math.min(text.length, matchEnd + contextChars)

  const prefix = text.substring(snippetStart, matchStart)
  const match = text.substring(matchStart, matchEnd)
  const suffix = text.substring(matchEnd, snippetEnd)

  return {
    prefix,
    match,
    suffix,
    hasMoreBefore: snippetStart > 0,
    hasMoreAfter: snippetEnd < text.length,
  }
}

/**
 * Debounce a function call
 *
 * @param fn - Function to debounce
 * @param delayMs - Delay in milliseconds
 * @returns Debounced function with cancel method
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delayMs: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delayMs)
  }) as T & { cancel: () => void }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced
}
