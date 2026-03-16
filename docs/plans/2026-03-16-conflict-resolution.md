# Conflict Resolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect and resolve conflicts when syncing ops between devices, showing a dialog when two devices have made incompatible changes to the same entity.

**Architecture:** Pure conflict detection function compares remote ops against pending local ops using a conflict matrix. A sync orchestrator coordinates the pull → detect → resolve → push cycle. A Vue modal presents conflicts one at a time with three resolution options (keep mine, keep theirs, keep both).

**Tech Stack:** Vue 3 + Pinia, Vitest + fake-indexeddb, existing opsService/remoteSyncAdapter patterns.

---

### Task 1: Add ConflictType and ConflictPair types

**Files:**
- Modify: `src/db/types.ts`

**Step 1: Add conflict resolution types to types.ts**

Add after the existing SyncOp interface:

```typescript
/** Conflict classification between a remote op and a local pending op */
export type ConflictType =
  | 'edit-vs-edit'
  | 'edit-vs-delete'
  | 'rename-vs-rename'
  | 'rename-vs-delete'
  | 'create-vs-delete'

/** A detected conflict between a remote op and a local pending op */
export interface ConflictPair {
  remote: RemoteOp
  local: SyncOp
  type: ConflictType
}

/** How the user resolved a conflict */
export type Resolution = 'keep-local' | 'keep-remote' | 'keep-both'

/** A conflict with its user-chosen resolution */
export interface ResolvedConflict {
  pair: ConflictPair
  resolution: Resolution
}

/** Wire format for ops received from server */
export interface RemoteOp {
  id: string
  clientId: string
  encryptedPayload: string
  conversationId: string | null
  createdAt: string
}
```

**Step 2: Update remoteSyncAdapter.ts to use shared RemoteOp type**

Change the local `RemoteOp` interface in `src/db/remoteSyncAdapter.ts` to import from types instead.

**Step 3: Commit**

```bash
git add src/db/types.ts src/db/remoteSyncAdapter.ts
git commit -m "feat(sync): add conflict resolution types"
```

---

### Task 2: Implement conflictDetector with tests (TDD)

**Files:**
- Create: `src/db/conflictDetector.ts`
- Create: `src/db/conflictDetector.test.ts`

**Step 1: Write the failing tests**

