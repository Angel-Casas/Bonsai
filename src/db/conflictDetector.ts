/**
 * Conflict Detector for Bonsai Sync
 *
 * Pure function that compares incoming remote ops against pending local ops
 * and classifies each remote op as "safe" or "conflicting".
 *
 * This implements the conflict matrix defined in the sync-ready ops log design.
 */

import type { RemoteOp, SyncOp, ConflictPair, ConflictType, OpType } from './types'

// ---------------------------------------------------------------------------
// Payload decoding
// ---------------------------------------------------------------------------

interface DecodedPayload {
  type: OpType
  messageId?: string
  conversationId?: string
  [key: string]: unknown
}

/**
 * Decode a remote op's encryptedPayload (btoa-encoded JSON).
 */
function decodeRemotePayload(op: RemoteOp): DecodedPayload {
  return JSON.parse(atob(op.encryptedPayload)) as DecodedPayload
}

/**
 * Decode a local op's JSON payload string.
 */
function decodeLocalPayload(op: SyncOp): DecodedPayload {
  return JSON.parse(op.payload) as DecodedPayload
}

// ---------------------------------------------------------------------------
// Always-safe op types (never conflict regardless of what's pending)
// ---------------------------------------------------------------------------

const ALWAYS_SAFE_TYPES: ReadonlySet<OpType> = new Set([
  'message.create',
  'import.completed',
])

// ---------------------------------------------------------------------------
// Conflict matrix helpers
// ---------------------------------------------------------------------------

/**
 * Check if two ops target the same message (by messageId in their payloads).
 */
function sameMessage(a: DecodedPayload, b: DecodedPayload): boolean {
  return Boolean(a.messageId && b.messageId && a.messageId === b.messageId)
}

/**
 * Check if two ops target the same conversation (by conversationId).
 * Uses the payload conversationId field.
 */
function sameConversation(
  aPayload: DecodedPayload,
  aOp: { conversationId: string | null },
  bPayload: DecodedPayload,
  bOp: { conversationId: string | null },
): boolean {
  // Prefer conversationId from the payload, fall back to the op-level field
  const aConvId = aPayload.conversationId ?? aOp.conversationId
  const bConvId = bPayload.conversationId ?? bOp.conversationId
  return Boolean(aConvId && bConvId && aConvId === bConvId)
}

/**
 * Determine if a (remote, local) op pair constitutes a conflict.
 * Returns the ConflictType if it is a conflict, or null if safe.
 */
