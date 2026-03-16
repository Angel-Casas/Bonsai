# Conflict Resolution Design

> Date: 2026-03-16
> Status: Approved

## Context

Bonsai syncs conversation data between devices via an append-only ops log. The server stores encrypted op payloads and returns them to other devices on pull. The expected usage pattern is **one device at a time** — conflicts are rare edge cases (e.g., user forgot to sync before switching devices). When conflicts do occur, the user should be **asked to resolve them**.

## Approach: Op-Level Conflict Detection

When pulling remote ops, compare them against pending local ops. A conflict exists when a remote op and a local op target the same entity with incompatible intentions. Non-conflicting ops apply automatically.

## Conflict Matrix

Remote op (rows) vs local pending op (columns) on the same entity:

| Remote \ Local | message.edit | message.deleteSubtree | message.createVariant | conversation.rename | conversation.delete |
|---|---|---|---|---|---|
| message.edit | CONFLICT | CONFLICT | safe | safe | CONFLICT |
| message.deleteSubtree | CONFLICT | safe (idempotent) | CONFLICT | safe | safe |
| message.createVariant | safe | CONFLICT | safe | safe | CONFLICT |
| conversation.rename | safe | safe | safe | CONFLICT | CONFLICT |
| conversation.delete | CONFLICT | safe | CONFLICT | CONFLICT | safe (idempotent) |

Entity matching:
- Message ops: match on `messageId` in payload
- Conversation ops: match on `conversationId`
- `message.create` and `import.completed` are always safe (new content)

## Sync Flow

### Normal (no conflicts)
1. Pull remote ops
2. Compare against pending local ops
3. No conflicts: apply remote ops to local DB, then push pending local ops

### With conflicts
1. Pull remote ops
2. Apply non-conflicting remote ops immediately
3. Queue conflicting ops, show conflict dialog
4. User resolves each conflict
5. Apply resolutions, push remaining local ops

## Conflict Dialog UX

- Modal that blocks sync until resolved
- One conflict at a time with prev/next navigation
- Each conflict shows:
  - **Left**: "This device" — local pending change
  - **Right**: "Other device" — remote change
  - **Three buttons**: Keep mine, Keep theirs, Keep both (branch)

### Display by conflict type

| Conflict type | Display |
|---|---|
| edit vs edit | Side-by-side content diff |
| edit vs delete | "You edited this, but it was deleted on another device" |
| rename vs rename | Both titles shown |
| rename vs delete | "You renamed this, but it was deleted on another device" |
| any vs conversation.delete | "Conversation deleted on another device. Keep local changes?" |

### Resolution actions

| Choice | Effect |
|---|---|
| Keep mine | Discard remote op, push local op |
| Keep theirs | Discard local pending op, apply remote op |
| Keep both | Apply remote op, create local op as new branch/variant |

## Architecture

### New modules

**`src/db/conflictDetector.ts`** — Pure function
- `detectConflicts(remoteOps, pendingLocalOps)` returns `{ safe: RemoteOp[], conflicts: ConflictPair[] }`
- Uses the conflict matrix to classify each remote op

**`src/components/ConflictResolver.vue`** — Modal dialog
- Receives `ConflictPair[]`, emits resolutions
- Shows one conflict at a time, three resolution buttons
- Blocks interaction until all resolved

**`src/db/syncOrchestrator.ts`** — Coordinates the sync cycle
- `runSync()`: pull → detect → apply safe → show conflicts → apply resolutions → push
- Tracks state: `idle | pulling | resolving | pushing | error`

### Changes to existing modules

- **`remoteSyncAdapter.ts`**: Add method to apply remote op to local DB
- **`conversationStore.ts`**: Add `applyRemoteOp(op)` that writes to DB without emitting a new local op (avoids echo loops)
- **`opsService.ts`**: Add `discardOp(opId)` to remove a local pending op on "keep theirs"

### Types

```typescript
type ConflictType =
  | 'edit-vs-edit'
  | 'edit-vs-delete'
  | 'rename-vs-rename'
  | 'rename-vs-delete'
  | 'create-vs-delete'

interface ConflictPair {
  remote: RemoteOp
  local: SyncOp
  type: ConflictType
}

type Resolution = 'keep-local' | 'keep-remote' | 'keep-both'

interface ResolvedConflict {
  pair: ConflictPair
  resolution: Resolution
}
```

### Sync trigger points

- App startup (after auth check)
- Every 60 seconds while online and authenticated
- Manual "Sync now" button in Settings
- After coming back online (via `useOnlineStatus`)

## Testing strategy

- Unit tests for `conflictDetector`: all matrix combinations, edge cases (no conflicts, multiple conflicts, mixed safe + conflict)
- Unit tests for `syncOrchestrator`: mock adapter, verify flow with and without conflicts
- Component tests for `ConflictResolver`: verify dialog renders correct info, emits correct resolutions
- E2E test: simulate two-device scenario by pushing ops directly via API, verify conflict dialog appears and resolves correctly
