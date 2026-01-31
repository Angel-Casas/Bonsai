/**
 * Integration tests for tree operations
 * Tests the DB-integrated tree operations that combine pure utilities with repositories
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createTestDatabase, deleteDatabase, type BonsaiDatabase } from './database';
import { createConversation } from './repositories/conversationRepository';
import { createMessage, getMessage, getMessagesByConversation } from './repositories/messageRepository';
import { getRevisionsByMessage } from './repositories/messageRevisionRepository';
import {
  createBranch,
  createVariant,
  editMessageInPlace,
  deleteSubtree,
  softDeleteSubtree,
  getPathToMessage,
  getAncestors,
  getDescendants,
  hasDescendants,
  getVariants,
} from './treeOperations';

describe('Tree Operations', () => {
  let db: BonsaiDatabase;
  let testDbName: string;
  let conversationId: string;

  beforeEach(async () => {
    testDbName = `test-db-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db = createTestDatabase(testDbName);

    const conv = await createConversation({ title: 'Test Conversation' }, db);
    conversationId = conv.id;
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase(testDbName);
  });

  describe('createBranch', () => {
    it('creates a new message as child of specified parent', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'system', content: 'System prompt' },
        db
      );

      const result = await createBranch(
        {
          fromMessageId: root.id,
          content: 'New branch message',
          branchTitle: 'Test Branch',
        },
        db
      );

      expect(result.message.parentId).toBe(root.id);
      expect(result.message.content).toBe('New branch message');
      expect(result.message.branchTitle).toBe('Test Branch');
      expect(result.parent.id).toBe(root.id);
    });

    it('throws error for non-existent parent', async () => {
      await expect(
        createBranch(
          { fromMessageId: 'nonexistent', content: 'Test' },
          db
        )
      ).rejects.toThrow('Parent message not found');
    });

    it('inherits conversationId from parent', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Root' },
        db
      );

      const result = await createBranch(
        { fromMessageId: root.id, content: 'Child' },
        db
      );

      expect(result.message.conversationId).toBe(conversationId);
    });

    it('defaults role to user', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'system', content: 'System' },
        db
      );

      const result = await createBranch(
        { fromMessageId: root.id, content: 'User message' },
        db
      );

      expect(result.message.role).toBe('user');
    });

    it('allows specifying role', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'User' },
        db
      );

      const result = await createBranch(
        { fromMessageId: root.id, content: 'Assistant response', role: 'assistant' },
        db
      );

      expect(result.message.role).toBe('assistant');
    });
  });

  describe('createVariant', () => {
    it('creates a sibling message with variantOfMessageId set', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Parent' },
        db
      );
      const original = await createMessage(
        { conversationId, parentId: root.id, role: 'assistant', content: 'Original' },
        db
      );

      const variant = await createVariant(
        {
          originalMessageId: original.id,
          content: 'Edited version',
          branchTitle: 'Edit Branch',
        },
        db
      );

      expect(variant.parentId).toBe(root.id); // Same parent as original
      expect(variant.variantOfMessageId).toBe(original.id);
      expect(variant.content).toBe('Edited version');
      expect(variant.role).toBe('assistant'); // Same role as original
    });

    it('throws error for non-existent original', async () => {
      await expect(
        createVariant(
          { originalMessageId: 'nonexistent', content: 'Test' },
          db
        )
      ).rejects.toThrow('Original message not found');
    });
  });

  describe('editMessageInPlace', () => {
    it('updates message content and creates revision', async () => {
      const msg = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Original content' },
        db
      );

      const updated = await editMessageInPlace(
        {
          messageId: msg.id,
          newContent: 'Updated content',
          reason: 'Test edit',
        },
        db
      );

      expect(updated.content).toBe('Updated content');
      // updatedAt should be set (timing may be same millisecond in fast test environments)
      expect(updated.updatedAt).toBeDefined();

      // Check revision was created
      const revisions = await getRevisionsByMessage(msg.id, db);
      expect(revisions.length).toBe(1);
      expect(revisions[0]?.previousContent).toBe('Original content');
      expect(revisions[0]?.reason).toBe('Test edit');
    });

    it('throws error for non-existent message', async () => {
      await expect(
        editMessageInPlace(
          { messageId: 'nonexistent', newContent: 'Test' },
          db
        )
      ).rejects.toThrow('Message not found');
    });

    it('creates multiple revisions for multiple edits', async () => {
      const msg = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'V1' },
        db
      );

      await editMessageInPlace({ messageId: msg.id, newContent: 'V2' }, db);
      await editMessageInPlace({ messageId: msg.id, newContent: 'V3' }, db);

      const revisions = await getRevisionsByMessage(msg.id, db);
      expect(revisions.length).toBe(2);
      // Check both revisions exist (order may vary due to same-millisecond timing)
      const previousContents = revisions.map((r) => r.previousContent);
      expect(previousContents).toContain('V1');
      expect(previousContents).toContain('V2');
    });
  });

  describe('deleteSubtree', () => {
    it('deletes message and all descendants', async () => {
      // Create tree: root -> child1 -> grandchild
      //                  -> child2
      const root = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Root' },
        db
      );
      const child1 = await createMessage(
        { conversationId, parentId: root.id, role: 'assistant', content: 'Child 1' },
        db
      );
      const child2 = await createMessage(
        { conversationId, parentId: root.id, role: 'assistant', content: 'Child 2' },
        db
      );
      const grandchild = await createMessage(
        { conversationId, parentId: child1.id, role: 'user', content: 'Grandchild' },
        db
      );

      // Delete child1 and its descendants
      const result = await deleteSubtree(child1.id, db);

      expect(result.deletedCount).toBe(2); // child1 + grandchild
      expect(result.deletedIds).toContain(child1.id);
      expect(result.deletedIds).toContain(grandchild.id);

      // Verify deleted
      expect(await getMessage(child1.id, db)).toBeUndefined();
      expect(await getMessage(grandchild.id, db)).toBeUndefined();

      // Verify not deleted
      expect(await getMessage(root.id, db)).toBeDefined();
      expect(await getMessage(child2.id, db)).toBeDefined();
    });

    it('returns empty result for non-existent message', async () => {
      const result = await deleteSubtree('nonexistent', db);

      expect(result.deletedCount).toBe(0);
      expect(result.deletedIds).toEqual([]);
    });

    it('deletes entire tree when deleting root', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Root' },
        db
      );
      await createMessage(
        { conversationId, parentId: root.id, role: 'assistant', content: 'Child' },
        db
      );

      const result = await deleteSubtree(root.id, db);

      expect(result.deletedCount).toBe(2);
      const messages = await getMessagesByConversation(conversationId, true, db);
      expect(messages.length).toBe(0);
    });
  });

  describe('softDeleteSubtree', () => {
    it('sets deletedAt on message and all descendants', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Root' },
        db
      );
      const child = await createMessage(
        { conversationId, parentId: root.id, role: 'assistant', content: 'Child' },
        db
      );

      const count = await softDeleteSubtree(root.id, db);

      expect(count).toBe(2);

      // Messages still exist but are soft deleted
      const rootAfter = await getMessage(root.id, db);
      const childAfter = await getMessage(child.id, db);

      expect(rootAfter?.deletedAt).toBeDefined();
      expect(childAfter?.deletedAt).toBeDefined();
    });
  });

  describe('getPathToMessage', () => {
    it('returns path from root to message', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'system', content: 'Root' },
        db
      );
      const child = await createMessage(
        { conversationId, parentId: root.id, role: 'user', content: 'Child' },
        db
      );
      const grandchild = await createMessage(
        { conversationId, parentId: child.id, role: 'assistant', content: 'Grandchild' },
        db
      );

      const path = await getPathToMessage(grandchild.id, db);

      expect(path.length).toBe(3);
      expect(path[0]?.id).toBe(root.id);
      expect(path[1]?.id).toBe(child.id);
      expect(path[2]?.id).toBe(grandchild.id);
    });

    it('returns empty array for non-existent message', async () => {
      const path = await getPathToMessage('nonexistent', db);
      expect(path).toEqual([]);
    });
  });

  describe('getAncestors', () => {
    it('returns ancestors from parent to root', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'system', content: 'Root' },
        db
      );
      const child = await createMessage(
        { conversationId, parentId: root.id, role: 'user', content: 'Child' },
        db
      );
      const grandchild = await createMessage(
        { conversationId, parentId: child.id, role: 'assistant', content: 'Grandchild' },
        db
      );

      const ancestors = await getAncestors(grandchild.id, db);

      expect(ancestors.length).toBe(2);
      expect(ancestors[0]?.id).toBe(child.id); // immediate parent first
      expect(ancestors[1]?.id).toBe(root.id); // then root
    });
  });

  describe('getDescendants', () => {
    it('returns all descendants', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Root' },
        db
      );
      const child1 = await createMessage(
        { conversationId, parentId: root.id, role: 'assistant', content: 'Child 1' },
        db
      );
      const child2 = await createMessage(
        { conversationId, parentId: root.id, role: 'assistant', content: 'Child 2' },
        db
      );
      const grandchild = await createMessage(
        { conversationId, parentId: child1.id, role: 'user', content: 'Grandchild' },
        db
      );

      const descendants = await getDescendants(root.id, db);

      expect(descendants.length).toBe(3);
      expect(descendants.map((d) => d.id)).toContain(child1.id);
      expect(descendants.map((d) => d.id)).toContain(child2.id);
      expect(descendants.map((d) => d.id)).toContain(grandchild.id);
    });
  });

  describe('hasDescendants', () => {
    it('returns true if message has children', async () => {
      const parent = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Parent' },
        db
      );
      await createMessage(
        { conversationId, parentId: parent.id, role: 'assistant', content: 'Child' },
        db
      );

      expect(await hasDescendants(parent.id, db)).toBe(true);
    });

    it('returns false if message has no children', async () => {
      const leaf = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Leaf' },
        db
      );

      expect(await hasDescendants(leaf.id, db)).toBe(false);
    });
  });

  describe('getVariants', () => {
    it('returns all variant messages', async () => {
      const original = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Original' },
        db
      );

      const variant1 = await createVariant(
        { originalMessageId: original.id, content: 'Variant 1' },
        db
      );
      const variant2 = await createVariant(
        { originalMessageId: original.id, content: 'Variant 2' },
        db
      );

      const variants = await getVariants(original.id, db);

      expect(variants.length).toBe(2);
      expect(variants.map((v) => v.id)).toContain(variant1.id);
      expect(variants.map((v) => v.id)).toContain(variant2.id);
    });
  });

  describe('branching invariants', () => {
    it('creating multiple branches from same message works correctly', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Root' },
        db
      );

      const branch1 = await createBranch(
        { fromMessageId: root.id, content: 'Branch 1', branchTitle: 'B1' },
        db
      );
      const branch2 = await createBranch(
        { fromMessageId: root.id, content: 'Branch 2', branchTitle: 'B2' },
        db
      );
      const branch3 = await createBranch(
        { fromMessageId: root.id, content: 'Branch 3', branchTitle: 'B3' },
        db
      );

      // All branches should have root as parent
      expect(branch1.message.parentId).toBe(root.id);
      expect(branch2.message.parentId).toBe(root.id);
      expect(branch3.message.parentId).toBe(root.id);

      // Root should have 3 children
      const descendants = await getDescendants(root.id, db);
      expect(descendants.length).toBe(3);
    });

    it('path includes all ancestors up to root', async () => {
      // Create deep tree
      const m1 = await createMessage(
        { conversationId, parentId: null, role: 'system', content: '1' },
        db
      );
      const m2 = await createMessage(
        { conversationId, parentId: m1.id, role: 'user', content: '2' },
        db
      );
      const m3 = await createMessage(
        { conversationId, parentId: m2.id, role: 'assistant', content: '3' },
        db
      );
      const m4 = await createMessage(
        { conversationId, parentId: m3.id, role: 'user', content: '4' },
        db
      );
      const m5 = await createMessage(
        { conversationId, parentId: m4.id, role: 'assistant', content: '5' },
        db
      );

      const path = await getPathToMessage(m5.id, db);

      expect(path.length).toBe(5);
      expect(path.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id, m4.id, m5.id]);
    });

    it('variant is correctly linked to original', async () => {
      const root = await createMessage(
        { conversationId, parentId: null, role: 'user', content: 'Root' },
        db
      );
      const original = await createMessage(
        { conversationId, parentId: root.id, role: 'assistant', content: 'Original response' },
        db
      );

      const variant = await createVariant(
        { originalMessageId: original.id, content: 'Better response' },
        db
      );

      // Variant should be sibling of original (same parent)
      expect(variant.parentId).toBe(original.parentId);
      expect(variant.parentId).toBe(root.id);

      // Variant should reference original
      expect(variant.variantOfMessageId).toBe(original.id);

      // Both should be children of root
      const descendants = await getDescendants(root.id, db);
      expect(descendants.length).toBe(2);
      expect(descendants.map((d) => d.id)).toContain(original.id);
      expect(descendants.map((d) => d.id)).toContain(variant.id);
    });
  });
});