```typescript
/**
 * Unit tests for conflictDetector — op-level conflict detection
 */
import { describe, it, expect } from 'vitest'
import { detectConflicts } from './conflictDetector'
import type { SyncOp, RemoteOp } from './types'

function makeLocalOp(overrides: Partial<SyncOp> & { type: SyncOp['type']; payload: string }): SyncOp {
  return {
    id: 'local-1',
    createdAt: '2026-03-16T00:00:00Z',
    conversationId: 'conv-1',
    status: 'pending',
    clientId: 'device-A',
    schemaVersion: 1,
    payloadEnc: null,
    ...overrides,
  }
}

function makeRemoteOp(overrides: Partial<RemoteOp> = {}): RemoteOp {
  return {
    id: 'remote-1',
    clientId: 'device-B',
    encryptedPayload: btoa('{}'),
    conversationId: 'conv-1',
    createdAt: '2026-03-16T00:01:00Z',
    ...overrides,
  }
}

describe('conflictDetector', () => {
  describe('no conflicts', () => {
    it('returns all remote ops as safe when no local pending ops', () => {
      const remote = [makeRemoteOp()]
      const result = detectConflicts(remote, [])
      expect(result.safe).toHaveLength(1)
      expect(result.conflicts).toHaveLength(0)
    })

    it('message.create is always safe', () => {
      const remote = [makeRemoteOp({
        encryptedPayload: btoa(JSON.stringify({ type: 'message.create', messageId: 'msg-1' })),
      })]
      const local = [makeLocalOp({
        type: 'message.edit',
        payload: JSON.stringify({ messageId: 'msg-1', content: 'edited' }),
      })]
      const result = detectConflicts(remote, local)
      expect(result.safe).toHaveLength(1)
      expect(result.conflicts).toHaveLength(0)
    })

    it('ops on different entities are safe', () => {
      const remote = [makeRemoteOp({
        encryptedPayload: btoa(JSON.stringify({ type: 'message.edit', messageId: 'msg-2' })),
      })]
      const local = [makeLocalOp({
        type: 'message.edit',
        payload: JSON.stringify({ messageId: 'msg-1', content: 'edited' }),
      })]
      const result = detectConflicts(remote, local)
      expect(result.safe).toHaveLength(1)
      expect(result.conflicts).toHaveLength(0)
    })
  })

  describe('edit-vs-edit conflicts', () => {
    it('detects edit-vs-edit on same message', () => {
      const remote = [makeRemoteOp({
        encryptedPayload: btoa(JSON.stringify({ type: 'message.edit', messageId: 'msg-1', content: 'remote edit' })),
      })]
      const local = [makeLocalOp({
        type: 'message.edit',
        payload: JSON.stringify({ messageId: 'msg-1', content: 'local edit' }),
      })]
      const result = detectConflicts(remote, local)
      expect(result.safe).toHaveLength(0)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].type).toBe('edit-vs-edit')
    })
  })

  describe('edit-vs-delete conflicts', () => {
    it('detects remote edit vs local delete', () => {
      const remote = [makeRemoteOp({
        encryptedPayload: btoa(JSON.stringify({ type: 'message.edit', messageId: 'msg-1' })),
      })]
      const local = [makeLocalOp({
        type: 'message.deleteSubtree',
        payload: JSON.stringify({ messageId: 'msg-1', deletedCount: 3 }),
      })]
      const result = detectConflicts(remote, local)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].type).toBe('edit-vs-delete')
    })

    it('detects remote delete vs local edit', () => {
      const remote = [makeRemoteOp({
        encryptedPayload: btoa(JSON.stringify({ type: 'message.deleteSubtree', messageId: 'msg-1' })),
      })]
      const local = [makeLocalOp({
        type: 'message.edit',
        payload: JSON.stringify({ messageId: 'msg-1', content: 'local edit' }),
      })]
      const result = detectConflicts(remote, local)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].type).toBe('edit-vs-delete')
    })
  })

  describe('rename-vs-rename conflicts', () => {
    it('detects rename-vs-rename on same conversation', () => {
      const remote = [makeRemoteOp({
        encryptedPayload: btoa(JSON.stringify({ type: 'conversation.rename', conversationId: 'conv-1', title: 'Remote Title' })),
        conversationId: 'conv-1',
      })]
      const local = [makeLocalOp({
        type: 'conversation.rename',
        payload: JSON.stringify({ conversationId: 'conv-1', title: 'Local Title' }),
        conversationId: 'conv-1',
      })]
      const result = detectConflicts(remote, local)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].type).toBe('rename-vs-rename')
    })
  })

  describe('conversation delete conflicts', () => {
    it('detects remote delete vs local rename', () => {
      const remote = [makeRemoteOp({
        encryptedPayload: btoa(JSON.stringify({ type: 'conversation.delete', conversationId: 'conv-1' })),
        conversationId: 'conv-1',
      })]
      const local = [makeLocalOp({
        type: 'conversation.rename',
        payload: JSON.stringify({ conversationId: 'conv-1', title: 'New name' }),
        conversationId: 'conv-1',
      })]
      const result = detectConflicts(remote, local)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].type).toBe('rename-vs-delete')
    })
  })

  describe('mixed safe and conflicts', () => {
    it('separates safe ops from conflicting ones', () => {
      const remoteOps = [
        makeRemoteOp({ id: 'r1', encryptedPayload: btoa(JSON.stringify({ type: 'message.create', messageId: 'new-1' })) }),
        makeRemoteOp({ id: 'r2', encryptedPayload: btoa(JSON.stringify({ type: 'message.edit', messageId: 'msg-1', content: 'remote' })) }),
        makeRemoteOp({ id: 'r3', encryptedPayload: btoa(JSON.stringify({ type: 'message.edit', messageId: 'msg-99', content: 'no conflict' })) }),
      ]
      const localOps = [makeLocalOp({
        type: 'message.edit',
        payload: JSON.stringify({ messageId: 'msg-1', content: 'local' }),
      })]
      const result = detectConflicts(remoteOps, localOps)
      expect(result.safe).toHaveLength(2) // message.create + edit on different entity
      expect(result.conflicts).toHaveLength(1) // edit-vs-edit on msg-1
    })
  })

  describe('idempotent operations', () => {
    it('delete-vs-delete on same entity is safe (idempotent)', () => {
      const remote = [makeRemoteOp({
        encryptedPayload: btoa(JSON.stringify({ type: 'message.deleteSubtree', messageId: 'msg-1' })),
      })]
      const local = [makeLocalOp({
        type: 'message.deleteSubtree',
        payload: JSON.stringify({ messageId: 'msg-1', deletedCount: 1 }),
      })]
      const result = detectConflicts(remote, local)
      expect(result.safe).toHaveLength(1)
      expect(result.conflicts).toHaveLength(0)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/db/conflictDetector.test.ts`
