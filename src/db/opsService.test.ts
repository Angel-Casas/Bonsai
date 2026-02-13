/**
 * Unit tests for opsService — append-only operations log CRUD
 * Uses fake-indexeddb for testing IndexedDB operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { createTestDatabase, deleteDatabase, type BonsaiDatabase } from './database';
import {
  getOrCreateClientId,
  appendOp,
  getPendingOps,
  markAcked,
  getOpStats,
} from './opsService';

const CLIENT_ID_KEY = 'bonsai:sync:clientId';

describe('opsService', () => {
  let db: BonsaiDatabase;
  let testDbName: string;

  beforeEach(() => {
    testDbName = `test-ops-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db = createTestDatabase(testDbName);
    localStorage.removeItem(CLIENT_ID_KEY);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase(testDbName);
    localStorage.removeItem(CLIENT_ID_KEY);
  });

  // ==========================================================================
  // getOrCreateClientId
  // ==========================================================================

  describe('getOrCreateClientId', () => {
    it('generates a UUID on first call', () => {
      const id = getOrCreateClientId();
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('persists the client ID to localStorage', () => {
      const id = getOrCreateClientId();
      expect(localStorage.getItem(CLIENT_ID_KEY)).toBe(id);
    });

    it('returns the same ID on subsequent calls', () => {
      const first = getOrCreateClientId();
      const second = getOrCreateClientId();
      expect(first).toBe(second);
    });

    it('reads an existing ID from localStorage', () => {
      const existingId = 'pre-existing-client-id';
      localStorage.setItem(CLIENT_ID_KEY, existingId);
      const id = getOrCreateClientId();
      expect(id).toBe(existingId);
    });
  });

  // ==========================================================================
  // appendOp
  // ==========================================================================

  describe('appendOp', () => {
    it('creates an op with correct fields', async () => {
      const op = await appendOp(
        'conversation.create',
        { title: 'Hello' },
        'conv-123',
        db,
      );

      expect(op.id).toBeDefined();
      expect(op.type).toBe('conversation.create');
      expect(op.conversationId).toBe('conv-123');
      expect(op.status).toBe('pending');
      expect(op.schemaVersion).toBe(1);
      expect(op.clientId).toBe(getOrCreateClientId());
      expect(op.createdAt).toBeDefined();
      // Payload should be the JSON-serialized version
      expect(op.payload).toBe(JSON.stringify({ title: 'Hello' }));
    });

    it('stores null conversationId for global ops', async () => {
      const op = await appendOp(
        'import.completed',
        { count: 5 },
        undefined,
        db,
      );

      expect(op.conversationId).toBeNull();
    });

    it('persists the op to the database', async () => {
      const op = await appendOp(
        'message.create',
        { content: 'Hi' },
        'conv-1',
        db,
      );

      const stored = await db.syncOps.get(op.id);
      expect(stored).toBeDefined();
      expect(stored!.id).toBe(op.id);
      expect(stored!.type).toBe('message.create');
      expect(stored!.payload).toBe(JSON.stringify({ content: 'Hi' }));
    });

    it('sets payloadEnc to null when encryption is disabled', async () => {
      const op = await appendOp(
        'conversation.create',
        { title: 'test' },
        undefined,
        db,
      );

      expect(op.payloadEnc).toBeNull();
    });
  });

  // ==========================================================================
  // getPendingOps
  // ==========================================================================

  describe('getPendingOps', () => {
    it('returns only pending ops (not acked)', async () => {
      const op1 = await appendOp('conversation.create', { n: 1 }, undefined, db);
      const op2 = await appendOp('conversation.rename', { n: 2 }, undefined, db);
      // Mark op1 as acked
      await markAcked([op1.id], db);

      const pending = await getPendingOps(undefined, db);
      expect(pending.length).toBe(1);
      expect(pending[0]!.id).toBe(op2.id);
    });

    it('respects the limit parameter', async () => {
      await appendOp('conversation.create', { n: 1 }, undefined, db);
      await appendOp('conversation.rename', { n: 2 }, undefined, db);
      await appendOp('conversation.delete', { n: 3 }, undefined, db);

      const pending = await getPendingOps(2, db);
      expect(pending.length).toBe(2);
    });

    it('returns ops in deterministic order (createdAt ASC, id ASC)', async () => {
      // Insert several ops — they may share the same millisecond timestamp
      await appendOp('conversation.create', { n: 1 }, undefined, db);
      await appendOp('conversation.rename', { n: 2 }, undefined, db);
      await appendOp('conversation.delete', { n: 3 }, undefined, db);

      const pending = await getPendingOps(undefined, db);
      expect(pending.length).toBe(3);

      // Verify sort invariant: each op >= previous by (createdAt, id)
      for (let i = 1; i < pending.length; i++) {
        const prev = pending[i - 1]!;
        const curr = pending[i]!;
        const timeCmp = prev.createdAt.localeCompare(curr.createdAt);
        if (timeCmp === 0) {
          expect(prev.id.localeCompare(curr.id)).toBeLessThan(0);
        } else {
          expect(timeCmp).toBeLessThan(0);
        }
      }
    });

    it('returns empty array when no pending ops exist', async () => {
      const pending = await getPendingOps(undefined, db);
      expect(pending).toEqual([]);
    });
  });

  // ==========================================================================
  // markAcked
  // ==========================================================================

  describe('markAcked', () => {
    it('transitions status from pending to acked', async () => {
      const op = await appendOp('conversation.create', { n: 1 }, undefined, db);
      expect(op.status).toBe('pending');

      await markAcked([op.id], db);

      const stored = await db.syncOps.get(op.id);
      expect(stored!.status).toBe('acked');
    });

    it('handles multiple IDs at once', async () => {
      const op1 = await appendOp('conversation.create', { n: 1 }, undefined, db);
      const op2 = await appendOp('conversation.rename', { n: 2 }, undefined, db);
      const op3 = await appendOp('conversation.delete', { n: 3 }, undefined, db);

      await markAcked([op1.id, op3.id], db);

      const stored1 = await db.syncOps.get(op1.id);
      const stored2 = await db.syncOps.get(op2.id);
      const stored3 = await db.syncOps.get(op3.id);

      expect(stored1!.status).toBe('acked');
      expect(stored2!.status).toBe('pending');
      expect(stored3!.status).toBe('acked');
    });

    it('does nothing for non-existent IDs (no error)', async () => {
      // Should not throw
      await expect(markAcked(['non-existent-id'], db)).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // getOpStats
  // ==========================================================================

  describe('getOpStats', () => {
    it('returns correct pending count', async () => {
      await appendOp('conversation.create', { n: 1 }, undefined, db);
      await appendOp('conversation.rename', { n: 2 }, undefined, db);
      const op3 = await appendOp('conversation.delete', { n: 3 }, undefined, db);
      await markAcked([op3.id], db);

      const stats = await getOpStats(db);
      expect(stats.pendingCount).toBe(2);
    });

    it('returns latest op types (up to 5)', async () => {
      await appendOp('conversation.create', {}, undefined, db);
      await appendOp('conversation.rename', {}, undefined, db);
      await appendOp('message.create', {}, undefined, db);

      const stats = await getOpStats(db);
      expect(stats.latestTypes.length).toBe(3);
      // All three types should be present (order depends on createdAt which
      // may share the same millisecond in fast test execution)
      expect(stats.latestTypes).toContain('conversation.create');
      expect(stats.latestTypes).toContain('conversation.rename');
      expect(stats.latestTypes).toContain('message.create');
    });

    it('limits latest types to 5', async () => {
      await appendOp('conversation.create', {}, undefined, db);
      await appendOp('conversation.rename', {}, undefined, db);
      await appendOp('conversation.delete', {}, undefined, db);
      await appendOp('message.create', {}, undefined, db);
      await appendOp('message.edit', {}, undefined, db);
      await appendOp('message.deleteSubtree', {}, undefined, db);
      await appendOp('message.createVariant', {}, undefined, db);

      const stats = await getOpStats(db);
      expect(stats.latestTypes.length).toBe(5);
    });

    it('returns zero pending count when empty', async () => {
      const stats = await getOpStats(db);
      expect(stats.pendingCount).toBe(0);
      expect(stats.latestTypes).toEqual([]);
    });

    it('includes acked ops in latest types', async () => {
      const op = await appendOp('conversation.create', {}, undefined, db);
      await markAcked([op.id], db);

      const stats = await getOpStats(db);
      expect(stats.pendingCount).toBe(0);
      expect(stats.latestTypes).toContain('conversation.create');
    });
  });

  // ==========================================================================
  // Encryption at rest
  // ==========================================================================

  describe('encryption', () => {
    it('encrypts op payload at rest when encryption is enabled', async () => {
      const { enableEncryption, disableEncryption, isUnlocked } = await import('./encryption');

      // Enable encryption with test passphrase
      await enableEncryption('test-passphrase-12345', db);
      expect(isUnlocked()).toBe(true);

      try {
        const op = await appendOp(
          'message.create',
          { messageId: 'm1', content: 'secret message' },
          'conv-1',
          db
        );

        // Stored version should be encrypted
        const stored = await db.syncOps.get(op.id);
        expect(stored).toBeTruthy();
        expect(stored!.payload).toBe('');
        expect(stored!.payloadEnc).toBeTruthy();
        expect(stored!.payloadEnc!.ciphertext).toBeTruthy();
        expect(stored!.payloadEnc!.iv).toBeTruthy();

        // getPendingOps should decrypt transparently
        const pending = await getPendingOps(undefined, db);
        expect(pending).toHaveLength(1);
        const payload = JSON.parse(pending[0]!.payload);
        expect(payload.content).toBe('secret message');
        expect(payload.messageId).toBe('m1');
      } finally {
        await disableEncryption('test-passphrase-12345', db);
      }
    });
  });
});
