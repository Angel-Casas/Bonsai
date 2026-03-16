/**
 * Unit tests for syncOrchestrator — coordinates pull → detect → resolve → push flow.
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RemoteOp, SyncOp, ConflictPair, ResolvedConflict } from './types'
import { createSyncOrchestrator } from './syncOrchestrator'
import type { SyncAdapter, SyncState } from './syncOrchestrator'

// ---------------------------------------------------------------------------
// Helpers to build test fixtures
// ---------------------------------------------------------------------------

let _idCounter = 0
function nextId(): string {
  return `test-id-${++_idCounter}`
}

function makeRemoteOp(
  overrides: Partial<RemoteOp> & { decodedPayload?: Record<string, unknown> } = {},
): RemoteOp {
  const payload = overrides.decodedPayload ?? {}
  const { decodedPayload: _, ...rest } = overrides
  return {
    id: nextId(),
    clientId: 'remote-client',
    encryptedPayload: btoa(JSON.stringify(payload)),
    conversationId: (payload as Record<string, unknown>).conversationId as string | null ?? null,
    createdAt: new Date().toISOString(),
    ...rest,
  }
}

function makeLocalOp(
  type: SyncOp['type'],
  payload: Record<string, unknown>,
  overrides: Partial<SyncOp> = {},
): SyncOp {
  return {
    id: nextId(),
    createdAt: new Date().toISOString(),
    conversationId: (payload.conversationId as string) ?? null,
    type,
    payload: JSON.stringify(payload),
    payloadEnc: null,
    status: 'pending',
    clientId: 'local-client',
    schemaVersion: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

function createMockAdapter(overrides: Partial<SyncAdapter> = {}): SyncAdapter {
  return {
    pullRemoteOps: vi.fn().mockResolvedValue([]),
    pushPendingOps: vi.fn().mockResolvedValue({ pushed: 0, failed: 0 }),
    getPendingOps: vi.fn().mockResolvedValue([]),
    markAcked: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSyncOrchestrator', () => {
  beforeEach(() => {
    _idCounter = 0
  })

  // ========================================================================
  // 1. No conflicts flow
  // ========================================================================

  it('pulls, applies safe ops, pushes when there are no conflicts', async () => {
    const remoteOp1 = makeRemoteOp({
      decodedPayload: { type: 'message.create', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:00:00.000Z',
    })
    const remoteOp2 = makeRemoteOp({
      decodedPayload: { type: 'message.create', messageId: 'm2', conversationId: 'c1' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:01:00.000Z',
    })

    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([remoteOp1, remoteOp2]),
      pushPendingOps: vi.fn().mockResolvedValue({ pushed: 0, failed: 0 }),
    })

    const applyRemoteOp = vi.fn().mockResolvedValue(undefined)
    const showConflicts = vi.fn()

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
    })

    await orchestrator.runSync()

    // adapter.pullRemoteOps was called
    expect(adapter.pullRemoteOps).toHaveBeenCalledWith('local-client', undefined)

    // Both safe ops were applied
    expect(applyRemoteOp).toHaveBeenCalledTimes(2)
    expect(applyRemoteOp).toHaveBeenCalledWith(remoteOp1)
    expect(applyRemoteOp).toHaveBeenCalledWith(remoteOp2)

    // pushPendingOps was called
    expect(adapter.pushPendingOps).toHaveBeenCalledTimes(1)

    // showConflicts was NOT called (no conflicts)
    expect(showConflicts).not.toHaveBeenCalled()
  })

  // ========================================================================
  // 2. Conflict triggers showConflicts
  // ========================================================================

  it('calls showConflicts when conflicts are detected', async () => {
    const remoteOp = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'remote' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:00:00.000Z',
    })

    const localOp = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'local',
    })

    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([remoteOp]),
      getPendingOps: vi.fn().mockResolvedValue([localOp]),
    })

    const applyRemoteOp = vi.fn().mockResolvedValue(undefined)

    // showConflicts returns 'keep-remote' resolution
    const showConflicts = vi.fn().mockResolvedValue([
      {
        pair: {
          remote: remoteOp,
          local: localOp,
          type: 'edit-vs-edit',
        },
        resolution: 'keep-remote' as const,
      },
    ] satisfies ResolvedConflict[])

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
    })

    await orchestrator.runSync()

    // showConflicts was called with the conflict pairs
    expect(showConflicts).toHaveBeenCalledTimes(1)
    const calledWithConflicts = showConflicts.mock.calls[0][0] as ConflictPair[]
    expect(calledWithConflicts).toHaveLength(1)
    expect(calledWithConflicts[0].type).toBe('edit-vs-edit')
    expect(calledWithConflicts[0].remote).toBe(remoteOp)
    expect(calledWithConflicts[0].local).toBe(localOp)
  })

  // ========================================================================
  // 2b. Resolution: keep-remote applies the remote op
  // ========================================================================

  it('applies remote op when resolution is keep-remote', async () => {
    const remoteOp = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'remote' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:00:00.000Z',
    })

    const localOp = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'local',
    })

    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([remoteOp]),
      getPendingOps: vi.fn().mockResolvedValue([localOp]),
    })

    const applyRemoteOp = vi.fn().mockResolvedValue(undefined)

    const showConflicts = vi.fn().mockResolvedValue([
      {
        pair: { remote: remoteOp, local: localOp, type: 'edit-vs-edit' },
        resolution: 'keep-remote' as const,
      },
    ])

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
    })

    await orchestrator.runSync()

    // applyRemoteOp is called for keep-remote resolution
    expect(applyRemoteOp).toHaveBeenCalledWith(remoteOp)
  })

  // ========================================================================
  // 2c. Resolution: keep-both applies the remote op
  // ========================================================================

  it('applies remote op when resolution is keep-both', async () => {
    const remoteOp = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'remote' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:00:00.000Z',
    })

    const localOp = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'local',
    })

    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([remoteOp]),
      getPendingOps: vi.fn().mockResolvedValue([localOp]),
    })

    const applyRemoteOp = vi.fn().mockResolvedValue(undefined)

    const showConflicts = vi.fn().mockResolvedValue([
      {
        pair: { remote: remoteOp, local: localOp, type: 'edit-vs-edit' },
        resolution: 'keep-both' as const,
      },
    ])

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
    })

    await orchestrator.runSync()

    // applyRemoteOp is called for keep-both resolution (remote applied, local stays pending)
    expect(applyRemoteOp).toHaveBeenCalledWith(remoteOp)
  })

  // ========================================================================
  // 2d. Resolution: keep-local does NOT apply the remote op
  // ========================================================================

  it('does NOT apply remote op when resolution is keep-local', async () => {
    const remoteOp = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'remote' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:00:00.000Z',
    })

    const localOp = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'local',
    })

    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([remoteOp]),
      getPendingOps: vi.fn().mockResolvedValue([localOp]),
    })

    const applyRemoteOp = vi.fn().mockResolvedValue(undefined)

    const showConflicts = vi.fn().mockResolvedValue([
      {
        pair: { remote: remoteOp, local: localOp, type: 'edit-vs-edit' },
        resolution: 'keep-local' as const,
      },
    ])

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
    })

    await orchestrator.runSync()

    // applyRemoteOp should NOT be called for keep-local
    expect(applyRemoteOp).not.toHaveBeenCalled()
  })

  // ========================================================================
  // 3. State transitions: pulling → pushing → idle (no conflicts)
  // ========================================================================

  it('transitions through pulling → pushing → idle when no conflicts', async () => {
    const remoteOp = makeRemoteOp({
      decodedPayload: { type: 'message.create', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:00:00.000Z',
    })

    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([remoteOp]),
    })

    const applyRemoteOp = vi.fn().mockResolvedValue(undefined)
    const showConflicts = vi.fn()
    const stateChanges: SyncState[] = []

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
      onStateChange: (state) => stateChanges.push(state),
    })

    expect(orchestrator.getState()).toBe('idle')

    await orchestrator.runSync()

    expect(stateChanges).toEqual(['pulling', 'pushing', 'idle'])
    expect(orchestrator.getState()).toBe('idle')
  })

  // ========================================================================
  // 3b. State transitions with conflicts: pulling → resolving → pushing → idle
  // ========================================================================

  it('transitions through pulling → resolving → pushing → idle when conflicts exist', async () => {
    const remoteOp = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'remote' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:00:00.000Z',
    })

    const localOp = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'local',
    })

    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([remoteOp]),
      getPendingOps: vi.fn().mockResolvedValue([localOp]),
    })

    const applyRemoteOp = vi.fn().mockResolvedValue(undefined)
    const showConflicts = vi.fn().mockResolvedValue([
      {
        pair: { remote: remoteOp, local: localOp, type: 'edit-vs-edit' },
        resolution: 'keep-remote' as const,
      },
    ])

    const stateChanges: SyncState[] = []

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
      onStateChange: (state) => stateChanges.push(state),
    })

    await orchestrator.runSync()

    expect(stateChanges).toEqual(['pulling', 'resolving', 'pushing', 'idle'])
  })

  // ========================================================================
  // 4. Error state: adapter.pullRemoteOps rejects
  // ========================================================================

  it('transitions to error state when pullRemoteOps rejects', async () => {
    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockRejectedValue(new Error('Network failure')),
    })

    const applyRemoteOp = vi.fn()
    const showConflicts = vi.fn()
    const stateChanges: SyncState[] = []
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
      onStateChange: (state) => stateChanges.push(state),
    })

    await orchestrator.runSync()

    expect(orchestrator.getState()).toBe('error')
    expect(stateChanges).toContain('error')
    expect(consoleSpy).toHaveBeenCalled()

    // applyRemoteOp and pushPendingOps should not be called
    expect(applyRemoteOp).not.toHaveBeenCalled()
    expect(adapter.pushPendingOps).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  // ========================================================================
  // 4b. Error state: adapter.pushPendingOps rejects
  // ========================================================================

  it('transitions to error state when pushPendingOps rejects', async () => {
    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([]),
      pushPendingOps: vi.fn().mockRejectedValue(new Error('Push failed')),
    })

    const applyRemoteOp = vi.fn()
    const showConflicts = vi.fn()
    const stateChanges: SyncState[] = []
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
      onStateChange: (state) => stateChanges.push(state),
    })

    await orchestrator.runSync()

    expect(orchestrator.getState()).toBe('error')
    expect(stateChanges).toContain('error')

    consoleSpy.mockRestore()
  })

  // ========================================================================
  // 5. Last sync timestamp updates
  // ========================================================================

  it('updates lastSyncTimestamp from the latest remote op createdAt', async () => {
    const remoteOp1 = makeRemoteOp({
      decodedPayload: { type: 'message.create', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:00:00.000Z',
    })
    const remoteOp2 = makeRemoteOp({
      decodedPayload: { type: 'message.create', messageId: 'm2', conversationId: 'c1' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:05:00.000Z',
    })

    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([remoteOp1, remoteOp2]),
    })

    const applyRemoteOp = vi.fn().mockResolvedValue(undefined)
    const showConflicts = vi.fn()

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
    })

    // Before sync, no timestamp
    expect(orchestrator.getLastSyncTimestamp()).toBeUndefined()

    await orchestrator.runSync()

    // After sync, should be the latest createdAt
    expect(orchestrator.getLastSyncTimestamp()).toBe('2026-03-16T10:05:00.000Z')
  })

  // ========================================================================
  // 5b. Subsequent sync passes lastSyncTimestamp to pullRemoteOps
  // ========================================================================

  it('passes lastSyncTimestamp to pullRemoteOps on subsequent calls', async () => {
    const remoteOp = makeRemoteOp({
      decodedPayload: { type: 'message.create', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:00:00.000Z',
    })

    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn()
        .mockResolvedValueOnce([remoteOp])
        .mockResolvedValueOnce([]),
    })

    const applyRemoteOp = vi.fn().mockResolvedValue(undefined)
    const showConflicts = vi.fn()

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
    })

    // First sync
    await orchestrator.runSync()
    expect(adapter.pullRemoteOps).toHaveBeenCalledWith('local-client', undefined)

    // Second sync should pass the timestamp
    await orchestrator.runSync()
    expect(adapter.pullRemoteOps).toHaveBeenCalledWith('local-client', '2026-03-16T10:00:00.000Z')
  })

  // ========================================================================
  // 5c. lastSyncTimestamp does NOT update on error
  // ========================================================================

  it('does not update lastSyncTimestamp when sync fails', async () => {
    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockRejectedValue(new Error('fail')),
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp: vi.fn(),
      showConflicts: vi.fn(),
      clientId: 'local-client',
    })

    await orchestrator.runSync()

    expect(orchestrator.getLastSyncTimestamp()).toBeUndefined()

    consoleSpy.mockRestore()
  })

  // ========================================================================
  // 5d. lastSyncTimestamp does NOT update when no remote ops returned
  // ========================================================================

  it('does not update lastSyncTimestamp when no remote ops returned', async () => {
    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([]),
    })

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp: vi.fn(),
      showConflicts: vi.fn(),
      clientId: 'local-client',
    })

    await orchestrator.runSync()

    expect(orchestrator.getLastSyncTimestamp()).toBeUndefined()
  })

  // ========================================================================
  // Mixed: safe ops applied, then conflicts resolved, then push
  // ========================================================================

  it('applies safe ops and resolves conflicts in the same sync cycle', async () => {
    const safeRemoteOp = makeRemoteOp({
      decodedPayload: { type: 'message.create', messageId: 'm-new', conversationId: 'c1' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:00:00.000Z',
    })

    const conflictingRemoteOp = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'remote' },
      conversationId: 'c1',
      createdAt: '2026-03-16T10:01:00.000Z',
    })

    const localOp = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'local',
    })

    const adapter = createMockAdapter({
      pullRemoteOps: vi.fn().mockResolvedValue([safeRemoteOp, conflictingRemoteOp]),
      getPendingOps: vi.fn().mockResolvedValue([localOp]),
    })

    const applyRemoteOp = vi.fn().mockResolvedValue(undefined)

    const showConflicts = vi.fn().mockResolvedValue([
      {
        pair: { remote: conflictingRemoteOp, local: localOp, type: 'edit-vs-edit' },
        resolution: 'keep-local' as const,
      },
    ])

    const orchestrator = createSyncOrchestrator({
      adapter,
      applyRemoteOp,
      showConflicts,
      clientId: 'local-client',
    })

    await orchestrator.runSync()

    // Safe op applied
    expect(applyRemoteOp).toHaveBeenCalledWith(safeRemoteOp)

    // Conflicting op NOT applied (keep-local)
    expect(applyRemoteOp).not.toHaveBeenCalledWith(conflictingRemoteOp)

    // Total: only 1 call to applyRemoteOp
    expect(applyRemoteOp).toHaveBeenCalledTimes(1)

    // showConflicts was called
    expect(showConflicts).toHaveBeenCalledTimes(1)

    // Push still happens
    expect(adapter.pushPendingOps).toHaveBeenCalledTimes(1)
  })
})