Expected: FAIL — module not found

**Step 3: Implement conflictDetector.ts**

```typescript
import type { SyncOp, RemoteOp, ConflictPair, ConflictType } from './types'

interface DetectionResult {
  safe: RemoteOp[]
  conflicts: ConflictPair[]
}

/** Decode a remote op's encrypted payload to get its type and entity IDs */
function decodeRemotePayload(op: RemoteOp): Record<string, unknown> {
  try {
    return JSON.parse(atob(op.encryptedPayload))
  } catch {
    return {}
  }
}

/** Extract the entity key for conflict matching */
function getEntityKey(type: string, payload: Record<string, unknown>): string | null {
  if (type.startsWith('message.')) {
    return payload.messageId ? `message:${payload.messageId}` : null
  }
  if (type.startsWith('conversation.')) {
    return payload.conversationId ? `conversation:${payload.conversationId}` : null
  }
  return null
}

/** Always-safe op types that never conflict */
const ALWAYS_SAFE_TYPES = new Set(['message.create', 'import.completed'])

/** Idempotent pairs — same operation on same entity is safe */
const IDEMPOTENT_PAIRS = new Set([
  'message.deleteSubtree:message.deleteSubtree',
  'conversation.delete:conversation.delete',
])

/** Safe pairs — operations that don't conflict */
const SAFE_PAIRS = new Set([
  // createVariant is safe alongside edit (they target different messages)
  'message.edit:message.createVariant',
  'message.createVariant:message.edit',
  'message.createVariant:message.createVariant',
  // Conversation rename is safe alongside message ops
  'conversation.rename:message.edit',
  'conversation.rename:message.deleteSubtree',
  'conversation.rename:message.createVariant',
  'message.edit:conversation.rename',
  'message.deleteSubtree:conversation.rename',
  'message.createVariant:conversation.rename',
  // Delete subtree after delete conversation is idempotent
  'message.deleteSubtree:conversation.delete',
  'conversation.delete:message.deleteSubtree',
])

/** Classify conflict type from remote:local op type pair */
function classifyConflict(remoteType: string, localType: string): ConflictType {
  if (remoteType === 'message.edit' && localType === 'message.edit') return 'edit-vs-edit'
  if (remoteType === 'conversation.rename' && localType === 'conversation.rename') return 'rename-vs-rename'

  const hasDelete =
    remoteType.includes('delete') || localType.includes('delete')
  const hasRename =
    remoteType === 'conversation.rename' || localType === 'conversation.rename'

  if (hasDelete && hasRename) return 'rename-vs-delete'
  if (hasDelete) return 'edit-vs-delete'

  return 'create-vs-delete' // fallback for variant vs delete etc.
}

/**
 * Detect conflicts between remote ops and pending local ops.
 * Returns safe ops (can be applied immediately) and conflict pairs (need user resolution).
 */
export function detectConflicts(
  remoteOps: RemoteOp[],
  pendingLocalOps: SyncOp[],
): DetectionResult {
  if (pendingLocalOps.length === 0) {
    return { safe: [...remoteOps], conflicts: [] }
  }

  // Build local entity index: entityKey → SyncOp
  const localByEntity = new Map<string, SyncOp>()
  for (const local of pendingLocalOps) {
    const localPayload = JSON.parse(local.payload || '{}')
    const key = getEntityKey(local.type, localPayload)
    if (key) localByEntity.set(key, local)
  }

  const safe: RemoteOp[] = []
  const conflicts: ConflictPair[] = []

  for (const remote of remoteOps) {
    const remotePayload = decodeRemotePayload(remote)
    const remoteType = remotePayload.type as string

    // Always-safe types
    if (ALWAYS_SAFE_TYPES.has(remoteType)) {
      safe.push(remote)
      continue
    }

    const remoteKey = getEntityKey(remoteType, remotePayload)

    // No entity key or no local op on same entity → safe
    if (!remoteKey || !localByEntity.has(remoteKey)) {
      safe.push(remote)
      continue
    }

    const local = localByEntity.get(remoteKey)!
    const pairKey = `${remoteType}:${local.type}`

    // Check idempotent and explicitly safe pairs
    if (IDEMPOTENT_PAIRS.has(pairKey) || SAFE_PAIRS.has(pairKey)) {
      safe.push(remote)
      continue
    }

    // Conflict detected
    conflicts.push({
      remote,
      local,
      type: classifyConflict(remoteType, local.type),
    })
  }

  return { safe, conflicts }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/db/conflictDetector.test.ts`
