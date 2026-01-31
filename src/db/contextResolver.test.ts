/**
 * Context Resolver Tests
 * 
 * Tests for the resolveContext pure function and related utilities.
 * Tests all context resolution rules: path, anchor, exclusions, pins.
 */

import { describe, it, expect } from 'vitest';
import type { Message } from './types';
import {
  resolveContext,
  createDefaultContextConfig,
  isMessageOnPath,
  searchMessages,
  type ContextResolverConfig,
} from './contextResolver';

// Helper to create a message with minimal required fields
function createMessage(
  id: string,
  parentId: string | null,
  role: Message['role'] = 'user',
  content: string = `Message ${id}`,
  createdAt?: string
): Message {
  return {
    id,
    conversationId: 'conv-1',
    parentId,
    role,
    content,
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Helper to create a message map from an array
function createMessageMap(messages: Message[]): Map<string, Message> {
  return new Map(messages.map(m => [m.id, m]));
}

describe('resolveContext', () => {
  describe('path only (no config)', () => {
    it('returns full path for a leaf message', () => {
      // Tree: A -> B -> C
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Response', '2024-01-01T00:01:00Z'),
        createMessage('C', 'B', 'user', 'Follow-up', '2024-01-01T00:02:00Z'),
      ];
      const map = createMessageMap(messages);
      const config = createDefaultContextConfig();

      const result = resolveContext('C', map, config);

      expect(result.pathMessages).toHaveLength(3);
      expect(result.pathMessages.map(m => m.id)).toEqual(['A', 'B', 'C']);
      expect(result.pinnedMessages).toHaveLength(0);
      expect(result.resolvedMessageIds).toEqual(['A', 'B', 'C']);
      expect(result.warnings).toHaveLength(0);
    });

    it('returns single message for root', () => {
      const messages = [createMessage('A', null)];
      const map = createMessageMap(messages);
      const config = createDefaultContextConfig();

      const result = resolveContext('A', map, config);

      expect(result.pathMessages).toHaveLength(1);
      expect(result.pathMessages[0]?.id).toBe('A');
      expect(result.resolvedMessageIds).toEqual(['A']);
    });

    it('returns empty arrays for non-existent message', () => {
      const messages = [createMessage('A', null)];
      const map = createMessageMap(messages);
      const config = createDefaultContextConfig();

      const result = resolveContext('X', map, config);

      expect(result.pathMessages).toHaveLength(0);
      expect(result.resolvedMessages).toHaveLength(0);
    });
  });

  describe('path truncation by anchor (startFromMessageId)', () => {
    it('truncates path to start from anchor', () => {
      // Tree: A -> B -> C -> D
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Response 1', '2024-01-01T00:01:00Z'),
        createMessage('C', 'B', 'user', 'Follow-up', '2024-01-01T00:02:00Z'),
        createMessage('D', 'C', 'assistant', 'Response 2', '2024-01-01T00:03:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: 'B',
        excludedMessageIds: [],
        pinnedMessageIds: [],
      };

      const result = resolveContext('D', map, config);

      expect(result.pathMessages.map(m => m.id)).toEqual(['B', 'C', 'D']);
      expect(result.resolvedMessageIds).toEqual(['B', 'C', 'D']);
      // Note: We get an ASSISTANT_WITHOUT_USER warning for B (assistant) because
      // its parent A (user) is truncated from the context. This is expected behavior.
      const unexpectedWarnings = result.warnings.filter(w => 
        w.type !== 'ASSISTANT_WITHOUT_USER' || w.relatedMessageId !== 'B'
      );
      expect(unexpectedWarnings).toHaveLength(0);
    });

    it('uses full path when anchor is the root', () => {
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Response', '2024-01-01T00:01:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: 'A',
        excludedMessageIds: [],
        pinnedMessageIds: [],
      };

      const result = resolveContext('B', map, config);

      expect(result.pathMessages.map(m => m.id)).toEqual(['A', 'B']);
    });

    it('warns and ignores anchor not on path', () => {
      // Tree: A -> B and A -> C (branches)
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Branch 1', '2024-01-01T00:01:00Z'),
        createMessage('C', 'A', 'user', 'Branch 2', '2024-01-01T00:02:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: 'C', // Not on path to B
        excludedMessageIds: [],
        pinnedMessageIds: [],
      };

      const result = resolveContext('B', map, config);

      // Path should be unchanged (A -> B)
      expect(result.pathMessages.map(m => m.id)).toEqual(['A', 'B']);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.type).toBe('ANCHOR_NOT_ON_PATH');
      expect(result.warnings[0]?.relatedMessageId).toBe('C');
    });
  });

  describe('exclusions', () => {
    it('removes excluded messages from path', () => {
      // Tree: A -> B -> C -> D
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Response 1', '2024-01-01T00:01:00Z'),
        createMessage('C', 'B', 'user', 'Follow-up', '2024-01-01T00:02:00Z'),
        createMessage('D', 'C', 'assistant', 'Response 2', '2024-01-01T00:03:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: ['B'],
        pinnedMessageIds: [],
      };

      const result = resolveContext('D', map, config);

      expect(result.pathMessages.map(m => m.id)).toEqual(['A', 'C', 'D']);
      expect(result.resolvedMessageIds).toEqual(['A', 'C', 'D']);
    });

    it('removes multiple excluded messages', () => {
      // Tree: A -> B -> C -> D -> E
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'R1', '2024-01-01T00:01:00Z'),
        createMessage('C', 'B', 'user', 'Q2', '2024-01-01T00:02:00Z'),
        createMessage('D', 'C', 'assistant', 'R2', '2024-01-01T00:03:00Z'),
        createMessage('E', 'D', 'user', 'Q3', '2024-01-01T00:04:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: ['B', 'D'],
        pinnedMessageIds: [],
      };

      const result = resolveContext('E', map, config);

      expect(result.pathMessages.map(m => m.id)).toEqual(['A', 'C', 'E']);
    });

    it('warns for excluded messages not on path', () => {
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Response', '2024-01-01T00:01:00Z'),
        createMessage('C', 'A', 'user', 'Other branch', '2024-01-01T00:02:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: ['C'], // Not on path to B
        pinnedMessageIds: [],
      };

      const result = resolveContext('B', map, config);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.type).toBe('EXCLUDED_MESSAGE_NOT_ON_PATH');
      expect(result.warnings[0]?.relatedMessageId).toBe('C');
    });
  });

  describe('pins', () => {
    it('adds pinned messages after path', () => {
      // Tree: A -> B and A -> C (branches)
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Response', '2024-01-01T00:01:00Z'),
        createMessage('C', 'A', 'user', 'Other branch', '2024-01-01T00:02:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: [],
        pinnedMessageIds: ['C'],
      };

      const result = resolveContext('B', map, config);

      expect(result.pathMessages.map(m => m.id)).toEqual(['A', 'B']);
      expect(result.pinnedMessages.map(m => m.id)).toEqual(['C']);
      expect(result.resolvedMessageIds).toEqual(['A', 'B', 'C']);
    });

    it('deduplicates pins already on path', () => {
      // Tree: A -> B -> C
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Response', '2024-01-01T00:01:00Z'),
        createMessage('C', 'B', 'user', 'Follow-up', '2024-01-01T00:02:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: [],
        pinnedMessageIds: ['A', 'B'], // Both already on path
      };

      const result = resolveContext('C', map, config);

      // Pins should be empty (deduplicated)
      expect(result.pinnedMessages).toHaveLength(0);
      expect(result.resolvedMessageIds).toEqual(['A', 'B', 'C']);
    });

    it('sorts pins by createdAt ascending', () => {
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Path end', '2024-01-01T00:01:00Z'),
        createMessage('C', 'A', 'user', 'Branch 1', '2024-01-01T00:05:00Z'), // Newer
        createMessage('D', 'A', 'user', 'Branch 2', '2024-01-01T00:03:00Z'), // Older
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: [],
        pinnedMessageIds: ['C', 'D'], // Order doesn't match createdAt
      };

      const result = resolveContext('B', map, config);

      // Should be sorted by createdAt ascending
      expect(result.pinnedMessages.map(m => m.id)).toEqual(['D', 'C']);
    });

    it('uses id as tiebreaker when createdAt matches', () => {
      const timestamp = '2024-01-01T00:05:00Z';
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Path', '2024-01-01T00:01:00Z'),
        createMessage('Z', 'A', 'user', 'Branch Z', timestamp),
        createMessage('M', 'A', 'user', 'Branch M', timestamp),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: [],
        pinnedMessageIds: ['Z', 'M'],
      };

      const result = resolveContext('B', map, config);

      // Should be sorted by id when timestamps match
      expect(result.pinnedMessages.map(m => m.id)).toEqual(['M', 'Z']);
    });

    it('warns for pinned messages not found', () => {
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: [],
        pinnedMessageIds: ['X'], // Non-existent
      };

      const result = resolveContext('A', map, config);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.type).toBe('PINNED_MESSAGE_NOT_FOUND');
      expect(result.warnings[0]?.relatedMessageId).toBe('X');
    });
  });

  describe('mixed cases (anchor + exclusions + pins)', () => {
    it('handles anchor, exclusions, and pins together', () => {
      // Tree: A -> B -> C -> D and B -> E (branch from B)
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Response', '2024-01-01T00:01:00Z'),
        createMessage('C', 'B', 'user', 'Question', '2024-01-01T00:02:00Z'),
        createMessage('D', 'C', 'assistant', 'Answer', '2024-01-01T00:03:00Z'),
        createMessage('E', 'B', 'user', 'Alt branch', '2024-01-01T00:04:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: 'B', // Truncate from B
        excludedMessageIds: ['C'], // Exclude C
        pinnedMessageIds: ['E'], // Pin E from other branch
      };

      const result = resolveContext('D', map, config);

      // Path: B -> D (A removed by anchor, C removed by exclusion)
      expect(result.pathMessages.map(m => m.id)).toEqual(['B', 'D']);
      // Pins: E
      expect(result.pinnedMessages.map(m => m.id)).toEqual(['E']);
      // Final: B, D, E
      expect(result.resolvedMessageIds).toEqual(['B', 'D', 'E']);
    });

    it('pinning an excluded path message still excludes it', () => {
      // If a message is excluded from path and then pinned,
      // it should appear in pins (not path) since it was excluded
      const messages = [
        createMessage('A', null, 'user', 'Root', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Response', '2024-01-01T00:01:00Z'),
        createMessage('C', 'B', 'user', 'Follow-up', '2024-01-01T00:02:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: ['B'],
        pinnedMessageIds: ['B'], // Pin the excluded message
      };

      const result = resolveContext('C', map, config);

      // Path should not contain B (excluded)
      expect(result.pathMessages.map(m => m.id)).toEqual(['A', 'C']);
      // B should appear in pins
      expect(result.pinnedMessages.map(m => m.id)).toEqual(['B']);
      // Final order: A, C, B
      expect(result.resolvedMessageIds).toEqual(['A', 'C', 'B']);
    });
  });

  describe('coherence warnings', () => {
    it('warns when assistant message lacks preceding user message', () => {
      // Tree: A (user) -> B (assistant) -> C (user) -> D (assistant)
      const messages = [
        createMessage('A', null, 'user', 'Q1', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'R1', '2024-01-01T00:01:00Z'),
        createMessage('C', 'B', 'user', 'Q2', '2024-01-01T00:02:00Z'),
        createMessage('D', 'C', 'assistant', 'R2', '2024-01-01T00:03:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: ['C'], // Exclude the user message before D
        pinnedMessageIds: [],
      };

      const result = resolveContext('D', map, config);

      // Should warn about D (assistant) without C (user)
      const coherenceWarning = result.warnings.find(w => w.type === 'ASSISTANT_WITHOUT_USER');
      expect(coherenceWarning).toBeDefined();
      expect(coherenceWarning?.relatedMessageId).toBe('D');
    });

    it('does not warn when assistant parent is not a user', () => {
      // Tree: A (system) -> B (assistant) - unusual but valid
      const messages = [
        createMessage('A', null, 'system', 'System prompt', '2024-01-01T00:00:00Z'),
        createMessage('B', 'A', 'assistant', 'Response', '2024-01-01T00:01:00Z'),
      ];
      const map = createMessageMap(messages);
      const config: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: ['A'],
        pinnedMessageIds: [],
      };

      const result = resolveContext('B', map, config);

      // Should not warn (parent is system, not user)
      const coherenceWarning = result.warnings.find(w => w.type === 'ASSISTANT_WITHOUT_USER');
      expect(coherenceWarning).toBeUndefined();
    });
  });
});

