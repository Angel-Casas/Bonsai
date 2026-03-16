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
 * Fire-and-forget op emission with failure tracking.
 * On success, creates a pending op. On failure, records a failed op stub
 * so diagnostics can surface the issue without blocking the user action.
 */
export async function safeAppendOp(
  type: OpType,
  payload: Record<string, unknown>,
  conversationId?: string,
  database: BonsaiDatabase = defaultDb
): Promise<void> {
  try {
    await appendOp(type, payload, conversationId, database);
  } catch (err) {
    console.error('Op write failed:', err);
    try {
      const failedOp: SyncOp = {
        id: generateId(),
        createdAt: nowISO(),
        conversationId: conversationId ?? null,
        type,
        payload: JSON.stringify(payload),
        payloadEnc: null,
        status: 'failed',
        clientId: getOrCreateClientId(),
        schemaVersion: OP_SCHEMA_VERSION,
      };
      await database.syncOps.add(failedOp);
    } catch {
      // If even the failure record can't be written, nothing more we can do
    }
  }
}

/**
 * Get pending operations, ordered by createdAt ASC then id ASC.
 */
export async function getPendingOps(
  limit?: number,
  database: BonsaiDatabase = defaultDb
): Promise<SyncOp[]> {
  const ops = await database.syncOps
    .where('status')
    .equals('pending')
    .sortBy('createdAt');

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
): Promise<{ pendingCount: number; failedCount: number; latestTypes: string[] }> {
  const pendingCount = await database.syncOps
    .where('status')
    .equals('pending')
    .count();

  const failedCount = await database.syncOps
    .where('status')
    .equals('failed')
    .count();

  // Get latest 5 ops (any status) for type display
  const latest = await database.syncOps
    .orderBy('createdAt')
    .reverse()
    .limit(5)
    .toArray();

  return {
    pendingCount,
    failedCount,
    latestTypes: latest.map((op) => op.type),
  };
}
