/**
 * Unit tests for NanoGPT API client
 * Tests payload building and SSE parsing without network calls
 */

import { describe, it, expect } from 'vitest'
import {
  buildEffectiveModel,
  messagesToNanoGPTFormat,
  buildChatCompletionPayload,
  parseSSELine,
  extractContentFromChunk,
  SEARCH_PRESETS,
  DEFAULT_MODEL,
  type StreamChunk,
} from './nanogpt'
import type { Message } from '@/db/types'

describe('buildEffectiveModel', () => {
  it('returns base model when web search is disabled', () => {
    expect(buildEffectiveModel('gpt-4', false)).toBe('gpt-4')
    expect(buildEffectiveModel('claude-sonnet', false, 'deep')).toBe('claude-sonnet')
  })

  it('appends :online suffix for standard web search', () => {
    expect(buildEffectiveModel('gpt-4', true, 'standard')).toBe('gpt-4:online')
  })

  it('appends :online/linkup-deep suffix for deep web search', () => {
    expect(buildEffectiveModel('gpt-4', true, 'deep')).toBe('gpt-4:online/linkup-deep')
  })

  it('defaults to standard preset when none specified', () => {
    expect(buildEffectiveModel('gpt-4', true)).toBe('gpt-4:online')
  })
})

describe('messagesToNanoGPTFormat', () => {
  it('converts Bonsai messages to NanoGPT format', () => {
    const messages: Message[] = [
      {
        id: '1',
        conversationId: 'conv-1',
        parentId: null,
        role: 'system',
        content: 'You are a helpful assistant.',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: '2',
        conversationId: 'conv-1',
        parentId: '1',
        role: 'user',
        content: 'Hello!',
        createdAt: '2026-01-01T00:01:00Z',
        updatedAt: '2026-01-01T00:01:00Z',
      },
      {
        id: '3',
        conversationId: 'conv-1',
        parentId: '2',
        role: 'assistant',
        content: 'Hi there!',
        createdAt: '2026-01-01T00:02:00Z',
        updatedAt: '2026-01-01T00:02:00Z',
      },
    ]

    const result = messagesToNanoGPTFormat(messages)

    expect(result).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ])
  })

  it('only includes role and content, excluding other fields', () => {
    const messages: Message[] = [
      {
        id: '1',
        conversationId: 'conv-1',
        parentId: null,
        role: 'user',
        content: 'Test',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        branchTitle: 'Some branch',
        modelRequested: 'gpt-4',
      },
    ]

    const result = messagesToNanoGPTFormat(messages)

    expect(result).toEqual([{ role: 'user', content: 'Test' }])
    expect(result[0]).not.toHaveProperty('id')
    expect(result[0]).not.toHaveProperty('branchTitle')
  })
})

describe('buildChatCompletionPayload', () => {
  it('builds a valid request payload', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
    ]

    const payload = buildChatCompletionPayload(messages, 'gpt-4', true)

    expect(payload).toEqual({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    })
  })

  it('includes model with web search suffix', () => {
    const messages = [{ role: 'user' as const, content: 'Search for news' }]

    const payload = buildChatCompletionPayload(
      messages,
      buildEffectiveModel('chatgpt-4o-latest', true, 'deep'),
      true
    )

    expect(payload.model).toBe('chatgpt-4o-latest:online/linkup-deep')
  })

  it('defaults stream to true', () => {
    const messages = [{ role: 'user' as const, content: 'Test' }]

    const payload = buildChatCompletionPayload(messages, 'gpt-4')

    expect(payload.stream).toBe(true)
  })
})