Expected: all tests PASS

**Step 5: Commit**

```bash
git add src/db/conflictDetector.ts src/db/conflictDetector.test.ts
git commit -m "feat(sync): add conflict detector with tests"
```

---

### Task 3: Add discardOp to opsService

**Files:**
- Modify: `src/db/opsService.ts`
- Modify: `src/db/opsService.test.ts`

**Step 1: Write the failing test**

Add to existing `opsService.test.ts`:

```typescript
describe('discardOp', () => {
  it('deletes a pending op by id', async () => {
    const op = await appendOp('message.edit', { messageId: 'm1', content: 'x' }, 'c1', db)
    await discardOp(op.id, db)
    const pending = await getPendingOps(100, db)
    expect(pending).toHaveLength(0)
  })

  it('does nothing if op does not exist', async () => {
    await expect(discardOp('nonexistent-id', db)).resolves.not.toThrow()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/db/opsService.test.ts`
Expected: FAIL — discardOp not exported

**Step 3: Implement discardOp in opsService.ts**

Add to `src/db/opsService.ts`:

```typescript
export async function discardOp(
  opId: string,
  database: BonsaiDatabase = defaultDb,
): Promise<void> {
  await database.syncOps.delete(opId)
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/db/opsService.test.ts`
Expected: all tests PASS

**Step 5: Commit**

```bash
git add src/db/opsService.ts src/db/opsService.test.ts
git commit -m "feat(sync): add discardOp to opsService"
```

---

### Task 4: Implement syncOrchestrator with tests (TDD)

