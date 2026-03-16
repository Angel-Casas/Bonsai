/**
 * Unit tests for conflictDetector — pure conflict detection between
 * remote ops and pending local ops.
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect } from 'vitest'
import { detectConflicts } from './conflictDetector'
import type { RemoteOp, SyncOp, OpType, ConflictType } from './types'

// ---------------------------------------------------------------------------
// Helpers to build test fixtures
// ---------------------------------------------------------------------------

let _idCounter = 0
function nextId(): string {
  return `test-id-${++_idCounter}`
}

/**
 * Build a RemoteOp whose encryptedPayload is btoa(JSON.stringify(payload)).
 */
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

/**
 * Build a local SyncOp (pending).
 */
function makeLocalOp(
  type: OpType,
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
// Tests
// ---------------------------------------------------------------------------

describe('detectConflicts', () => {
  // ========================================================================
  // Edge: no pending local ops → everything safe
  // ========================================================================

  it('returns all remote ops as safe when there are no pending local ops', () => {
    const remote1 = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const remote2 = makeRemoteOp({
      decodedPayload: { type: 'conversation.rename', conversationId: 'c2', title: 'hi' },
      conversationId: 'c2',
    })

    const result = detectConflicts([remote1, remote2], [])

    expect(result.safe).toEqual([remote1, remote2])
    expect(result.conflicts).toEqual([])
  })

  // ========================================================================
  // message.create is ALWAYS safe
  // ========================================================================

  it('treats message.create as always safe even with matching entity ops locally', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.create', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([remote])
    expect(result.conflicts).toEqual([])
  })

  // ========================================================================
  // import.completed is ALWAYS safe
  // ========================================================================

  it('treats import.completed as always safe', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'import.completed', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([remote])
    expect(result.conflicts).toEqual([])
  })

  // ========================================================================
  // Ops on different entities → safe
  // ========================================================================

  it('treats ops on different messages as safe', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'x' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm2',
      conversationId: 'c1',
      content: 'y',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([remote])
    expect(result.conflicts).toEqual([])
  })

  it('treats ops on different conversations as safe', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'conversation.rename', conversationId: 'c1', title: 'a' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('conversation.rename', {
      type: 'conversation.rename',
      conversationId: 'c2',
      title: 'b',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([remote])
    expect(result.conflicts).toEqual([])
  })

  // ========================================================================
  // edit-vs-edit on same messageId
  // ========================================================================

  it('detects edit-vs-edit conflict on same messageId', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'remote' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'local',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toEqual({
      remote,
      local,
      type: 'edit-vs-edit' as ConflictType,
    })
  })

  // ========================================================================
  // Remote edit vs local delete → edit-vs-delete
  // ========================================================================

  it('detects edit-vs-delete when remote edits and local deletes same message', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'r' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.deleteSubtree', {
      type: 'message.deleteSubtree',
      messageId: 'm1',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('edit-vs-delete')
  })

  // ========================================================================
  // Remote delete vs local edit → edit-vs-delete
  // ========================================================================

  it('detects edit-vs-delete when remote deletes and local edits same message', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.deleteSubtree', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'local edit',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('edit-vs-delete')
  })

  // ========================================================================
  // Remote deleteSubtree vs local createVariant → edit-vs-delete
  // ========================================================================

  it('detects edit-vs-delete when remote deletes and local creates variant on same message', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.deleteSubtree', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.createVariant', {
      type: 'message.createVariant',
      messageId: 'm1',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('edit-vs-delete')
  })

  // ========================================================================
  // Remote createVariant vs local deleteSubtree → edit-vs-delete
  // ========================================================================

  it('detects edit-vs-delete when remote creates variant and local deletes same message', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.createVariant', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.deleteSubtree', {
      type: 'message.deleteSubtree',
      messageId: 'm1',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('edit-vs-delete')
  })

  // ========================================================================
  // rename-vs-rename on same conversationId
  // ========================================================================

  it('detects rename-vs-rename on same conversationId', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'conversation.rename', conversationId: 'c1', title: 'Remote Title' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('conversation.rename', {
      type: 'conversation.rename',
      conversationId: 'c1',
      title: 'Local Title',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('rename-vs-rename')
  })

  // ========================================================================
  // Remote delete conversation vs local rename → rename-vs-delete
  // ========================================================================

  it('detects rename-vs-delete when remote deletes conversation and local renames it', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'conversation.delete', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('conversation.rename', {
      type: 'conversation.rename',
      conversationId: 'c1',
      title: 'My Title',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('rename-vs-delete')
  })

  // ========================================================================
  // Remote rename vs local delete conversation → rename-vs-delete
  // ========================================================================

  it('detects rename-vs-delete when remote renames and local deletes same conversation', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'conversation.rename', conversationId: 'c1', title: 'Remote' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('conversation.delete', {
      type: 'conversation.delete',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('rename-vs-delete')
  })

  // ========================================================================
  // conversation.delete vs message.edit in that conversation → create-vs-delete
  // ========================================================================

  it('detects create-vs-delete when remote deletes conversation and local edits a message in it', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'conversation.delete', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'edited',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('create-vs-delete')
  })

  // ========================================================================
  // conversation.delete vs message.createVariant in that conversation → create-vs-delete
  // ========================================================================

  it('detects create-vs-delete when remote deletes conversation and local creates variant in it', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'conversation.delete', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.createVariant', {
      type: 'message.createVariant',
      messageId: 'm1',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('create-vs-delete')
  })

  // ========================================================================
  // message.edit vs conversation.delete (local deletes conv) → create-vs-delete
  // ========================================================================

  it('detects create-vs-delete when remote edits message and local deletes its conversation', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'r' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('conversation.delete', {
      type: 'conversation.delete',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe('create-vs-delete')
  })

  // ========================================================================
  // delete-vs-delete is idempotent → safe
  // ========================================================================

  it('treats message deleteSubtree vs deleteSubtree on same message as safe (idempotent)', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.deleteSubtree', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.deleteSubtree', {
      type: 'message.deleteSubtree',
      messageId: 'm1',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([remote])
    expect(result.conflicts).toEqual([])
  })

  it('treats conversation delete vs delete on same conversation as safe (idempotent)', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'conversation.delete', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('conversation.delete', {
      type: 'conversation.delete',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([remote])
    expect(result.conflicts).toEqual([])
  })

  // ========================================================================
  // Mixed safe and conflicting ops separated correctly
  // ========================================================================

  it('separates mixed safe and conflicting remote ops correctly', () => {
    const safeRemote = makeRemoteOp({
      decodedPayload: { type: 'message.create', messageId: 'm-new', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const conflictingRemote = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm1', conversationId: 'c1', content: 'r' },
      conversationId: 'c1',
    })
    const differentEntityRemote = makeRemoteOp({
      decodedPayload: { type: 'message.edit', messageId: 'm99', conversationId: 'c2', content: 'z' },
      conversationId: 'c2',
    })

    const local = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'local',
    })

    const result = detectConflicts(
      [safeRemote, conflictingRemote, differentEntityRemote],
      [local],
    )

    expect(result.safe).toEqual([safeRemote, differentEntityRemote])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].remote).toBe(conflictingRemote)
    expect(result.conflicts[0].local).toBe(local)
    expect(result.conflicts[0].type).toBe('edit-vs-edit')
  })

  // ========================================================================
  // conversation.delete conflicts with ANY local op in that conversation
  // ========================================================================

  it('conversation.delete conflicts with all local ops in that conversation', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'conversation.delete', conversationId: 'c1' },
      conversationId: 'c1',
    })

    const localEdit = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'edited',
    })
    const localRename = makeLocalOp('conversation.rename', {
      type: 'conversation.rename',
      conversationId: 'c1',
      title: 'renamed',
    })
    const localVariant = makeLocalOp('message.createVariant', {
      type: 'message.createVariant',
      messageId: 'm2',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [localEdit, localRename, localVariant])

    // The remote op should NOT be in safe
    expect(result.safe).toEqual([])
    // All 3 local ops conflict with the remote delete
    expect(result.conflicts).toHaveLength(3)
    expect(result.conflicts.map((c) => c.type)).toContain('create-vs-delete')
    expect(result.conflicts.map((c) => c.type)).toContain('rename-vs-delete')
  })

  // ========================================================================
  // Remote op can conflict with multiple local ops
  // ========================================================================

  it('a single remote op can produce multiple conflict pairs with different local ops', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.deleteSubtree', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
    })

    const localEdit = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'edited',
    })
    const localVariant = makeLocalOp('message.createVariant', {
      type: 'message.createVariant',
      messageId: 'm1',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [localEdit, localVariant])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toHaveLength(2)
    expect(result.conflicts[0].type).toBe('edit-vs-delete')
    expect(result.conflicts[1].type).toBe('edit-vs-delete')
  })

  // ========================================================================
  // Empty remote ops → empty result
  // ========================================================================

  it('returns empty arrays when no remote ops provided', () => {
    const local = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm1',
      conversationId: 'c1',
    })

    const result = detectConflicts([], [local])

    expect(result.safe).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  // ========================================================================
  // message.createVariant vs message.edit on different messages → safe
  // ========================================================================

  it('treats createVariant vs edit on different messages as safe', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.createVariant', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.edit', {
      type: 'message.edit',
      messageId: 'm2',
      conversationId: 'c1',
      content: 'local',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([remote])
    expect(result.conflicts).toEqual([])
  })

  // ========================================================================
  // local message.create never causes conflicts
  // ========================================================================

  it('local message.create never conflicts with remote ops', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'message.deleteSubtree', messageId: 'm1', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('message.create', {
      type: 'message.create',
      messageId: 'm1',
      conversationId: 'c1',
      content: 'new',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([remote])
    expect(result.conflicts).toEqual([])
  })

  // ========================================================================
  // local import.completed never causes conflicts
  // ========================================================================

  it('local import.completed never conflicts with remote ops', () => {
    const remote = makeRemoteOp({
      decodedPayload: { type: 'conversation.delete', conversationId: 'c1' },
      conversationId: 'c1',
    })
    const local = makeLocalOp('import.completed', {
      type: 'import.completed',
      conversationId: 'c1',
    })

    const result = detectConflicts([remote], [local])

    expect(result.safe).toEqual([remote])
    expect(result.conflicts).toEqual([])
  })
})
