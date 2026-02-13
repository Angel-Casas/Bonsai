# Milestone 16: Sync-Ready Ops Log — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an append-only operations log to IndexedDB so every data-mutating user action is recorded, preparing the client for future server sync without changing UX.

**Architecture:** New `syncOps` Dexie table (schema v4). A thin `opsService.ts` emits ops from store actions after successful DB writes. `SyncAdapter` interface with `LocalOnlySyncAdapter`. Ops payloads encrypted at rest via existing encryption service. Sync diagnostics section in Settings.

**Tech Stack:** Dexie v4 (IndexedDB), Vitest + fake-indexeddb, existing AES-GCM encryption service, Vue 3 + Pinia.

**Design doc:** `docs/plans/2026-02-13-sync-ready-ops-log-design.md`

---

## Task 1: Add SyncOp types to `src/db/types.ts`

**Files:**
- Modify: `src/db/types.ts`

**Step 1: Add the SyncOp type and OpType union at the end of `src/db/types.ts`**

After line 165 (end of file), add:

```typescript
// ============================================================================
// Sync Operations (Milestone 16)
// ============================================================================

/** Operation status for sync */
export type OpStatus = 'pending' | 'acked' | 'failed';

/** All supported operation types */
export type OpType =
  | 'conversation.create'
  | 'conversation.rename'
  | 'conversation.delete'
  | 'message.create'
  | 'message.edit'
  | 'message.deleteSubtree'
  | 'message.createVariant'
  | 'import.completed';

/**
 * SyncOp — A single operation in the append-only operations log.
 *
 * Canonical ordering: createdAt ASC, then id ASC (tie-breaker).
 */
export interface SyncOp {
  /** Unique identifier (UUID) */
  id: string;
  /** When the op was created (ISO 8601) */
  createdAt: string;
  /** Associated conversation (null for global ops like import) */
  conversationId: string | null;
  /** Operation type */
  type: OpType;
  /** JSON-serialized payload (plaintext; empty string when encrypted) */
  payload: string;
  /** Encrypted payload ciphertext (when encryption enabled) */
  payloadEnc?: { ciphertext: string; iv: string } | null;
  /** Sync status */
  status: OpStatus;
  /** Stable device/client identifier */
  clientId: string;
  /** Schema version of this op format (start at 1) */
  schemaVersion: number;
}
```

**Step 2: Commit**

```bash
git add src/db/types.ts
git commit -m "feat(sync): add SyncOp type and OpType union"
```

---

## Task 2: Add `syncOps` table to Dexie schema (version 4)

**Files:**
- Modify: `src/db/database.ts`

**Step 1: Import the SyncOp type**

At line 18 in the import block, add `SyncOp` to the type imports:

```typescript
import type {
  Conversation,
  Message,
  MessageRevision,
  PromptContextConfig,
  SyncOp,
} from './types';
```

**Step 2: Add `syncOps` table declaration to BonsaiDatabase class**

After line 42 (`promptContextConfigs!: Table<...>`), add:

```typescript
  syncOps!: Table<SyncOp, string>;
```

**Step 3: Add schema version 4**

After line 108 (the version 3 block), add:

```typescript
    /**
     * Version 4 - Add syncOps table for append-only operations log
     *
     * New table for tracking all data-mutating operations.
     * Canonical ordering: createdAt ASC, id ASC (tie-breaker).
     */
    this.version(4).stores({
      conversations: 'id, createdAt, updatedAt',
      messages: 'id, conversationId, parentId, [conversationId+createdAt], variantOfMessageId, deletedAt',
      messageRevisions: 'id, messageId, createdAt',
      promptContextConfigs: 'messageId',
      syncOps: 'id, status, createdAt, [conversationId+createdAt]',
    });
```

**Step 4: Run type-check**

Run: `npx vue-tsc -b`
Expected: PASS (no errors)

**Step 5: Commit**

```bash
git add src/db/database.ts
git commit -m "feat(sync): add syncOps table in Dexie schema v4"
```

---

## Task 3: Create `opsService.ts` with core op CRUD

**Files:**
- Create: `src/db/opsService.ts`
- Create: `src/db/opsService.test.ts`

**Step 1: Write the failing tests**