**Files:**
- Create: `src/db/syncOrchestrator.ts`
- Create: `src/db/syncOrchestrator.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSyncOrchestrator, type SyncState } from './syncOrchestrator'
import type { RemoteOp, SyncOp, ResolvedConflict } from './types'

function makeRemoteOp(overrides: Partial<RemoteOp> = {}): RemoteOp {
  return {
    id: 'r-1',
    clientId: 'device-B',
    encryptedPayload: btoa(JSON.stringify({ type: 'message.create', messageId: 'new-1' })),
    conversationId: 'conv-1',
    createdAt: '2026-03-16T00:01:00Z',
    ...overrides,
  }
}

describe('syncOrchestrator', () => {
  const mockAdapter = {
    pullRemoteOps: vi.fn(),
    pushPendingOps: vi.fn(),
    getPendingOps: vi.fn(),
    markAcked: vi.fn(),
  }
  const mockApplyOp = vi.fn()
  const mockShowConflicts = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    mockAdapter.pullRemoteOps.mockResolvedValue([])
    mockAdapter.pushPendingOps.mockResolvedValue({ pushed: 0, failed: 0 })
    mockAdapter.getPendingOps.mockResolvedValue([])
  })

  it('pulls, applies safe ops, and pushes when no conflicts', async () => {
    const remoteOp = makeRemoteOp()
    mockAdapter.pullRemoteOps.mockResolvedValue([remoteOp])
    mockAdapter.getPendingOps.mockResolvedValue([])

    const orchestrator = createSyncOrchestrator({
      adapter: mockAdapter,
      applyRemoteOp: mockApplyOp,
      showConflicts: mockShowConflicts,
      clientId: 'device-A',
    })

    await orchestrator.runSync()

    expect(mockAdapter.pullRemoteOps).toHaveBeenCalled()
    expect(mockApplyOp).toHaveBeenCalledWith(remoteOp)
    expect(mockAdapter.pushPendingOps).toHaveBeenCalled()
    expect(mockShowConflicts).not.toHaveBeenCalled()
  })

  it('shows conflict dialog when conflicts detected', async () => {
    const remoteOp = makeRemoteOp({
      encryptedPayload: btoa(JSON.stringify({ type: 'message.edit', messageId: 'msg-1', content: 'remote' })),
    })
    const localOp: SyncOp = {
      id: 'l-1',
      createdAt: '2026-03-16T00:00:00Z',
      conversationId: 'conv-1',
      type: 'message.edit',
      payload: JSON.stringify({ messageId: 'msg-1', content: 'local' }),
      status: 'pending',
      clientId: 'device-A',
      schemaVersion: 1,
    }

    mockAdapter.pullRemoteOps.mockResolvedValue([remoteOp])
    mockAdapter.getPendingOps.mockResolvedValue([localOp])
    mockShowConflicts.mockResolvedValue([
      { pair: { remote: remoteOp, local: localOp, type: 'edit-vs-edit' }, resolution: 'keep-remote' },
    ])

    const orchestrator = createSyncOrchestrator({
      adapter: mockAdapter,
      applyRemoteOp: mockApplyOp,
      showConflicts: mockShowConflicts,
      clientId: 'device-A',
    })

    await orchestrator.runSync()

    expect(mockShowConflicts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: 'edit-vs-edit' }),
      ]),
    )
  })

  it('reports sync state transitions', async () => {
    mockAdapter.pullRemoteOps.mockResolvedValue([])
    mockAdapter.getPendingOps.mockResolvedValue([])

    const states: SyncState[] = []
    const orchestrator = createSyncOrchestrator({
      adapter: mockAdapter,
      applyRemoteOp: mockApplyOp,
      showConflicts: mockShowConflicts,
      clientId: 'device-A',
      onStateChange: (s) => states.push(s),
    })

    await orchestrator.runSync()

    expect(states).toContain('pulling')
    expect(states).toContain('pushing')
    expect(states[states.length - 1]).toBe('idle')
  })

  it('transitions to error state on failure', async () => {
    mockAdapter.pullRemoteOps.mockRejectedValue(new Error('network fail'))

    const states: SyncState[] = []
    const orchestrator = createSyncOrchestrator({
      adapter: mockAdapter,
      applyRemoteOp: mockApplyOp,
      showConflicts: mockShowConflicts,
      clientId: 'device-A',
      onStateChange: (s) => states.push(s),
    })

    await orchestrator.runSync()

    expect(states).toContain('error')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/db/syncOrchestrator.test.ts`