function classifyPair(
  remotePayload: DecodedPayload,
  remoteOp: RemoteOp,
  localPayload: DecodedPayload,
  localOp: SyncOp,
): ConflictType | null {
  const rType = remotePayload.type
  const lType = localPayload.type

  // Local always-safe types never conflict
  if (ALWAYS_SAFE_TYPES.has(lType)) {
    return null
  }

  // Remote always-safe types never conflict (already handled at caller level,
  // but defence in depth)
  if (ALWAYS_SAFE_TYPES.has(rType)) {
    return null
  }

  // -------------------------------------------------------------------
  // Idempotent delete-vs-delete (safe)
  // -------------------------------------------------------------------

  // message.deleteSubtree vs message.deleteSubtree — same message
  if (rType === 'message.deleteSubtree' && lType === 'message.deleteSubtree') {
    if (sameMessage(remotePayload, localPayload)) {
      return null // idempotent
    }
    // Different messages — no conflict
    return null
  }

  // conversation.delete vs conversation.delete — same conversation
  if (rType === 'conversation.delete' && lType === 'conversation.delete') {
    if (sameConversation(remotePayload, remoteOp, localPayload, localOp)) {
      return null // idempotent
    }
    return null
  }

  // -------------------------------------------------------------------
  // conversation.delete vs ANY local op in that conversation
  // -------------------------------------------------------------------

  if (rType === 'conversation.delete') {
    if (sameConversation(remotePayload, remoteOp, localPayload, localOp)) {
      // Classify based on local op type
      if (lType === 'conversation.rename') {
        return 'rename-vs-delete'
      }
      // message.edit, message.createVariant, message.deleteSubtree, etc.
      return 'create-vs-delete'
    }
    return null
  }

  // -------------------------------------------------------------------
  // Local conversation.delete vs remote message/conversation ops
  // -------------------------------------------------------------------

  if (lType === 'conversation.delete') {
    if (sameConversation(remotePayload, remoteOp, localPayload, localOp)) {
      if (rType === 'conversation.rename') {
        return 'rename-vs-delete'
      }
      // remote message.edit, message.createVariant, etc. in this conv
      return 'create-vs-delete'
    }
    return null
  }

  // -------------------------------------------------------------------
  // Message-level conflicts (require same messageId)
  // -------------------------------------------------------------------

  if (sameMessage(remotePayload, localPayload)) {
    // edit-vs-edit
    if (rType === 'message.edit' && lType === 'message.edit') {
      return 'edit-vs-edit'
    }

    // edit-vs-delete (either direction)
    if (
      (rType === 'message.edit' && lType === 'message.deleteSubtree') ||
      (rType === 'message.deleteSubtree' && lType === 'message.edit')
    ) {
      return 'edit-vs-delete'
    }

    // createVariant vs deleteSubtree (either direction) → edit-vs-delete
    if (
      (rType === 'message.createVariant' && lType === 'message.deleteSubtree') ||
      (rType === 'message.deleteSubtree' && lType === 'message.createVariant')
    ) {
      return 'edit-vs-delete'
    }
  }

  // -------------------------------------------------------------------
  // Conversation-level conflicts (require same conversationId)
  // -------------------------------------------------------------------

  if (sameConversation(remotePayload, remoteOp, localPayload, localOp)) {
    // rename-vs-rename
    if (rType === 'conversation.rename' && lType === 'conversation.rename') {
      return 'rename-vs-rename'
    }

    // rename-vs-delete (either direction) — already handled above for
    // conversation.delete cases; this catches conversation.rename vs
    // conversation.delete which is already handled.
  }

  // No conflict
  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DetectConflictsResult {
  /** Remote ops that are safe to apply directly */
  safe: RemoteOp[]
  /** Remote ops that conflict with pending local ops */
  conflicts: ConflictPair[]
}

/**
 * Detect conflicts between incoming remote ops and pending local ops.
 *
 * A remote op is "safe" if it does not conflict with ANY pending local op.
 * A remote op is "conflicting" if it conflicts with ONE OR MORE local ops
 * (producing one ConflictPair per conflicting local op).
 *
 * @param remoteOps - Ops received from the server
 * @param pendingLocalOps - Local ops with status "pending"
 * @returns Object with `safe` remote ops and `conflicts` pairs
 */
export function detectConflicts(
  remoteOps: RemoteOp[],
  pendingLocalOps: SyncOp[],
): DetectConflictsResult {
  const safe: RemoteOp[] = []
  const conflicts: ConflictPair[] = []

  // Short-circuit: no local ops means everything is safe
  if (pendingLocalOps.length === 0) {
    return { safe: [...remoteOps], conflicts: [] }
  }

  // Pre-decode local payloads once
  const decodedLocalPayloads = pendingLocalOps.map(decodeLocalPayload)

  for (const remoteOp of remoteOps) {
    const remotePayload = decodeRemotePayload(remoteOp)

    // Always-safe remote types skip conflict detection entirely
    if (ALWAYS_SAFE_TYPES.has(remotePayload.type)) {
      safe.push(remoteOp)
      continue
    }

    const pairsForThisRemote: ConflictPair[] = []

    for (let i = 0; i < pendingLocalOps.length; i++) {
      const localOp = pendingLocalOps[i]
      const localPayload = decodedLocalPayloads[i]

      const conflictType = classifyPair(remotePayload, remoteOp, localPayload, localOp)
      if (conflictType !== null) {
        pairsForThisRemote.push({
          remote: remoteOp,
          local: localOp,
          type: conflictType,
        })
      }
    }

    if (pairsForThisRemote.length === 0) {
      safe.push(remoteOp)
    } else {
      conflicts.push(...pairsForThisRemote)
    }
  }

  return { safe, conflicts }
}
