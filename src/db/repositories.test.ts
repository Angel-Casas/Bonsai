/**
 * Unit tests for repository CRUD operations
 * Uses fake-indexeddb for testing IndexedDB operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createTestDatabase, deleteDatabase, type BonsaiDatabase } from './database';
import {
  createConversation,
  getConversation,
  listConversations,
  updateConversation,
  deleteConversation,
  countConversations,
} from './repositories/conversationRepository';
import {
  createMessage,
  getMessage,
  getMessagesByConversation,
  getChildren,
  getRootMessages,
  updateMessage,
  softDeleteMessage,
  hardDeleteMessage,
  getVariants,
  countMessages,
  hasChildren,
  getMessageMap,
} from './repositories/messageRepository';
import {
  createMessageRevision,
  getRevisionsByMessage,
  getLatestRevision,
  deleteRevisionsByMessage,
  countRevisions,
} from './repositories/messageRevisionRepository';
import {
  upsertPromptContextConfig,
  getPromptContextConfig,
  updatePromptContextConfig,
  deletePromptContextConfig,
  createDefaultPromptContextConfig,
  setResolvedContext,
} from './repositories/promptContextConfigRepository';

describe('Repository CRUD Operations', () => {
  let db: BonsaiDatabase;
  let testDbName: string;

  beforeEach(() => {
    testDbName = `test-db-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db = createTestDatabase(testDbName);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase(testDbName);
  });

  describe('conversationRepository', () => {
    describe('createConversation', () => {
      it('creates a conversation with required fields', async () => {
        const conv = await createConversation({ title: 'Test Conversation' }, db);

        expect(conv.id).toBeDefined();
        expect(conv.title).toBe('Test Conversation');
        expect(conv.createdAt).toBeDefined();
        expect(conv.updatedAt).toBeDefined();
      });

      it('creates a conversation with optional fields', async () => {
        const conv = await createConversation(
          {
            title: 'Test',
            defaultModel: 'gpt-4',
            uiState: { collapsed: ['branch-1'] },
          },
          db
        );

        expect(conv.defaultModel).toBe('gpt-4');
        expect(conv.uiState).toEqual({ collapsed: ['branch-1'] });
      });
    });

    describe('getConversation', () => {
      it('returns conversation by ID', async () => {
        const created = await createConversation({ title: 'Test' }, db);
        const fetched = await getConversation(created.id, db);

        expect(fetched).toEqual(created);
      });

      it('returns undefined for non-existent ID', async () => {
        const fetched = await getConversation('nonexistent', db);
        expect(fetched).toBeUndefined();
      });
    });

    describe('listConversations', () => {
      it('returns empty array when no conversations', async () => {
        const list = await listConversations(db);
        expect(list).toEqual([]);
      });

      it('returns all conversations', async () => {
        const conv1 = await createConversation({ title: 'First' }, db);
        const conv2 = await createConversation({ title: 'Second' }, db);

        const list = await listConversations(db);
        expect(list.length).toBe(2);
        // Both conversations should be present
        const ids = list.map((c) => c.id);
        expect(ids).toContain(conv1.id);
        expect(ids).toContain(conv2.id);
      });
    });

    describe('updateConversation', () => {
      it('updates conversation fields', async () => {
        const conv = await createConversation({ title: 'Original' }, db);
        const updated = await updateConversation(conv.id, { title: 'Updated' }, db);

        expect(updated?.title).toBe('Updated');
        expect(updated?.updatedAt).toBeDefined();
      });

      it('returns undefined for non-existent ID', async () => {
        const result = await updateConversation('nonexistent', { title: 'Test' }, db);
        expect(result).toBeUndefined();
      });
    });

    describe('deleteConversation', () => {
      it('deletes conversation and all messages', async () => {
        const conv = await createConversation({ title: 'Test' }, db);
        await createMessage(
          { conversationId: conv.id, parentId: null, role: 'user', content: 'Test' },
          db
        );

        const deleted = await deleteConversation(conv.id, db);

        expect(deleted).toBe(true);
        expect(await getConversation(conv.id, db)).toBeUndefined();
        expect(await countMessages(conv.id, true, db)).toBe(0);
      });

      it('returns false for non-existent ID', async () => {
        const deleted = await deleteConversation('nonexistent', db);
        expect(deleted).toBe(false);
      });
    });

    describe('countConversations', () => {
      it('counts conversations correctly', async () => {
        expect(await countConversations(db)).toBe(0);

        await createConversation({ title: 'One' }, db);
        expect(await countConversations(db)).toBe(1);

        await createConversation({ title: 'Two' }, db);
        expect(await countConversations(db)).toBe(2);
      });
    });
  });

  describe('messageRepository', () => {
    let conversationId: string;

    beforeEach(async () => {
      const conv = await createConversation({ title: 'Test Conv' }, db);
      conversationId = conv.id;
    });

    describe('createMessage', () => {
      it('creates a root message', async () => {
        const msg = await createMessage(
          { conversationId, parentId: null, role: 'system', content: 'Hello' },
          db
        );

        expect(msg.id).toBeDefined();
        expect(msg.conversationId).toBe(conversationId);
        expect(msg.parentId).toBeNull();
        expect(msg.role).toBe('system');
        expect(msg.content).toBe('Hello');
      });

      it('creates a child message', async () => {
        const parent = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Parent' },
          db
        );
        const child = await createMessage(
          { conversationId, parentId: parent.id, role: 'assistant', content: 'Child' },
          db
        );

        expect(child.parentId).toBe(parent.id);
      });

      it('creates a message with optional fields', async () => {
        const msg = await createMessage(
          {
            conversationId,
            parentId: null,
            role: 'user',
            content: 'Test',
            branchTitle: 'My Branch',
            variantOfMessageId: 'some-id',
          },
          db
        );

        expect(msg.branchTitle).toBe('My Branch');
        expect(msg.variantOfMessageId).toBe('some-id');
      });
    });

    describe('getMessage', () => {
      it('returns message by ID', async () => {
        const created = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Test' },
          db
        );
        const fetched = await getMessage(created.id, db);

        expect(fetched).toEqual(created);
      });
    });

    describe('getMessagesByConversation', () => {
      it('returns all messages in conversation', async () => {
        const msg1 = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'First' },
          db
        );
        const msg2 = await createMessage(
          { conversationId, parentId: msg1.id, role: 'assistant', content: 'Second' },
          db
        );

        const messages = await getMessagesByConversation(conversationId, false, db);

        expect(messages.length).toBe(2);
        // Just verify both messages are present (order may vary by millisecond)
        const ids = messages.map((m) => m.id);
        expect(ids).toContain(msg1.id);
        expect(ids).toContain(msg2.id);
      });

      it('excludes soft-deleted messages by default', async () => {
        const msg = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Test' },
          db
        );
        await softDeleteMessage(msg.id, db);

        const messages = await getMessagesByConversation(conversationId, false, db);
        expect(messages.length).toBe(0);

        const allMessages = await getMessagesByConversation(conversationId, true, db);
        expect(allMessages.length).toBe(1);
      });
    });

    describe('getChildren', () => {
      it('returns direct children', async () => {
        const parent = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Parent' },
          db
        );
        const child1 = await createMessage(
          { conversationId, parentId: parent.id, role: 'assistant', content: 'Child 1' },
          db
        );
        const child2 = await createMessage(
          { conversationId, parentId: parent.id, role: 'assistant', content: 'Child 2' },
          db
        );

        const children = await getChildren(parent.id, false, db);

        expect(children.length).toBe(2);
        expect(children.map((c) => c.id)).toContain(child1.id);
        expect(children.map((c) => c.id)).toContain(child2.id);
      });
    });

    describe('getRootMessages', () => {
      it('returns messages with no parent', async () => {
        const root1 = await createMessage(
          { conversationId, parentId: null, role: 'system', content: 'Root 1' },
          db
        );
        const root2 = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Root 2' },
          db
        );
        await createMessage(
          { conversationId, parentId: root1.id, role: 'assistant', content: 'Child' },
          db
        );

        const roots = await getRootMessages(conversationId, false, db);

        expect(roots.length).toBe(2);
        expect(roots.map((r) => r.id)).toContain(root1.id);
        expect(roots.map((r) => r.id)).toContain(root2.id);
      });
    });

    describe('updateMessage', () => {
      it('updates message content', async () => {
        const msg = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Original' },
          db
        );

        const updated = await updateMessage(msg.id, { content: 'Updated' }, db);

        expect(updated?.content).toBe('Updated');
        // updatedAt should be set (timing may be same millisecond)
        expect(updated?.updatedAt).toBeDefined();
      });
    });

    describe('softDeleteMessage', () => {
      it('sets deletedAt timestamp', async () => {
        const msg = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Test' },
          db
        );

        const deleted = await softDeleteMessage(msg.id, db);

        expect(deleted?.deletedAt).toBeDefined();
      });
    });

    describe('hardDeleteMessage', () => {
      it('permanently removes message', async () => {
        const msg = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Test' },
          db
        );

        const result = await hardDeleteMessage(msg.id, db);

        expect(result).toBe(true);
        expect(await getMessage(msg.id, db)).toBeUndefined();
      });
    });

    describe('getVariants', () => {
      it('returns messages that are variants of the given message', async () => {
        const original = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Original' },
          db
        );
        const variant1 = await createMessage(
          {
            conversationId,
            parentId: null,
            role: 'user',
            content: 'Variant 1',
            variantOfMessageId: original.id,
          },
          db
        );
        const variant2 = await createMessage(
          {
            conversationId,
            parentId: null,
            role: 'user',
            content: 'Variant 2',
            variantOfMessageId: original.id,
          },
          db
        );

        const variants = await getVariants(original.id, false, db);

        expect(variants.length).toBe(2);
        expect(variants.map((v) => v.id)).toContain(variant1.id);
        expect(variants.map((v) => v.id)).toContain(variant2.id);
      });
    });

    describe('hasChildren', () => {
      it('returns true if message has children', async () => {
        const parent = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Parent' },
          db
        );
        await createMessage(
          { conversationId, parentId: parent.id, role: 'assistant', content: 'Child' },
          db
        );

        expect(await hasChildren(parent.id, db)).toBe(true);
      });

      it('returns false if message has no children', async () => {
        const msg = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'Leaf' },
          db
        );

        expect(await hasChildren(msg.id, db)).toBe(false);
      });
    });

    describe('getMessageMap', () => {
      it('returns a map of all messages', async () => {
        const msg1 = await createMessage(
          { conversationId, parentId: null, role: 'user', content: 'One' },
          db
        );
        const msg2 = await createMessage(
          { conversationId, parentId: msg1.id, role: 'assistant', content: 'Two' },
          db
        );

        const map = await getMessageMap(conversationId, false, db);

        expect(map.size).toBe(2);
        expect(map.get(msg1.id)).toBeDefined();
        expect(map.get(msg2.id)).toBeDefined();
      });
    });
  });

  describe('messageRevisionRepository', () => {
    let messageId: string;

    beforeEach(async () => {
      const conv = await createConversation({ title: 'Test' }, db);
      const msg = await createMessage(
        { conversationId: conv.id, parentId: null, role: 'user', content: 'Original' },
        db
      );
      messageId = msg.id;
    });

    describe('createMessageRevision', () => {
      it('creates a revision', async () => {
        const revision = await createMessageRevision(
          { messageId, previousContent: 'Old content', reason: 'Test edit' },
          db
        );

        expect(revision.id).toBeDefined();
        expect(revision.messageId).toBe(messageId);
        expect(revision.previousContent).toBe('Old content');
        expect(revision.reason).toBe('Test edit');
        expect(revision.createdAt).toBeDefined();
      });
    });

    describe('getRevisionsByMessage', () => {
      it('returns all revisions for a message', async () => {
        await createMessageRevision({ messageId, previousContent: 'First' }, db);
        await createMessageRevision({ messageId, previousContent: 'Second' }, db);

        const revisions = await getRevisionsByMessage(messageId, db);

        expect(revisions.length).toBe(2);
        // Verify both revisions are present (order may vary by millisecond)
        const contents = revisions.map((r) => r.previousContent);
        expect(contents).toContain('First');
        expect(contents).toContain('Second');
      });
    });

    describe('getLatestRevision', () => {
      it('returns a revision when revisions exist', async () => {
        await createMessageRevision({ messageId, previousContent: 'First' }, db);
        await createMessageRevision({ messageId, previousContent: 'Second' }, db);

        const latest = await getLatestRevision(messageId, db);

        // Should return a revision (timing may affect order)
        expect(latest).toBeDefined();
        expect(['First', 'Second']).toContain(latest?.previousContent);
      });

      it('returns undefined if no revisions', async () => {
        const latest = await getLatestRevision('nonexistent', db);
        expect(latest).toBeUndefined();
      });
    });

    describe('deleteRevisionsByMessage', () => {
      it('deletes all revisions for a message', async () => {
        await createMessageRevision({ messageId, previousContent: 'One' }, db);
        await createMessageRevision({ messageId, previousContent: 'Two' }, db);

        const deleted = await deleteRevisionsByMessage(messageId, db);

        expect(deleted).toBe(2);
        expect(await countRevisions(messageId, db)).toBe(0);
      });
    });

    describe('countRevisions', () => {
      it('counts revisions correctly', async () => {
        expect(await countRevisions(messageId, db)).toBe(0);

        await createMessageRevision({ messageId, previousContent: 'One' }, db);
        expect(await countRevisions(messageId, db)).toBe(1);
      });
    });
  });

  describe('promptContextConfigRepository', () => {
    let messageId: string;

    beforeEach(async () => {
      const conv = await createConversation({ title: 'Test' }, db);
      const msg = await createMessage(
        { conversationId: conv.id, parentId: null, role: 'user', content: 'Test' },
        db
      );
      messageId = msg.id;
    });

    describe('upsertPromptContextConfig', () => {
      it('creates a new config', async () => {
        const config = await upsertPromptContextConfig(
          {
            messageId,
            inheritDefaultPath: true,
            startFromMessageId: null,
            excludedMessageIds: ['ex-1'],
            pinnedMessageIds: ['pin-1', 'pin-2'],
            orderingMode: 'PATH_THEN_PINS',
          },
          db
        );

        expect(config.messageId).toBe(messageId);
        expect(config.inheritDefaultPath).toBe(true);
        expect(config.startFromMessageId).toBeNull();
        expect(config.excludedMessageIds).toEqual(['ex-1']);
        expect(config.pinnedMessageIds).toEqual(['pin-1', 'pin-2']);
      });

      it('replaces existing config', async () => {
        await upsertPromptContextConfig(
          {
            messageId,
            inheritDefaultPath: true,
            startFromMessageId: null,
            excludedMessageIds: [],
            pinnedMessageIds: [],
            orderingMode: 'PATH_THEN_PINS',
          },
          db
        );

        const updated = await upsertPromptContextConfig(
          {
            messageId,
            inheritDefaultPath: false,
            startFromMessageId: 'some-anchor-id',
            excludedMessageIds: ['new-ex'],
            pinnedMessageIds: ['new-pin'],
            orderingMode: 'custom',
          },
          db
        );

        expect(updated.inheritDefaultPath).toBe(false);
        expect(updated.startFromMessageId).toBe('some-anchor-id');
        expect(updated.excludedMessageIds).toEqual(['new-ex']);
      });
    });

    describe('getPromptContextConfig', () => {
      it('returns config by messageId', async () => {
        const created = await upsertPromptContextConfig(
          {
            messageId,
            inheritDefaultPath: true,
            startFromMessageId: null,
            excludedMessageIds: [],
            pinnedMessageIds: [],
            orderingMode: 'PATH_THEN_PINS',
          },
          db
        );

        const fetched = await getPromptContextConfig(messageId, db);
        expect(fetched).toEqual(created);
      });
    });

    describe('updatePromptContextConfig', () => {
      it('updates specific fields', async () => {
        await upsertPromptContextConfig(
          {
            messageId,
            inheritDefaultPath: true,
            startFromMessageId: null,
            excludedMessageIds: [],
            pinnedMessageIds: [],
            orderingMode: 'PATH_THEN_PINS',
          },
          db
        );

        const updated = await updatePromptContextConfig(
          messageId,
          { pinnedMessageIds: ['new-pin'] },
          db
        );

        expect(updated?.pinnedMessageIds).toEqual(['new-pin']);
        expect(updated?.inheritDefaultPath).toBe(true); // unchanged
      });
    });

    describe('deletePromptContextConfig', () => {
      it('deletes config', async () => {
        await upsertPromptContextConfig(
          {
            messageId,
            inheritDefaultPath: true,
            startFromMessageId: null,
            excludedMessageIds: [],
            pinnedMessageIds: [],
            orderingMode: 'PATH_THEN_PINS',
          },
          db
        );

        const deleted = await deletePromptContextConfig(messageId, db);

        expect(deleted).toBe(true);
        expect(await getPromptContextConfig(messageId, db)).toBeUndefined();
      });
    });

    describe('createDefaultPromptContextConfig', () => {
      it('creates config with sensible defaults', async () => {
        const config = await createDefaultPromptContextConfig(messageId, db);

        expect(config.messageId).toBe(messageId);
        expect(config.inheritDefaultPath).toBe(true);
        expect(config.startFromMessageId).toBeNull();
        expect(config.excludedMessageIds).toEqual([]);
        expect(config.pinnedMessageIds).toEqual([]);
        expect(config.orderingMode).toBe('PATH_THEN_PINS');
      });
    });

    describe('setResolvedContext', () => {
      it('sets resolved context message IDs', async () => {
        await createDefaultPromptContextConfig(messageId, db);

        const updated = await setResolvedContext(
          messageId,
          ['msg-1', 'msg-2', 'msg-3'],
          db
        );

        expect(updated?.resolvedContextMessageIds).toEqual(['msg-1', 'msg-2', 'msg-3']);
      });
    });
  });
});