Expected: FAIL — module not found

**Step 3: Implement syncOrchestrator.ts**

```typescript
import { detectConflicts } from './conflictDetector'
import type { RemoteOp, SyncOp, ConflictPair, ResolvedConflict } from './types'

export type SyncState = 'idle' | 'pulling' | 'resolving' | 'pushing' | 'error'

interface SyncAdapter {
  pullRemoteOps(clientId: string, since?: string): Promise<RemoteOp[]>
  pushPendingOps(): Promise<{ pushed: number; failed: number }>
  getPendingOps(): Promise<SyncOp[]>
  markAcked(opIds: string[]): Promise<void>
}

interface SyncOrchestratorOptions {
  adapter: SyncAdapter
  applyRemoteOp: (op: RemoteOp) => Promise<void>
  showConflicts: (conflicts: ConflictPair[]) => Promise<ResolvedConflict[]>
  clientId: string
  onStateChange?: (state: SyncState) => void
}

export function createSyncOrchestrator(options: SyncOrchestratorOptions) {
  const { adapter, applyRemoteOp, showConflicts, clientId, onStateChange } = options
  let lastSyncTimestamp: string | undefined
  let state: SyncState = 'idle'

  function setState(next: SyncState) {
    state = next
    onStateChange?.(next)
  }

  async function runSync(): Promise<void> {
    try {
      // Pull
      setState('pulling')
      const remoteOps = await adapter.pullRemoteOps(clientId, lastSyncTimestamp)
      const pendingLocal = await adapter.getPendingOps()

      // Detect conflicts
      const { safe, conflicts } = detectConflicts(remoteOps, pendingLocal)

      // Apply safe ops
      for (const op of safe) {
        await applyRemoteOp(op)
      }

      // Resolve conflicts if any
      if (conflicts.length > 0) {
        setState('resolving')
        const resolutions = await showConflicts(conflicts)
        for (const resolved of resolutions) {
          if (resolved.resolution === 'keep-remote' || resolved.resolution === 'keep-both') {
            await applyRemoteOp(resolved.pair.remote)
          }
          // 'keep-local' and 'keep-both' keep the local op (it will push normally)
          // 'keep-remote' needs the local op discarded (handled by caller)
        }
      }

      // Update last sync timestamp
      const allOps = [...remoteOps]
      if (allOps.length > 0) {
        lastSyncTimestamp = allOps[allOps.length - 1].createdAt
      }

      // Push
      setState('pushing')
      await adapter.pushPendingOps()

      setState('idle')
    } catch (err) {
      console.error('Sync failed:', err)
      setState('error')
    }
  }

  return {
    runSync,
    getState: () => state,
    getLastSyncTimestamp: () => lastSyncTimestamp,
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/db/syncOrchestrator.test.ts`
Expected: all tests PASS

**Step 5: Commit**

```bash
git add src/db/syncOrchestrator.ts src/db/syncOrchestrator.test.ts
git commit -m "feat(sync): add sync orchestrator with conflict detection"
```

---

### Task 5: Build ConflictResolver Vue component

**Files:**
- Create: `src/components/ConflictResolver.vue`

**Step 1: Implement the component**

Modal dialog that shows one conflict at a time. Uses the same styling patterns as LockScreen.vue (full-screen overlay, centered modal card, dark theme).

Props:
- `conflicts: ConflictPair[]`

Emits:
- `resolved: ResolvedConflict[]`

Reactive state:
- `currentIndex: number` — which conflict is shown
- `resolutions: Map<number, Resolution>` — user choices

Features:
- Shows conflict type description, local vs remote content
- Three buttons: Keep Mine, Keep Theirs, Keep Both
- Progress indicator: "Conflict 1 of 3"
- "Done" button enabled only when all conflicts resolved
- For `edit-vs-edit`: shows both content strings side by side
- For `*-vs-delete`: shows "deleted on other device" message
- For `rename-vs-rename`: shows both titles

