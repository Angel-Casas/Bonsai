/**
 * Sync Orchestrator for Bonsai
 *
 * Coordinates the pull → detect-conflicts → resolve → push flow.
 * Delegates conflict detection to conflictDetector and resolution UI
 * to a caller-provided callback.
 */

import type { RemoteOp, SyncOp, ConflictPair, ResolvedConflict } from './types'
import { detectConflicts } from './conflictDetector'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SyncState = 'idle' | 'pulling' | 'resolving' | 'pushing' | 'error'

export interface SyncAdapter {
  pullRemoteOps(clientId: string, since?: string): Promise<RemoteOp[]>
  pushPendingOps(): Promise<{ pushed: number; failed: number }>
  getPendingOps(): Promise<SyncOp[]>
  markAcked(opIds: string[]): Promise<void>
}

export interface SyncOrchestratorOptions {
  adapter: SyncAdapter
  applyRemoteOp: (op: RemoteOp) => Promise<void>
  showConflicts: (conflicts: ConflictPair[]) => Promise<ResolvedConflict[]>
  clientId: string
  onStateChange?: (state: SyncState) => void
}

export interface SyncOrchestrator {
  runSync(): Promise<void>
  getState(): SyncState
  getLastSyncTimestamp(): string | undefined
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createSyncOrchestrator(options: SyncOrchestratorOptions): SyncOrchestrator {
  const { adapter, applyRemoteOp, showConflicts, clientId, onStateChange } = options

  let state: SyncState = 'idle'
  let lastSyncTimestamp: string | undefined

  function setState(newState: SyncState): void {
    state = newState
    onStateChange?.(newState)
  }

  async function runSync(): Promise<void> {
    try {
      // 1. Pull remote ops
      setState('pulling')
      const remoteOps = await adapter.pullRemoteOps(clientId, lastSyncTimestamp)

      // 2. Get pending local ops
      const pendingLocalOps = await adapter.getPendingOps()

      // 3. Detect conflicts
      const { safe, conflicts } = detectConflicts(remoteOps, pendingLocalOps)

      // 4. Apply safe ops
      for (const op of safe) {
        await applyRemoteOp(op)
      }

      // 5. Handle conflicts if any
      if (conflicts.length > 0) {
        setState('resolving')
        const resolutions = await showConflicts(conflicts)

        for (const resolved of resolutions) {
          switch (resolved.resolution) {
            case 'keep-remote':
              // Apply the remote op; local op will be discarded/overwritten
              await applyRemoteOp(resolved.pair.remote)
              break
            case 'keep-both':
              // Apply the remote op; local op stays pending and will push
              await applyRemoteOp(resolved.pair.remote)
              break
            case 'keep-local':
              // Skip the remote op; local op stays pending and will push
              break
          }
        }
      }

      // 6. Update lastSyncTimestamp from latest remote op
      if (remoteOps.length > 0) {
        const latestTimestamp = remoteOps.reduce(
          (latest, op) => (op.createdAt > latest ? op.createdAt : latest),
          remoteOps[0].createdAt,
        )
        lastSyncTimestamp = latestTimestamp
      }

      // 7. Push pending local ops
      setState('pushing')
      await adapter.pushPendingOps()

      // 8. Done
      setState('idle')
    } catch (err) {
      console.error('[SyncOrchestrator] Sync failed:', err)
      setState('error')
    }
  }

  return {
    runSync,
    getState: () => state,
    getLastSyncTimestamp: () => lastSyncTimestamp,
  }
}
