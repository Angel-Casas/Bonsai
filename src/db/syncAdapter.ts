/**
 * Sync Adapter Interface
 *
 * Abstraction for syncing operations to a remote server.
 * LocalOnlySyncAdapter is the default (no-op) implementation.
 * Future implementations will push ops to Bonsai Sync server.
 */

import type { SyncOp } from './types';
import { getPendingOps, markAcked } from './opsService';
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