The component decodes `remote.encryptedPayload` via `atob()` + `JSON.parse()` to display remote content. Local content comes from `local.payload` (already JSON).

**Step 2: Commit**

```bash
git add src/components/ConflictResolver.vue
git commit -m "feat(sync): add ConflictResolver dialog component"
```

---

### Task 6: Add component tests for ConflictResolver

**Files:**
- Create: `src/components/ConflictResolver.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ConflictResolver from './ConflictResolver.vue'
import type { ConflictPair } from '@/db/types'

function makeConflictPair(type: ConflictPair['type'] = 'edit-vs-edit'): ConflictPair {
  return {
    remote: {
      id: 'r1',
      clientId: 'device-B',
      encryptedPayload: btoa(JSON.stringify({
        type: 'message.edit',
        messageId: 'msg-1',
        content: 'Remote version',
      })),
      conversationId: 'conv-1',
      createdAt: '2026-03-16T00:01:00Z',
    },
    local: {
      id: 'l1',
      createdAt: '2026-03-16T00:00:00Z',
      conversationId: 'conv-1',
      type: 'message.edit',
      payload: JSON.stringify({ messageId: 'msg-1', content: 'Local version' }),
      status: 'pending' as const,
      clientId: 'device-A',
      schemaVersion: 1,
    },
    type,
  }
}

describe('ConflictResolver', () => {
  it('renders conflict info', () => {
    const wrapper = mount(ConflictResolver, {
      props: { conflicts: [makeConflictPair()] },
    })
    expect(wrapper.text()).toContain('Conflict 1 of 1')
    expect(wrapper.text()).toContain('Local version')
    expect(wrapper.text()).toContain('Remote version')
  })

  it('emits resolved when all conflicts are resolved', async () => {
    const wrapper = mount(ConflictResolver, {
      props: { conflicts: [makeConflictPair()] },
    })
    await wrapper.find('[data-testid="keep-remote"]').trigger('click')
    await wrapper.find('[data-testid="done-btn"]').trigger('click')
    const emitted = wrapper.emitted('resolved')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toHaveLength(1)
    expect((emitted![0][0] as any)[0].resolution).toBe('keep-remote')
  })

  it('navigates between multiple conflicts', async () => {
    const conflicts = [makeConflictPair(), { ...makeConflictPair(), remote: { ...makeConflictPair().remote, id: 'r2' } }]
    const wrapper = mount(ConflictResolver, {
      props: { conflicts },
    })
    expect(wrapper.text()).toContain('Conflict 1 of 2')
    await wrapper.find('[data-testid="next-btn"]').trigger('click')
    expect(wrapper.text()).toContain('Conflict 2 of 2')
  })
})
```

**Step 2: Run tests**

Run: `npm test -- src/components/ConflictResolver.test.ts`
Expected: all tests PASS

**Step 3: Commit**

```bash
git add src/components/ConflictResolver.test.ts
git commit -m "test(sync): add ConflictResolver component tests"
```

---

### Task 7: Wire sync orchestrator into the app

**Files:**
- Create: `src/composables/useSync.ts`
- Modify: `src/App.vue` — mount sync trigger
- Modify: `src/db/remoteSyncAdapter.ts` — add applyRemoteOp method

**Step 1: Create useSync composable**

