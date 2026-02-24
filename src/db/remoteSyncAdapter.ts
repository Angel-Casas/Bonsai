/**
 * Remote Sync Adapter
 *
 * Implements the SyncAdapter interface to push/pull encrypted ops
 * to/from the Bonsai Sync Server via its REST endpoints.
 *
 * Constructor takes:
 *   - serverUrl: base URL of the sync server (no trailing slash)
 *   - getToken: async function returning a valid auth token or null
 *
 * Server endpoints:
 *   - POST /sync/push  — receives mapped ops, returns { pushed: number }
 *   - GET  /sync/pull?clientId={id}&since={timestamp} — returns { ops: [...] }
 */

import type { SyncAdapter } from './syncAdapter';
import type { SyncOp } from './types';
import { getPendingOps, markAcked } from './opsService';

/** Shape returned by GET /sync/pull for each op */
export interface RemoteOp {
  id: string;
  clientId: string;
  encryptedPayload: string; // base64
  conversationId: string | null;
  createdAt: string;
}

const PUSH_BATCH_LIMIT = 50;

export class RemoteSyncAdapter implements SyncAdapter {
  private serverUrl: string;
  private getToken: () => Promise<string | null>;

  constructor(serverUrl: string, getToken: () => Promise<string | null>) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.getToken = getToken;
  }

  /**
   * Push pending local ops to the sync server.
   *
   * Maps local SyncOp objects to the server wire format
   * (id, clientId, encryptedPayload as base64, conversationId, createdAt).
   * Batches to PUSH_BATCH_LIMIT ops per request.
   */
  async pushPendingOps(): Promise<{ pushed: number; failed: number }> {
    const token = await this.getToken();
    if (!token) {
      return { pushed: 0, failed: 0 };
    }

    const pending = await getPendingOps(PUSH_BATCH_LIMIT);
    if (pending.length === 0) {
      return { pushed: 0, failed: 0 };
    }

    try {
      const wireOps = pending.map((op) => ({
        id: op.id,
        clientId: op.clientId,
        encryptedPayload: op.payloadEnc
          ? btoa(JSON.stringify(op.payloadEnc))
          : btoa(op.payload),
        conversationId: op.conversationId,
        createdAt: op.createdAt,
      }));

      const res = await fetch(`${this.serverUrl}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ops: wireOps }),
      });

      if (!res.ok) {
        console.error('Sync push failed:', res.status, res.statusText);
        return { pushed: 0, failed: pending.length };
      }

      const data: { pushed: number } = await res.json();
      const pushedCount = data.pushed ?? 0;

      if (pushedCount > 0) {
        await markAcked(pending.slice(0, pushedCount).map((op) => op.id));
      }

      return {
        pushed: pushedCount,
        failed: pending.length - pushedCount,
      };
    } catch (err) {
      console.error('Sync push error:', err);
      return { pushed: 0, failed: pending.length };
    }
  }

  /**
   * Pull ops from other devices via the sync server.
   *
   * @param clientId - This device's client ID (to exclude own ops)
   * @param since - Optional ISO timestamp to fetch ops created after
   * @returns Array of remote ops, or [] on error / no token
   */
  async pullRemoteOps(clientId: string, since?: string): Promise<RemoteOp[]> {
    const token = await this.getToken();
    if (!token) {
      return [];
    }

    try {
      const params = new URLSearchParams({ clientId });
      if (since) {
        params.set('since', since);
      }

      const res = await fetch(`${this.serverUrl}/sync/pull?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        console.error('Sync pull failed:', res.status);
        return [];
      }

      const data: { ops: RemoteOp[] } = await res.json();
      return data.ops ?? [];
    } catch (err) {
      console.error('Sync pull error:', err);
      return [];
    }
  }

  /**
   * Mark ops as acknowledged in local IndexedDB.
   */
  async markAcked(opIds: string[]): Promise<void> {
    await markAcked(opIds);
  }

  /**
   * Get pending ops from local IndexedDB.
   */
  async getPendingOps(options?: { limit?: number }): Promise<SyncOp[]> {
    return getPendingOps(options?.limit);
  }

  /**
   * Reset sync state by marking all pending ops as acked.
   * Dev/diagnostic use only.
   */
  async resetSyncState(): Promise<void> {
    const pending = await getPendingOps();
    const ids = pending.map((op) => op.id);
    if (ids.length > 0) {
      await markAcked(ids);
    }
  }
}
