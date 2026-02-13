# Milestone 16 — Sync-Ready Client Architecture: Design

**Date:** 2026-02-13
**Status:** Approved
**Scope:** Append-only operations log, SyncAdapter interface, LocalOnly implementation. No backend, no auth, no payments.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Op emission location | Store actions | Repos are pure CRUD; store actions are domain commands that map 1:1 to user intent |
| Op encryption at rest | Encrypt full payload | AES-GCM via existing encryptionService; full parity with message/conversation encryption |
| Import op strategy | Approach A (single op) | One `import.completed` op with counts; server treats import as new baseline |

---

## 1. Ops Table Schema

New Dexie table `syncOps` added in **schema version 4**.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Primary key |
| `createdAt` | string (ISO) | When the op was created |
| `conversationId` | string \| null | Null for global ops (import) |
| `type` | string | Operation type enum |
| `payload` | string (JSON) | Plaintext payload (cleared when encrypted) |
| `payloadEnc` | string \| null | Encrypted payload ciphertext (base64) |
| `payloadIv` | string \| null | Encryption IV (base64) |
| `status` | string | `'pending'` \| `'acked'` \| `'failed'` |
| `clientId` | string | Stable device identifier |
| `schemaVersion` | number | Starts at 1 |

**Indices:** `id` (primary), `status`, `createdAt`, `[conversationId+createdAt]`

**Canonical ordering:** Primary by `createdAt` ASC, tie-break by `id` ASC.

**Client ID:** Generated once via `crypto.randomUUID()`, stored in `localStorage` at `bonsai:sync:clientId`.

---

## 2. Operation Types

| Op Type | Store Action | Payload Shape |
|---------|-------------|---------------|
| `conversation.create` | `addConversation()` | `{ conversationId, title }` |
| `conversation.rename` | `renameConversation()` | `{ conversationId, title }` |
| `conversation.delete` | `deleteConversation()` | `{ conversationId }` |
| `message.create` | `addMessage()`, `branchFromMessage()` | `{ messageId, conversationId, parentId, role, content, branchTitle? }` |
| `message.edit` | `editMessage()`, `editMessageRewriteHistory()` | `{ messageId, content, reason? }` |
| `message.deleteSubtree` | `deleteMessageSubtree()`, `editMessageRewriteHistory()` | `{ messageId, deletedCount }` |
| `message.createVariant` | `editMessageCreateBranch()` | `{ messageId, variantOfMessageId, content, branchTitle? }` |
| `import.completed` | `importData()` | `{ conversationCount, messageCount, source?, mode }` |

Notes:
- `branchFromMessage()` creates a message with `branchTitle` — emits `message.create`, no separate branch op needed.
- `editMessageRewriteHistory()` emits TWO ops: `message.deleteSubtree` (for the children deletion) + `message.edit` (for the content change). This keeps ops atomic and replayable.
- Assistant messages created during streaming also emit `message.create` (via the streaming service's `onAssistantCreated` callback path through the store).

---

## 3. Emission Strategy

### Location: Store actions + importData()

A new `src/db/opsService.ts` module provides:

```typescript
appendOp(type: OpType, payload: object, conversationId?: string): Promise<SyncOp>
getPendingOps(limit?: number): Promise<SyncOp[]>
markAcked(opIds: string[]): Promise<void>
getOpStats(): Promise<{ pendingCount: number; latestTypes: string[] }>
getOrCreateClientId(): string
```

### Emission rules:
1. Each store action calls `appendOp()` **after** the successful DB write.
2. If op write fails, it is logged to console but **does not** block the user action.
3. Ops are fire-and-forget from the store's perspective — they are supplementary metadata.

### Encryption integration:
- `appendOp()` checks `isEncryptionEnabled() && isUnlocked()`.
- If true: encrypts JSON payload via `encryptionService.encryptContent()` into `payloadEnc`/`payloadIv`, sets `payload` to empty string.
- If false: stores plaintext JSON in `payload`, leaves `payloadEnc`/`payloadIv` null.
- On read: `getPendingOps()` decrypts payloads transparently (same pattern as message decryption).

---

## 4. SyncAdapter Interface

```typescript
interface SyncAdapter {
  pushPendingOps(): Promise<{ pushed: number; failed: number }>
  markAcked(opIds: string[]): Promise<void>
  getPendingOps(options?: { limit?: number }): Promise<SyncOp[]>
  resetSyncState?(): Promise<void>
}
```

### LocalOnlySyncAdapter

- `pushPendingOps()` returns `{ pushed: 0, failed: 0 }` (no-op)
- `markAcked(opIds)` delegates to `opsService.markAcked()`
- `getPendingOps()` delegates to `opsService.getPendingOps()`
- `resetSyncState()` marks all ops as acked (dev-only convenience)
- No network calls whatsoever

---

## 5. Settings: Sync Diagnostics

A "Sync (coming soon)" section in Settings showing:
- Pending ops count
- Latest 5 op types with timestamps
- Client ID
- "Mark all acknowledged" button (dev tool)

---

## 6. Test Plan

### Unit tests (`src/db/opsService.test.ts`)
- `appendOp` creates op with correct fields
- Op for each operation type (conversation.create, message.create, etc.)
- Deterministic ordering: ops sorted by createdAt then id
- `getPendingOps` returns only pending status
- `markAcked` transitions status correctly
- Encryption: payload encrypted at rest when encryption enabled
- Encryption: payload readable when decrypted

### Store integration tests
- Store actions (addMessage, branchFromMessage, etc.) emit correct op types
- Op emission failure doesn't break the primary action

### E2E test (`e2e/sync-ops.spec.ts`) — optional
- Perform a few actions (create conversation, send message)
- Navigate to Settings
- Verify sync diagnostics shows correct pending count and types

---

## 7. Files to Create/Modify

### New files:
- `src/db/opsService.ts` — op CRUD, clientId management, encryption
- `src/db/opsService.test.ts` — unit tests
- `src/db/syncAdapter.ts` — SyncAdapter interface + LocalOnlySyncAdapter
- `src/db/types.ts` — extended with SyncOp type, OpType union

### Modified files:
- `src/db/database.ts` — schema v4 with syncOps table
- `src/db/index.ts` — export new modules
- `src/stores/conversationStore.ts` — appendOp calls in store actions
- `src/db/exportImport.ts` — emit import.completed op
- `src/views/SettingsView.vue` — sync diagnostics section

### Documentation:
- `PROJECT_STATUS.md` — Milestone 16 entry
- `AGENT_NOTES.md` — design rationale appendix

---

## 8. Non-Goals

- No backend endpoints
- No auth / user accounts
- No Stripe / subscriptions
- No real sync between devices
- No UX changes except optional "Sync (coming soon)" in Settings