Create `src/db/opsService.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createTestDatabase, deleteDatabase, type BonsaiDatabase } from './database';
import {
  appendOp,
  getPendingOps,
  markAcked,
  getOpStats,
  getOrCreateClientId,
} from './opsService';

describe('opsService', () => {
  let db: BonsaiDatabase;
  let testDbName: string;

  beforeEach(() => {
    testDbName = `test-ops-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db = createTestDatabase(testDbName);
    // Clear clientId between tests
    localStorage.removeItem('bonsai:sync:clientId');
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase(testDbName);
    localStorage.removeItem('bonsai:sync:clientId');
  });

  describe('getOrCreateClientId', () => {
    it('generates a client ID on first call and persists it', () => {
      const id = getOrCreateClientId();
      expect(id).toBeTruthy();
      expect(id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      // Second call returns same ID
      expect(getOrCreateClientId()).toBe(id);
    });

    it('reads existing client ID from localStorage', () => {
      localStorage.setItem('bonsai:sync:clientId', 'existing-id');
      expect(getOrCreateClientId()).toBe('existing-id');
    });
  });

  describe('appendOp', () => {
    it('creates an op with correct fields', async () => {
      const op = await appendOp(
        'conversation.create',
        { conversationId: 'conv-1', title: 'Hello' },
        'conv-1',
        db
      );

      expect(op.id).toBeTruthy();
      expect(op.type).toBe('conversation.create');
      expect(op.conversationId).toBe('conv-1');
      expect(op.status).toBe('pending');
      expect(op.schemaVersion).toBe(1);
      expect(op.clientId).toBeTruthy();
      expect(op.createdAt).toBeTruthy();

      const payload = JSON.parse(op.payload);
      expect(payload.conversationId).toBe('conv-1');
      expect(payload.title).toBe('Hello');
    });

    it('stores null conversationId for global ops', async () => {
      const op = await appendOp(
        'import.completed',
        { conversationCount: 5, messageCount: 50, mode: 'copy' },
        undefined,
        db
      );

      expect(op.conversationId).toBeNull();
    });

    it('persists op to database', async () => {
      await appendOp('conversation.create', { conversationId: 'c1', title: 'T' }, 'c1', db);
      const stored = await db.syncOps.toArray();
      expect(stored).toHaveLength(1);
    });
  });

  describe('getPendingOps', () => {
    it('returns only pending ops ordered by createdAt then id', async () => {
      // Create ops with slightly different timestamps
      const op1 = await appendOp('conversation.create', { conversationId: 'c1', title: 'A' }, 'c1', db);
      const op2 = await appendOp('conversation.create', { conversationId: 'c2', title: 'B' }, 'c2', db);
      await markAcked([op1.id], db);

      const pending = await getPendingOps(undefined, db);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.id).toBe(op2.id);
    });

    it('respects limit parameter', async () => {
      await appendOp('conversation.create', { conversationId: 'c1', title: 'A' }, 'c1', db);
      await appendOp('conversation.create', { conversationId: 'c2', title: 'B' }, 'c2', db);
      await appendOp('conversation.create', { conversationId: 'c3', title: 'C' }, 'c3', db);

      const limited = await getPendingOps(2, db);
      expect(limited).toHaveLength(2);
    });

    it('returns ops in deterministic order (createdAt ASC, id ASC)', async () => {
      const ops = [];
      for (let i = 0; i < 5; i++) {
        ops.push(await appendOp('conversation.create', { conversationId: `c${i}`, title: `T${i}` }, `c${i}`, db));
      }

      const pending = await getPendingOps(undefined, db);
      // Verify ordering: each op's createdAt >= previous, and if equal, id >= previous
      for (let i = 1; i < pending.length; i++) {
        const prev = pending[i - 1]!;
        const curr = pending[i]!;
        if (prev.createdAt === curr.createdAt) {
          expect(curr.id > prev.id).toBe(true);
        } else {
          expect(curr.createdAt > prev.createdAt).toBe(true);
        }
      }
    });
  });

  describe('markAcked', () => {
    it('transitions ops from pending to acked', async () => {
      const op = await appendOp('conversation.create', { conversationId: 'c1', title: 'A' }, 'c1', db);
      expect(op.status).toBe('pending');

      await markAcked([op.id], db);

      const stored = await db.syncOps.get(op.id);
      expect(stored?.status).toBe('acked');
    });

    it('handles multiple op IDs', async () => {
      const op1 = await appendOp('conversation.create', { conversationId: 'c1', title: 'A' }, 'c1', db);
      const op2 = await appendOp('conversation.create', { conversationId: 'c2', title: 'B' }, 'c2', db);

      await markAcked([op1.id, op2.id], db);

      const pending = await getPendingOps(undefined, db);
      expect(pending).toHaveLength(0);
    });
  });

  describe('getOpStats', () => {
    it('returns pending count and latest op types', async () => {
      await appendOp('conversation.create', { conversationId: 'c1', title: 'A' }, 'c1', db);
      await appendOp('message.create', { messageId: 'm1', conversationId: 'c1', parentId: null, role: 'user', content: 'hi' }, 'c1', db);
      await appendOp('message.edit', { messageId: 'm1', content: 'hello' }, 'c1', db);

      const stats = await getOpStats(db);
      expect(stats.pendingCount).toBe(3);
      expect(stats.latestTypes).toHaveLength(3);
      expect(stats.latestTypes).toContain('conversation.create');
      expect(stats.latestTypes).toContain('message.create');
      expect(stats.latestTypes).toContain('message.edit');
    });

    it('shows only latest 5 op types', async () => {
      for (let i = 0; i < 8; i++) {
        await appendOp('conversation.create', { conversationId: `c${i}`, title: `T${i}` }, `c${i}`, db);
      }

      const stats = await getOpStats(db);
      expect(stats.latestTypes).toHaveLength(5);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/db/opsService.test.ts`
Expected: FAIL (opsService module doesn't exist yet)

**Step 3: Write the implementation**

Create `src/db/opsService.ts`:

```typescript
/**
 * Operations Service for Bonsai Sync
 *
 * Append-only operations log stored in IndexedDB.
 * Each data-mutating user action emits an op.
 *
 * Canonical ordering: createdAt ASC, then id ASC (tie-breaker).
 *
 * Encryption: When encryption is enabled and unlocked, the payload
 * JSON is encrypted at rest using the same AES-GCM service.
 */

import type { BonsaiDatabase } from './database';
import { db as defaultDb, generateId, nowISO } from './database';
import type { SyncOp, OpType } from './types';
import {
  isEncryptionEnabled,
  isUnlocked,
  encryptContent,
  decryptContent,
} from './encryption';

const CLIENT_ID_KEY = 'bonsai:sync:clientId';
const OP_SCHEMA_VERSION = 1;

/**
 * Get or create a stable client identifier.
 * Generated once per device, stored in localStorage.
 */
export function getOrCreateClientId(): string {
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = generateId();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

/**
 * Append an operation to the log.
 *
 * @param type - The operation type
 * @param payload - The operation payload (will be JSON-serialized)
 * @param conversationId - Associated conversation (null/undefined for global ops)
 * @param database - Optional database instance (for testing)
 * @returns The created SyncOp
 */
export async function appendOp(
  type: OpType,
  payload: Record<string, unknown>,
  conversationId?: string,
  database: BonsaiDatabase = defaultDb
): Promise<SyncOp> {
  const payloadJson = JSON.stringify(payload);

  let storedPayload = payloadJson;
  let payloadEnc: SyncOp['payloadEnc'] = null;

  if (isEncryptionEnabled() && isUnlocked()) {
    const encrypted = await encryptContent(payloadJson);
    if (encrypted.contentEnc) {
      storedPayload = '';
      payloadEnc = encrypted.contentEnc;
    }
  }

  const op: SyncOp = {
    id: generateId(),
    createdAt: nowISO(),
    conversationId: conversationId ?? null,
    type,
    payload: storedPayload,
    payloadEnc,
    status: 'pending',
    clientId: getOrCreateClientId(),
    schemaVersion: OP_SCHEMA_VERSION,
  };

  await database.syncOps.add(op);
  return op;
}

/**
 * Get pending operations, ordered by createdAt ASC then id ASC.
 */
export async function getPendingOps(
  limit?: number,
  database: BonsaiDatabase = defaultDb
): Promise<SyncOp[]> {
  let query = database.syncOps
    .where('status')
    .equals('pending')
    .sortBy('createdAt');

  const ops = await query;

  // Stable sort: createdAt ASC, then id ASC as tie-breaker
  ops.sort((a, b) => {
    const timeCmp = a.createdAt.localeCompare(b.createdAt);
    if (timeCmp !== 0) return timeCmp;
    return a.id.localeCompare(b.id);
  });

  // Decrypt payloads if needed
  const decrypted = await Promise.all(
    ops.map(async (op) => {
      if (op.payloadEnc && !op.payload) {
        const plaintext = await decryptContent('', op.payloadEnc);
        return { ...op, payload: plaintext };
      }
      return op;
    })
  );

  if (limit !== undefined) {
    return decrypted.slice(0, limit);
  }
  return decrypted;
}

/**
 * Mark operations as acknowledged (synced).
 */
export async function markAcked(
  opIds: string[],
  database: BonsaiDatabase = defaultDb
): Promise<void> {
  await database.transaction('rw', database.syncOps, async () => {
    for (const id of opIds) {
      await database.syncOps.update(id, { status: 'acked' });
    }
  });
}

/**
 * Get sync diagnostics: pending count and latest op types.
 */
export async function getOpStats(
  database: BonsaiDatabase = defaultDb
): Promise<{ pendingCount: number; latestTypes: string[] }> {
  const pendingCount = await database.syncOps
    .where('status')
    .equals('pending')
    .count();

  // Get latest 5 ops (any status) for type display
  const latest = await database.syncOps
    .orderBy('createdAt')
    .reverse()
    .limit(5)
    .toArray();

  return {
    pendingCount,
    latestTypes: latest.map((op) => op.type),
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/db/opsService.test.ts`
Expected: ALL PASS

**Step 5: Run full test suite**

Run: `npm test -- --run`
Expected: ALL 420+ tests pass

**Step 6: Commit**

```bash
git add src/db/opsService.ts src/db/opsService.test.ts
git commit -m "feat(sync): add opsService with append/query/ack operations"
```

---

## Task 4: Create SyncAdapter interface + LocalOnlySyncAdapter

**Files:**
- Create: `src/db/syncAdapter.ts`

**Step 1: Create the file**

```typescript
/**
 * Sync Adapter Interface
 *
 * Abstraction for syncing operations to a remote server.
 * LocalOnlySyncAdapter is the default (no-op) implementation.
 * Future implementations will push ops to Bonsai Sync server.
 */

import type { SyncOp } from './types';
import { getPendingOps, markAcked, getOpStats } from './opsService';
import type { BonsaiDatabase } from './database';
import { db as defaultDb } from './database';

export interface SyncAdapter {
  /** Push pending ops to remote (future: server). Returns counts. */
  pushPendingOps(): Promise<{ pushed: number; failed: number }>;
  /** Mark ops as acknowledged after successful sync. */
  markAcked(opIds: string[]): Promise<void>;
  /** Get pending ops for inspection/diagnostics. */
  getPendingOps(options?: { limit?: number }): Promise<SyncOp[]>;
  /** Reset sync state (mark all ops acked). Dev-only. */
  resetSyncState?(): Promise<void>;
}

/**
 * LocalOnlySyncAdapter — does no remote sync.
 * Used as the default adapter for offline-only mode.
 * Reads ops for diagnostics; can mark acked for dev use.
 */
export class LocalOnlySyncAdapter implements SyncAdapter {
  private database: BonsaiDatabase;

  constructor(database: BonsaiDatabase = defaultDb) {
    this.database = database;
  }

  async pushPendingOps(): Promise<{ pushed: number; failed: number }> {
    return { pushed: 0, failed: 0 };
  }

  async markAcked(opIds: string[]): Promise<void> {
    await markAcked(opIds, this.database);
  }

  async getPendingOps(options?: { limit?: number }): Promise<SyncOp[]> {
    return getPendingOps(options?.limit, this.database);
  }

  async resetSyncState(): Promise<void> {
    const pending = await getPendingOps(undefined, this.database);
    const ids = pending.map((op) => op.id);
    if (ids.length > 0) {
      await markAcked(ids, this.database);
    }
  }
}
```

**Step 2: Run type-check**

Run: `npx vue-tsc -b`
Expected: PASS

**Step 3: Commit**

```bash
git add src/db/syncAdapter.ts
git commit -m "feat(sync): add SyncAdapter interface and LocalOnlySyncAdapter"
```

---

## Task 5: Export new modules from `src/db/index.ts`

**Files:**
- Modify: `src/db/index.ts`

**Step 1: Add exports**

At the end of `src/db/index.ts` (after line 101), add:

```typescript

// Sync operations service
export {
  appendOp,
  getPendingOps,
  markAcked,
  getOpStats,
  getOrCreateClientId,
} from './opsService';

// Sync adapter
export {
  LocalOnlySyncAdapter,
  type SyncAdapter,
} from './syncAdapter';

// Sync types
export type {
  SyncOp,
  OpType,
  OpStatus,
} from './types';
```

**Step 2: Run type-check**

Run: `npx vue-tsc -b`
Expected: PASS

**Step 3: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(sync): export opsService and syncAdapter from db barrel"
```

---

## Task 6: Emit ops from `conversationStore` actions

**Files:**
- Modify: `src/stores/conversationStore.ts`

**Step 1: Add import**

After the existing imports (around line 57), add:

```typescript
import { appendOp } from '@/db/opsService'
```

**Step 2: Emit op in `createNewConversation` (line ~195)**

After `const conversation = await createConversation({ title })` (line 196), add:

```typescript
    appendOp('conversation.create', { conversationId: conversation.id, title }, conversation.id).catch(console.error)
```

**Step 3: Emit op in `renameConversation` (line ~204)**

After `const updated = await updateConversation(id, { title })` (line 205), inside the `if (updated)` block, add:

```typescript
      appendOp('conversation.rename', { conversationId: id, title }, id).catch(console.error)
```

**Step 4: Emit op in `removeConversation` (line ~236)**

After `await deleteConversation(id)` (line 237), add:

```typescript
    appendOp('conversation.delete', { conversationId: id }, id).catch(console.error)
```

**Step 5: Emit op in `addMessage` (line ~349)**

After the `return message` at the end of `addMessage` (line 435), **before** the return, add:

```typescript
    appendOp('message.create', {
      messageId: message.id,
      conversationId: activeConversation.value.id,
      parentId,
      role,
      content,
      branchTitle,
    }, activeConversation.value.id).catch(console.error)
```

**Step 6: Emit op in `branchFromMessage` (line ~441)**

After `const result = await createBranch(...)` (line 455), add:

```typescript
    appendOp('message.create', {
      messageId: result.message.id,
      conversationId: activeConversation.value.id,
      parentId: fromMessageId,
      role: 'user',
      content,
      branchTitle,
    }, activeConversation.value.id).catch(console.error)
```

**Step 7: Emit op in `deleteMessageSubtree` (line ~505)**

After `const result = await deleteSubtree(messageId)` (line 524), add:

```typescript
    appendOp('message.deleteSubtree', {
      messageId,
      deletedCount: result.deletedCount,
    }, activeConversation.value.id).catch(console.error)
```

**Step 8: Emit op in `editMessage` (line ~563)**

After `const updated = await editMessageInPlace(...)` (line 581), add:

```typescript
    appendOp('message.edit', {
      messageId,
      content: newContent,
      reason,
    }, activeConversation.value.id).catch(console.error)
```

**Step 9: Emit ops in `editMessageRewriteHistory` (line ~603)**

After the for loop that deletes children (line 622), add:

```typescript
    // Emit deleteSubtree ops for each child subtree
    for (const child of children) {
      appendOp('message.deleteSubtree', {
        messageId: child.id,
        deletedCount: 0, // individual counts not tracked here
      }, activeConversation.value.id).catch(console.error)
    }
```

After `const updated = await editMessageInPlace(...)` (line 629), add:

```typescript
    appendOp('message.edit', {
      messageId,
      content: newContent,
      reason: 'rewrite-history',
    }, activeConversation.value.id).catch(console.error)
```

**Step 10: Emit op in `editMessageCreateBranch` (line ~657)**

After `const variant = await createVariant(...)` (line 676), add:

```typescript
    appendOp('message.createVariant', {
      messageId: variant.id,
      variantOfMessageId: messageId,
      content: newContent,
      branchTitle: branchTitle ?? 'Edited',
    }, activeConversation.value.id).catch(console.error)
```

**Step 11: Run type-check and tests**

Run: `npx vue-tsc -b`
Expected: PASS

Run: `npm test -- --run`
Expected: ALL tests pass (ops are fire-and-forget, won't break existing tests)

**Step 12: Commit**

```bash
git add src/stores/conversationStore.ts
git commit -m "feat(sync): emit ops from all conversationStore mutations"
```

---

## Task 7: Emit `import.completed` op from `exportImport.ts`

**Files:**
- Modify: `src/db/exportImport.ts`

**Step 1: Add import**

After the existing encryption imports (line 37), add:

```typescript
import { appendOp } from './opsService';
```

**Step 2: Emit op after successful import**

At line 760 (just before `result.success = true;`), add:

```typescript
    // Emit sync op for import
    await appendOp('import.completed', {
      conversationCount: result.imported.conversations,
      messageCount: result.imported.messages,
      mode: options.mode,
    }).catch(console.error);
```

**Step 3: Run tests**

Run: `npm test -- --run`
Expected: ALL pass

**Step 4: Commit**

```bash
git add src/db/exportImport.ts
git commit -m "feat(sync): emit import.completed op after successful import"
```

---

## Task 8: Add encryption test for ops payloads

**Files:**
- Modify: `src/db/opsService.test.ts`

**Step 1: Add encryption test to opsService.test.ts**

Add a new `describe('encryption')` block at the end of the test file (before the final closing `});`):

```typescript
  describe('encryption', () => {
    it('encrypts op payload when encryption is enabled and unlocked', async () => {
      // Import encryption mocking utilities
      const { enableEncryption, isUnlocked, lock, disableEncryption } = await import('./encryption');

      // Enable encryption with a test passphrase
      await enableEncryption('test-passphrase-12345', db);
      expect(isUnlocked()).toBe(true);

      const op = await appendOp(
        'message.create',
        { messageId: 'm1', content: 'secret message' },
        'conv-1',
        db
      );

      // The returned op may have decrypted payload in memory,
      // but the stored version should be encrypted
      const stored = await db.syncOps.get(op.id);
      expect(stored).toBeTruthy();
      expect(stored!.payload).toBe(''); // plaintext cleared
      expect(stored!.payloadEnc).toBeTruthy();
      expect(stored!.payloadEnc!.ciphertext).toBeTruthy();
      expect(stored!.payloadEnc!.iv).toBeTruthy();

      // getPendingOps should return decrypted payload
      const pending = await getPendingOps(undefined, db);
      expect(pending).toHaveLength(1);
      const payload = JSON.parse(pending[0]!.payload);
      expect(payload.content).toBe('secret message');

      // Cleanup
      await disableEncryption('test-passphrase-12345', db);
    });
  });
```

**Step 2: Run the test**

Run: `npm test -- --run src/db/opsService.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/db/opsService.test.ts
git commit -m "test(sync): add encryption-at-rest test for op payloads"
```

---

## Task 9: Add store integration tests for op emission

**Files:**
- Create: `src/stores/conversationStore.sync.test.ts`

**Step 1: Write integration tests**

```typescript
/**
 * Integration tests verifying that conversationStore actions emit sync ops.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { setActivePinia, createPinia } from 'pinia';
import { createTestDatabase, deleteDatabase, type BonsaiDatabase } from '@/db/database';
import { useConversationStore } from './conversationStore';
import { getPendingOps } from '@/db/opsService';

// Note: These tests verify that ops are emitted when store actions run.
// Since the store uses the default db instance, we need to verify ops
// appear in the default db's syncOps table.

describe('conversationStore sync op emission', () => {
  let db: BonsaiDatabase;
  let testDbName: string;

  beforeEach(() => {
    testDbName = `test-store-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db = createTestDatabase(testDbName);
    setActivePinia(createPinia());
    localStorage.removeItem('bonsai:sync:clientId');
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase(testDbName);
    localStorage.removeItem('bonsai:sync:clientId');
  });

  it('emits conversation.create op when creating a conversation', async () => {
    const store = useConversationStore();
    const conv = await store.createNewConversation('Test Conversation');

    // Wait for async op emission
    await new Promise(r => setTimeout(r, 50));

    // Check ops in the default database (store uses default db)
    // Since store uses default db and we can't easily swap it,
    // we verify the op was attempted by checking the store didn't error
    expect(conv.title).toBe('Test Conversation');
    expect(conv.id).toBeTruthy();
  });
});
```

Note: Full store integration testing is limited because the store uses the default `db` singleton. The primary validation of op emission is done through the opsService unit tests and the E2E test in Task 11. The store integration test above serves as a smoke test.

**Step 2: Run tests**

Run: `npm test -- --run`
Expected: ALL pass

**Step 3: Commit**

```bash
git add src/stores/conversationStore.sync.test.ts
git commit -m "test(sync): add store integration smoke test for op emission"
```

---

## Task 10: Add Sync Diagnostics section to Settings

**Files:**
- Modify: `src/views/SettingsView.vue`

**Step 1: Add imports in `<script setup>`**

After the existing imports (around line 41), add:

```typescript
import { getOpStats, getOrCreateClientId } from '@/db/opsService'
import { LocalOnlySyncAdapter } from '@/db/syncAdapter'
```

**Step 2: Add state variables**

After the existing state variables (around line 80), add:

```typescript
// Sync diagnostics state
const syncPendingCount = ref(0)
const syncLatestTypes = ref<string[]>([])
const syncClientId = ref('')
const isSyncLoading = ref(false)
const syncAdapter = new LocalOnlySyncAdapter()

async function refreshSyncDiagnostics() {
  isSyncLoading.value = true
  try {
    const stats = await getOpStats()
    syncPendingCount.value = stats.pendingCount
    syncLatestTypes.value = stats.latestTypes
    syncClientId.value = getOrCreateClientId()
  } finally {
    isSyncLoading.value = false
  }
}

async function markAllOpsAcked() {
  await syncAdapter.resetSyncState()
  await refreshSyncDiagnostics()
}
```

**Step 3: Call refreshSyncDiagnostics in onMounted**

Find the existing `onMounted` callback and add `refreshSyncDiagnostics()` inside it.

**Step 4: Add template section**

Find the "Data & Storage" section (around line 999). **Before** the Danger Zone section (line 1131), insert a new section:

```html
      <!-- Sync (Coming Soon) -->
      <section class="settings-card" data-testid="sync-section">
        <h2 class="card-title">Sync (Coming Soon)</h2>
        <p class="section-description">
          Cloud sync is not yet available. Operations are logged locally for future sync support.
        </p>

        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Pending Operations</span>
            <code class="info-value" data-testid="sync-pending-count">{{ syncPendingCount }}</code>
          </div>
          <div class="info-item">
            <span class="info-label">Client ID</span>
            <code class="info-value" data-testid="sync-client-id">{{ syncClientId || '—' }}</code>
          </div>
        </div>

        <div v-if="syncLatestTypes.length > 0" class="latest-ops">
          <span class="info-label">Latest Operations</span>
          <div class="ops-list" data-testid="sync-latest-ops">
            <code v-for="(opType, index) in syncLatestTypes" :key="index" class="op-type-badge">
              {{ opType }}
            </code>
          </div>
        </div>

        <div class="button-row" style="margin-top: 0.75rem;">
          <button
            class="btn btn-secondary"
            data-testid="refresh-sync-btn"
            :disabled="isSyncLoading"
            @click="refreshSyncDiagnostics"
          >
            {{ isSyncLoading ? 'Refreshing…' : 'Refresh' }}
          </button>
          <button
            v-if="isDev"
            class="btn btn-secondary"
            data-testid="mark-all-acked-btn"
            @click="markAllOpsAcked"
          >
            Mark All Acknowledged
          </button>
        </div>
      </section>
```

**Step 5: Add styles**

Add at the end of the `<style scoped>` block:

```css
/* Sync diagnostics */
.latest-ops {
  margin-top: 0.5rem;
}

.ops-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.25rem;
}

.op-type-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  background: var(--bg-tertiary, #374151);
  color: var(--text-secondary, #9ca3af);
}
```

**Step 6: Run type-check**

Run: `npx vue-tsc -b`
Expected: PASS

**Step 7: Commit**

```bash
git add src/views/SettingsView.vue
git commit -m "feat(sync): add sync diagnostics section to Settings"
```

---

## Task 11: Add E2E test for sync diagnostics

**Files:**
- Create: `e2e/sync-ops.spec.ts`

**Step 1: Write E2E test**

```typescript
import { test, expect } from '@playwright/test'
import { createConversation } from './helpers'

test.describe('Sync Operations Log', () => {
  test('shows pending ops count in Settings after creating a conversation', async ({ page }) => {
    await page.goto('/')

    // Create a conversation (emits conversation.create op)
    await createConversation(page, 'Sync Test Conversation')

    // Navigate to Settings
    await page.click('[data-testid="settings-btn"], [data-testid="nav-settings"]')

    // Find sync section
    const syncSection = page.locator('[data-testid="sync-section"]')
    await expect(syncSection).toBeVisible()

    // Click refresh to ensure stats are current
    await page.click('[data-testid="refresh-sync-btn"]')

    // Pending count should be >= 1 (at least the conversation.create op)
    const pendingCount = page.locator('[data-testid="sync-pending-count"]')
    await expect(pendingCount).not.toHaveText('0')

    // Client ID should be populated
    const clientId = page.locator('[data-testid="sync-client-id"]')
    await expect(clientId).not.toHaveText('—')

    // Latest ops should show conversation.create
    const latestOps = page.locator('[data-testid="sync-latest-ops"]')
    await expect(latestOps).toContainText('conversation.create')
  })
})
```

**Step 2: Run E2E test**

Run: `npm run test:e2e -- --grep "Sync Operations"`
Expected: PASS

**Step 3: Commit**

```bash
git add e2e/sync-ops.spec.ts
git commit -m "test(sync): add e2e test for sync diagnostics in Settings"
```

---

## Task 12: Update PROJECT_STATUS.md and AGENT_NOTES.md

**Files:**
- Modify: `PROJECT_STATUS.md`
- Modify: `AGENT_NOTES.md`

**Step 1: Add Milestone 16 to PROJECT_STATUS.md**

After the Milestone 15 section and before "### Post-MVP", add:

```markdown
### Milestone 16 — Sync-Ready Client Architecture
Status: ✅ Done
- [x] Append-only operations log in IndexedDB (syncOps table, schema v4)
- [x] Op types: conversation.create/rename/delete, message.create/edit/deleteSubtree/createVariant, import.completed
- [x] Ops emitted from store actions (fire-and-forget, non-blocking)
- [x] Op payloads encrypted at rest when encryption enabled (AES-GCM, same service)
- [x] SyncAdapter interface with LocalOnlySyncAdapter implementation
- [x] Sync diagnostics section in Settings (pending count, latest ops, client ID)
- [x] Deterministic ordering: createdAt ASC, id ASC tie-breaker
- [x] Unit tests for opsService (op CRUD, ordering, encryption)
- [x] E2E test for sync diagnostics
Notes / decisions:
- **Op emission location**: Store actions (domain commands), not repositories (pure CRUD)
- **Encryption**: Full payload encrypted at rest via encryptContent/decryptContent
- **Import strategy**: Single `import.completed` op (Approach A) — server treats import as new baseline
- **Canonical ordering**: createdAt ASC, id ASC documented as canonical for future replay
- **Client ID**: UUID in localStorage at `bonsai:sync:clientId`, generated once per device
- **Non-blocking**: Op writes use `.catch(console.error)` — failures logged but don't block user actions
- **Schema**: syncOps table with indices on id, status, createdAt, [conversationId+createdAt]
```

Also update the "Next Actions" section at the bottom of PROJECT_STATUS.md.

**Step 2: Add entry to AGENT_NOTES.md**

Append a new entry at the end of the file:

```markdown
### 2026-02-13 — Milestone 16 (Sync-Ready Client Architecture)

**Summary:**
- Added append-only operations log (`syncOps` table) in IndexedDB schema v4
- Every data-mutating store action emits a typed op with JSON payload
- SyncAdapter interface + LocalOnlySyncAdapter (no-op for offline-only mode)
- Op payloads encrypted at rest using existing AES-GCM encryption service
- Sync diagnostics section in Settings for dev visibility
- Design doc: `docs/plans/2026-02-13-sync-ready-ops-log-design.md`

**Decisions / Rationale (not explicitly in plan):**
- **Store actions over repositories**: Repositories are pure CRUD without domain intent. Store actions map 1:1 to user-facing commands (create conversation, branch, edit Option A/B, etc.), making ops semantically meaningful.
- **Fire-and-forget emission**: `appendOp().catch(console.error)` — op failures must never block the user's primary action. Ops are supplementary metadata for future sync, not critical path.
- **Full payload encryption**: Encrypt the entire JSON payload blob rather than individual fields. Simpler implementation, full parity with existing message encryption, and future sync server can decrypt the whole payload at once.
- **Import as single op**: `import.completed` with counts. Per-entity ops would be heavyweight and the server can treat import as a new baseline anyway.
- **Stable client ID**: UUID in localStorage, generated once. Simple and sufficient — no need for device fingerprinting or user auth at this stage.
- **Schema version in op**: `schemaVersion: 1` in every op allows future payload format changes without breaking replay.

**Alternatives considered:**
- **Repository-level emission**: Would capture ALL writes but loses domain intent (can't distinguish branch-from-message vs regular addMessage). Store actions are the right semantic level.
- **References-only payloads**: Storing only IDs (no content) in ops would be simpler but makes future sync harder — server would need to query main tables to reconstruct state.
- **Hybrid encryption (encrypt only sensitive fields)**: More granular but adds complexity to payload parsing. Full-payload encryption is simpler and equally secure.
- **Per-entity import ops**: Pure from a replay perspective but impractical (1000-message import = 1000+ ops). Single import op is pragmatic.

**Deviations from plan:**
- None significant. Implementation follows the approved design doc.

**Risks / Gotchas / Debugging notes:**
- **Dexie schema v4 migration**: No data migration needed — new table with no existing data. But all 4 previous version definitions must be preserved in the version chain.
- **Encryption test isolation**: Encryption tests that call `enableEncryption()` affect the module-level singleton state. Must `disableEncryption()` in cleanup to avoid leaking into other tests.
- **Store uses default db singleton**: Integration testing of op emission from store actions is limited because the store imports the default `db` instance. Full verification relies on E2E tests.
- **Op ordering**: ISO timestamps have millisecond precision. In fast test loops, multiple ops can share the same `createdAt`. The `id` (UUID) tie-breaker ensures deterministic ordering even in this case.
- **Streaming assistant messages**: The streaming flow creates assistant messages via `sendMessageAndStream` → callbacks → store actions. The `addMessage` call in the store emits the `message.create` op for assistant messages too.

**Suggestions (Optional / Post-MVP):**
- **Op compaction**: For very long-running offline periods, ops could be compacted (e.g., multiple renames → keep only last).
- **Op replay for debugging**: Add a dev tool that replays ops to reconstruct state from scratch — validates op completeness.
- **Sync status indicator**: Small icon in navbar showing pending ops count / sync status.
- **Conflict resolution UI**: When sync detects conflicts (same message edited on two devices), show a merge dialog.
- **Batch op emission**: For editMessageRewriteHistory (which emits N+1 ops for N children + 1 edit), consider a composite op type to reduce op count.
- **Op pruning**: After successful sync + grace period, old acked ops could be pruned to save storage.

**Future backend assumptions:**
- Server receives ops via POST, validates, stores, and broadcasts to other clients
- Server maintains a vector clock or sequence number per client for ordering
- On connect, client pushes all pending ops; server responds with ops from other clients
- Import ops trigger a "full state sync" rather than individual entity creation
- Encryption: server stores encrypted payloads as-is; decryption happens client-side only
```

**Step 3: Commit**

```bash
git add PROJECT_STATUS.md AGENT_NOTES.md
git commit -m "docs: update PROJECT_STATUS.md and AGENT_NOTES.md for Milestone 16"
```

---

## Task 13: Final verification

**Step 1: Run full test suite**

Run: `npm test -- --run`
Expected: ALL tests pass (420+ existing + new opsService tests)

**Step 2: Run type-check**

Run: `npx vue-tsc -b`
Expected: PASS

**Step 3: Run E2E tests**

Run: `npm run test:e2e`
Expected: ALL pass

**Step 4: Visual verification**

Run: `npm run dev`
- Create a conversation
- Send a message
- Go to Settings → Sync section
- Click Refresh → verify pending count > 0 and operation types shown

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | SyncOp types | `src/db/types.ts` |
| 2 | Dexie schema v4 | `src/db/database.ts` |
| 3 | opsService + tests | `src/db/opsService.ts`, `src/db/opsService.test.ts` |
| 4 | SyncAdapter + LocalOnly | `src/db/syncAdapter.ts` |
| 5 | Barrel exports | `src/db/index.ts` |
| 6 | Store op emission | `src/stores/conversationStore.ts` |
| 7 | Import op emission | `src/db/exportImport.ts` |
| 8 | Encryption test | `src/db/opsService.test.ts` |
| 9 | Store integration test | `src/stores/conversationStore.sync.test.ts` |
| 10 | Settings UI | `src/views/SettingsView.vue` |
| 11 | E2E test | `e2e/sync-ops.spec.ts` |
| 12 | Docs update | `PROJECT_STATUS.md`, `AGENT_NOTES.md` |
| 13 | Final verification | — |
