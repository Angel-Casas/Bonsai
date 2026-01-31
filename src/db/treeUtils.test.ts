/**
 * Unit tests for pure tree utilities
 * These tests use in-memory data structures only (no IndexedDB)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from './types';
import {
  getAncestors,
  getPathToRoot,
  getDescendants,
  getSubtree,
  getSubtreeIds,
  getChildren,
  hasChildren,
  getSiblings,
  getDepth,
  isAncestor,
  isDescendant,
  getRoots,
  getLeaves,
  getBranchPoints,
  getVariantsOf,
  isVariantOf,
  getOriginalOfVariant,
  buildChildrenMap,
  validateParent,
} from './treeUtils';

/**
 * Helper to create test messages
 */
function createTestMessage(
  id: string,
  parentId: string | null,
  overrides: Partial<Message> = {}
): Message {
  return {
    id,
    conversationId: 'conv-1',
    parentId,
    role: 'user',
    content: `Message ${id}`,
    createdAt: new Date(Date.now() + parseInt(id.replace(/\D/g, '') || '0') * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a message map from an array of messages
 */
function buildMessageMap(messages: Message[]): Map<string, Message> {
  return new Map(messages.map((m) => [m.id, m]));
}

describe('treeUtils', () => {
  describe('getAncestors', () => {
    it('returns empty array for root message', () => {
      const messages = [createTestMessage('1', null)];
      const map = buildMessageMap(messages);

      const ancestors = getAncestors('1', map);
      expect(ancestors).toEqual([]);
    });

    it('returns empty array for non-existent message', () => {
      const map = new Map<string, Message>();

      const ancestors = getAncestors('nonexistent', map);
      expect(ancestors).toEqual([]);
    });

    it('returns ancestors in order: parent, grandparent, ..., root', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '2'),
        createTestMessage('4', '3'),
      ];
      const map = buildMessageMap(messages);

      const ancestors = getAncestors('4', map);
      expect(ancestors.map((m) => m.id)).toEqual(['3', '2', '1']);
    });

    it('handles orphaned messages gracefully', () => {
      const messages = [
        createTestMessage('2', '1'), // parent '1' doesn't exist
        createTestMessage('3', '2'),
      ];
      const map = buildMessageMap(messages);

      const ancestors = getAncestors('3', map);
      expect(ancestors.map((m) => m.id)).toEqual(['2']);
    });
  });

  describe('getPathToRoot', () => {
    it('returns single message for root', () => {
      const messages = [createTestMessage('1', null)];
      const map = buildMessageMap(messages);

      const path = getPathToRoot('1', map);
      expect(path.map((m) => m.id)).toEqual(['1']);
    });

    it('returns empty array for non-existent message', () => {
      const map = new Map<string, Message>();

      const path = getPathToRoot('nonexistent', map);
      expect(path).toEqual([]);
    });

    it('returns path in chronological order: root, ..., parent, message', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '2'),
        createTestMessage('4', '3'),
      ];
      const map = buildMessageMap(messages);

      const path = getPathToRoot('4', map);
      expect(path.map((m) => m.id)).toEqual(['1', '2', '3', '4']);
    });
  });

  describe('getDescendants', () => {
    it('returns empty array for leaf message', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
      ];
      const map = buildMessageMap(messages);

      const descendants = getDescendants('2', map);
      expect(descendants).toEqual([]);
    });

    it('returns all descendants in BFS order', () => {
      // Tree structure:
      //     1
      //    / \
      //   2   3
      //  / \
      // 4   5
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '1'),
        createTestMessage('4', '2'),
        createTestMessage('5', '2'),
      ];
      const map = buildMessageMap(messages);

      const descendants = getDescendants('1', map);
      expect(descendants.map((m) => m.id)).toEqual(['2', '3', '4', '5']);
    });
  });

  describe('getSubtree', () => {
    it('returns empty array for non-existent message', () => {
      const map = new Map<string, Message>();

      const subtree = getSubtree('nonexistent', map);
      expect(subtree).toEqual([]);
    });

    it('includes root and all descendants', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '2'),
      ];
      const map = buildMessageMap(messages);

      const subtree = getSubtree('1', map);
      expect(subtree.map((m) => m.id)).toEqual(['1', '2', '3']);
    });
  });

  describe('getSubtreeIds', () => {
    it('returns all IDs in subtree', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '2'),
      ];
      const map = buildMessageMap(messages);

      const ids = getSubtreeIds('1', map);
      expect(ids).toEqual(['1', '2', '3']);
    });
  });

  describe('getChildren', () => {
    it('returns empty array for leaf message', () => {
      const messages = [createTestMessage('1', null)];
      const map = buildMessageMap(messages);

      const children = getChildren('1', map);
      expect(children).toEqual([]);
    });

    it('returns direct children only, sorted by createdAt', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '1'),
        createTestMessage('4', '2'),
      ];
      const map = buildMessageMap(messages);

      const children = getChildren('1', map);
      expect(children.map((m) => m.id)).toEqual(['2', '3']);
    });
  });

  describe('hasChildren', () => {
    it('returns false for leaf message', () => {
      const messages = [createTestMessage('1', null)];
      const map = buildMessageMap(messages);

      expect(hasChildren('1', map)).toBe(false);
    });

    it('returns true for parent message', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
      ];
      const map = buildMessageMap(messages);

      expect(hasChildren('1', map)).toBe(true);
    });
  });

  describe('getSiblings', () => {
    it('returns empty array for only child', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
      ];
      const map = buildMessageMap(messages);

      expect(getSiblings('2', map)).toEqual([]);
    });

    it('returns sibling messages (excluding self)', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '1'),
        createTestMessage('4', '1'),
      ];
      const map = buildMessageMap(messages);

      const siblings = getSiblings('2', map);
      expect(siblings.map((m) => m.id)).toEqual(['3', '4']);
    });
  });

  describe('getDepth', () => {
    it('returns 0 for root message', () => {
      const messages = [createTestMessage('1', null)];
      const map = buildMessageMap(messages);

      expect(getDepth('1', map)).toBe(0);
    });

    it('returns correct depth for nested message', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '2'),
        createTestMessage('4', '3'),
      ];
      const map = buildMessageMap(messages);

      expect(getDepth('4', map)).toBe(3);
    });
  });

  describe('isAncestor', () => {
    it('returns true if message is ancestor', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '2'),
      ];
      const map = buildMessageMap(messages);

      expect(isAncestor('1', '3', map)).toBe(true);
      expect(isAncestor('2', '3', map)).toBe(true);
    });

    it('returns false if message is not ancestor', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '1'),
      ];
      const map = buildMessageMap(messages);

      expect(isAncestor('2', '3', map)).toBe(false);
      expect(isAncestor('3', '2', map)).toBe(false);
    });
  });

  describe('isDescendant', () => {
    it('returns true if message is descendant', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '2'),
      ];
      const map = buildMessageMap(messages);

      expect(isDescendant('3', '1', map)).toBe(true);
      expect(isDescendant('2', '1', map)).toBe(true);
    });

    it('returns false if message is not descendant', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '1'),
      ];
      const map = buildMessageMap(messages);

      expect(isDescendant('2', '3', map)).toBe(false);
    });
  });

  describe('getRoots', () => {
    it('returns all root messages', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', null),
        createTestMessage('3', '1'),
      ];
      const map = buildMessageMap(messages);

      const roots = getRoots(map);
      expect(roots.map((m) => m.id)).toEqual(['1', '2']);
    });
  });

  describe('getLeaves', () => {
    it('returns all leaf messages', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '1'),
        createTestMessage('4', '2'),
      ];
      const map = buildMessageMap(messages);

      const leaves = getLeaves(map);
      expect(leaves.map((m) => m.id)).toEqual(['3', '4']);
    });
  });

  describe('getBranchPoints', () => {
    it('returns empty array for linear tree', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '2'),
      ];
      const map = buildMessageMap(messages);

      expect(getBranchPoints(map)).toEqual([]);
    });

    it('returns messages with multiple children', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '1'),
        createTestMessage('4', '2'),
        createTestMessage('5', '2'),
      ];
      const map = buildMessageMap(messages);

      const branchPoints = getBranchPoints(map);
      expect(branchPoints.map((m) => m.id)).toEqual(['1', '2']);
    });
  });

  describe('variant utilities', () => {
    let messages: Message[];
    let map: Map<string, Message>;

    beforeEach(() => {
      messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '1', { variantOfMessageId: '2' }),
        createTestMessage('4', '1', { variantOfMessageId: '2' }),
      ];
      map = buildMessageMap(messages);
    });

    describe('getVariantsOf', () => {
      it('returns all variants of a message', () => {
        const variants = getVariantsOf('2', map);
        expect(variants.map((m) => m.id)).toEqual(['3', '4']);
      });

      it('returns empty array if no variants', () => {
        const variants = getVariantsOf('1', map);
        expect(variants).toEqual([]);
      });
    });

    describe('isVariantOf', () => {
      it('returns true for variant message', () => {
        const variant = map.get('3')!;
        expect(isVariantOf(variant, '2')).toBe(true);
      });

      it('returns false for non-variant message', () => {
        const msg = map.get('2')!;
        expect(isVariantOf(msg, '1')).toBe(false);
      });
    });

    describe('getOriginalOfVariant', () => {
      it('returns original message for variant', () => {
        const original = getOriginalOfVariant('3', map);
        expect(original?.id).toBe('2');
      });

      it('returns undefined for non-variant', () => {
        const original = getOriginalOfVariant('2', map);
        expect(original).toBeUndefined();
      });
    });
  });

  describe('buildChildrenMap', () => {
    it('builds correct parent-to-children mapping', () => {
      const messages = [
        createTestMessage('1', null),
        createTestMessage('2', '1'),
        createTestMessage('3', '1'),
        createTestMessage('4', '2'),
      ];
      const map = buildMessageMap(messages);

      const childrenMap = buildChildrenMap(map);

      expect(childrenMap.get('1')?.map((m) => m.id)).toEqual(['2', '3']);
      expect(childrenMap.get('2')?.map((m) => m.id)).toEqual(['4']);
      expect(childrenMap.has('3')).toBe(false);
      expect(childrenMap.has('4')).toBe(false);
    });
  });

  describe('validateParent', () => {
    it('succeeds for null parent', () => {
      const map = new Map<string, Message>();
      const result = validateParent(null, map);
      expect(result.success).toBe(true);
    });

    it('succeeds for existing parent', () => {
      const messages = [createTestMessage('1', null)];
      const map = buildMessageMap(messages);

      const result = validateParent('1', map);
      expect(result.success).toBe(true);
    });

    it('fails for non-existent parent', () => {
      const map = new Map<string, Message>();

      const result = validateParent('nonexistent', map);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('nonexistent');
      }
    });
  });
});