```typescript
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { createSyncOrchestrator, type SyncState } from '@/db/syncOrchestrator'
import { RemoteSyncAdapter } from '@/db/remoteSyncAdapter'
import { useAuthStore } from '@/stores/authStore'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { getOrCreateClientId } from '@/db/opsService'
import type { ConflictPair, ResolvedConflict } from '@/db/types'

export function useSync() {
  const syncState = ref<SyncState>('idle')
  const pendingConflicts = ref<ConflictPair[]>([])
  const resolveConflictsCallback = ref<((resolutions: ResolvedConflict[]) => void) | null>(null)
  const authStore = useAuthStore()
  const { isOnline } = useOnlineStatus()

  let syncInterval: ReturnType<typeof setInterval> | null = null
  let orchestrator: ReturnType<typeof createSyncOrchestrator> | null = null

  function initSync() {
    if (!authStore.isAuthenticated) return

    const serverUrl = import.meta.env.VITE_SYNC_SERVER_URL || 'http://localhost:3000'
    const adapter = new RemoteSyncAdapter(serverUrl, () => Promise.resolve(authStore.accessToken))
    const clientId = getOrCreateClientId()

    orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp: async (op) => {
        // TODO: wire to conversationStore.applyRemoteOp()
        console.log('Apply remote op:', op.id)
      },
      showConflicts: (conflicts) => {
        return new Promise((resolve) => {
          pendingConflicts.value = conflicts
          resolveConflictsCallback.value = resolve
        })
      },
      clientId,
      onStateChange: (s) => { syncState.value = s },
    })
  }

  async function triggerSync() {
    if (!orchestrator || !isOnline.value || !authStore.isAuthenticated) return
    await orchestrator.runSync()
  }

  function resolveConflicts(resolutions: ResolvedConflict[]) {
    resolveConflictsCallback.value?.(resolutions)
    pendingConflicts.value = []
    resolveConflictsCallback.value = null
  }

  onMounted(() => {
    initSync()
    triggerSync()
    syncInterval = setInterval(triggerSync, 60_000)
  })

  onUnmounted(() => {
    if (syncInterval) clearInterval(syncInterval)
  })

  // Re-sync when coming back online
  watch(isOnline, (online) => {
    if (online) triggerSync()
  })

  return { syncState, pendingConflicts, resolveConflicts, triggerSync }
}
```

**Step 2: Mount in App.vue**

Add `useSync()` call in App.vue setup and render ConflictResolver when `pendingConflicts.length > 0`.

**Step 3: Commit**

```bash
git add src/composables/useSync.ts src/App.vue src/db/remoteSyncAdapter.ts
git commit -m "feat(sync): wire sync orchestrator into app with 60s interval"
```

---

### Task 8: Add sync status UI and manual sync button

**Files:**
- Modify: `src/views/SettingsView.vue` — add sync status indicator and "Sync now" button

**Step 1: Add to Settings sync diagnostics section**

Add sync state display (`idle`, `pulling`, `resolving`, `pushing`, `error`) and a "Sync now" button that calls `triggerSync()`. Show last sync timestamp.

**Step 2: Commit**

```bash
git add src/views/SettingsView.vue
git commit -m "feat(sync): add sync status and manual sync button to Settings"
```

---

### Task 9: E2E test for conflict resolution flow

**Files:**
- Create: `e2e/conflict-resolution.spec.ts`

**Step 1: Write E2E test**

Test the conflict flow by:
1. Create a conversation and message locally
2. Push ops to server (via the sync adapter or direct API)
3. Simulate a remote op that conflicts (push directly via fetch to the server)
4. Trigger a sync pull
5. Verify the ConflictResolver dialog appears
6. Click "Keep theirs" and verify the resolution applies

**Step 2: Run E2E tests**

Run: `npm run test:e2e -- conflict-resolution.spec.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add e2e/conflict-resolution.spec.ts
git commit -m "test(sync): add e2e test for conflict resolution flow"
```

---

### Task 10: Final verification and docs update

**Files:**
- Modify: `PROJECT_STATUS.md`
- Modify: `AGENT_NOTES.md`

**Step 1: Run full test suite**

```bash
npm test
npm run type-check
npm run test:e2e
```

All must pass (Green Bar Rule).

**Step 2: Update PROJECT_STATUS.md**

Add a new milestone entry for conflict resolution with notes.

**Step 3: Commit**

```bash
git add PROJECT_STATUS.md AGENT_NOTES.md
git commit -m "docs: update status for conflict resolution milestone"
```