describe('createDefaultContextConfig', () => {
  it('returns default configuration', () => {
    const config = createDefaultContextConfig();

    expect(config.startFromMessageId).toBeNull();
    expect(config.excludedMessageIds).toEqual([]);
    expect(config.pinnedMessageIds).toEqual([]);
  });
});

describe('isMessageOnPath', () => {
  it('returns true for message on path', () => {
    const messages = [
      createMessage('A', null),
      createMessage('B', 'A'),
      createMessage('C', 'B'),
    ];
    const map = createMessageMap(messages);

    expect(isMessageOnPath('A', 'C', map)).toBe(true);
    expect(isMessageOnPath('B', 'C', map)).toBe(true);
    expect(isMessageOnPath('C', 'C', map)).toBe(true);
  });

  it('returns false for message not on path', () => {
    // Tree: A -> B and A -> C
    const messages = [
      createMessage('A', null),
      createMessage('B', 'A'),
      createMessage('C', 'A'),
    ];
    const map = createMessageMap(messages);

    expect(isMessageOnPath('C', 'B', map)).toBe(false);
    expect(isMessageOnPath('B', 'C', map)).toBe(false);
  });
});

describe('searchMessages', () => {
  it('finds messages containing query (case-insensitive)', () => {
    const messages = [
      createMessage('A', null, 'user', 'Hello world', '2024-01-01T00:00:00Z'),
      createMessage('B', 'A', 'assistant', 'HELLO there', '2024-01-01T00:01:00Z'),
      createMessage('C', 'B', 'user', 'Goodbye', '2024-01-01T00:02:00Z'),
    ];
    const map = createMessageMap(messages);

    const results = searchMessages('hello', map);

    expect(results).toHaveLength(2);
    // Should be sorted newest first
    expect(results.map(m => m.id)).toEqual(['B', 'A']);
  });

  it('returns empty for empty query', () => {
    const messages = [createMessage('A', null, 'user', 'Hello')];
    const map = createMessageMap(messages);

    expect(searchMessages('', map)).toHaveLength(0);
    expect(searchMessages('   ', map)).toHaveLength(0);
  });

  it('respects limit parameter', () => {
    const messages = Array.from({ length: 30 }, (_, i) =>
      createMessage(`${i}`, i === 0 ? null : `${i - 1}`, 'user', 'Hello', `2024-01-01T00:${String(i).padStart(2, '0')}:00Z`)
    );
    const map = createMessageMap(messages);

    const results = searchMessages('Hello', map, 5);

    expect(results).toHaveLength(5);
  });

  it('returns empty when no matches', () => {
    const messages = [createMessage('A', null, 'user', 'Hello')];
    const map = createMessageMap(messages);

    expect(searchMessages('xyz', map)).toHaveLength(0);
  });
});