describe('parseSSELine', () => {
  it('parses valid data line with content', () => {
    const line = 'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}'
    const chunk = parseSSELine(line)

    expect(chunk).not.toBeNull()
    expect(chunk?.choices[0]?.delta.content).toBe('Hello')
  })

  it('returns null for empty lines', () => {
    expect(parseSSELine('')).toBeNull()
  })

  it('returns null for comment lines', () => {
    expect(parseSSELine(': this is a comment')).toBeNull()
  })

  it('returns null for non-data lines', () => {
    expect(parseSSELine('event: message')).toBeNull()
    expect(parseSSELine('id: 123')).toBeNull()
  })

  it('returns null for [DONE] marker', () => {
    expect(parseSSELine('data: [DONE]')).toBeNull()
  })

  it('handles data with extra whitespace', () => {
    const line = 'data:   {"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}  '
    const chunk = parseSSELine(line)

    expect(chunk?.choices[0]?.delta.content).toBe('Hi')
  })

  it('returns null for malformed JSON', () => {
    expect(parseSSELine('data: {invalid json}')).toBeNull()
    expect(parseSSELine('data: not json at all')).toBeNull()
  })

  it('handles empty delta content', () => {
    const line = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":null}]}'
    const chunk = parseSSELine(line)

    expect(chunk).not.toBeNull()
    expect(chunk?.choices[0]?.delta.content).toBeUndefined()
  })

  it('handles finish_reason in final chunk', () => {
    const line = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}'
    const chunk = parseSSELine(line)

    expect(chunk).not.toBeNull()
    expect(chunk?.choices[0]?.finish_reason).toBe('stop')
  })
})

describe('extractContentFromChunk', () => {
  it('extracts content from valid chunk', () => {
    const chunk: StreamChunk = {
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
    }

    expect(extractContentFromChunk(chunk)).toBe('Hello')
  })

  it('returns empty string when delta has no content', () => {
    const chunk: StreamChunk = {
      choices: [{ index: 0, delta: {}, finish_reason: null }],
    }

    expect(extractContentFromChunk(chunk)).toBe('')
  })

  it('returns empty string when choices is empty', () => {
    const chunk: StreamChunk = {
      choices: [],
    }

    expect(extractContentFromChunk(chunk)).toBe('')
  })

  it('handles undefined content gracefully', () => {
    const chunk: StreamChunk = {
      choices: [{ index: 0, delta: { content: undefined }, finish_reason: null }],
    }

    expect(extractContentFromChunk(chunk)).toBe('')
  })
})

describe('SEARCH_PRESETS', () => {
  it('has standard preset with :online suffix', () => {
    const standard = SEARCH_PRESETS.find(p => p.id === 'standard')
    expect(standard).toBeDefined()
    expect(standard?.suffix).toBe(':online')
  })

  it('has deep preset with :online/linkup-deep suffix', () => {
    const deep = SEARCH_PRESETS.find(p => p.id === 'deep')
    expect(deep).toBeDefined()
    expect(deep?.suffix).toBe(':online/linkup-deep')
  })
})

describe('DEFAULT_MODEL', () => {
  it('is set to chatgpt-4o-latest', () => {
    expect(DEFAULT_MODEL).toBe('chatgpt-4o-latest')
  })
})

describe('Integration: Building full request from resolved context', () => {
  it('builds correct payload from conversation context', () => {
    // Simulate resolved context messages (path + pins)
    const resolvedMessages: Message[] = [
      {
        id: 'sys-1',
        conversationId: 'conv-1',
        parentId: null,
        role: 'system',
        content: 'You are an expert assistant.',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'user-1',
        conversationId: 'conv-1',
        parentId: 'sys-1',
        role: 'user',
        content: 'What is TypeScript?',
        createdAt: '2026-01-01T00:01:00Z',
        updatedAt: '2026-01-01T00:01:00Z',
      },
      {
        id: 'asst-1',
        conversationId: 'conv-1',
        parentId: 'user-1',
        role: 'assistant',
        content: 'TypeScript is a typed superset of JavaScript.',
        createdAt: '2026-01-01T00:02:00Z',
        updatedAt: '2026-01-01T00:02:00Z',
      },
      {
        id: 'user-2',
        conversationId: 'conv-1',
        parentId: 'asst-1',
        role: 'user',
        content: 'How do I use generics?',
        createdAt: '2026-01-01T00:03:00Z',
        updatedAt: '2026-01-01T00:03:00Z',
      },
    ]

    // Convert and build payload
    const nanoMessages = messagesToNanoGPTFormat(resolvedMessages)
    const effectiveModel = buildEffectiveModel('gpt-4.1', true, 'standard')
    const payload = buildChatCompletionPayload(nanoMessages, effectiveModel, true)

    // Verify
    expect(payload.model).toBe('gpt-4.1:online')
    expect(payload.messages).toHaveLength(4)
    expect(payload.messages[0]).toEqual({ role: 'system', content: 'You are an expert assistant.' })
    expect(payload.messages[3]).toEqual({ role: 'user', content: 'How do I use generics?' })
    expect(payload.stream).toBe(true)
  })
})
