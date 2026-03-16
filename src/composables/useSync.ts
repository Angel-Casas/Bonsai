/**
 * Sync Composable
 *
 * Wires the sync orchestrator into the Vue app lifecycle.
 * - Creates a RemoteSyncAdapter bound to the auth token
 * - Runs sync on mount, every 60 seconds, and when coming back online
 * - Exposes reactive sync state and conflict resolution hooks
 */

import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { createSyncOrchestrator } from '@/db/syncOrchestrator'
import type { SyncState, SyncAdapter as OrchestratorSyncAdapter } from '@/db/syncOrchestrator'
import { RemoteSyncAdapter } from '@/db/remoteSyncAdapter'
import { getOrCreateClientId } from '@/db/opsService'
import type { ConflictPair, ResolvedConflict, RemoteOp } from '@/db/types'

const SYNC_INTERVAL_MS = 60_000

export function useSync() {
  const authStore = useAuthStore()
  const { isOnline } = useOnlineStatus()

  const syncState = ref<SyncState>('idle')
  const pendingConflicts = ref<ConflictPair[]>([])

  // Promise resolve callback stored here so the ConflictResolver component
  // can settle the promise created inside showConflicts.
  let conflictResolveCallback: ((resolutions: ResolvedConflict[]) => void) | null = null

  // Build the RemoteSyncAdapter with a token getter bound to the auth store
  const serverUrl = import.meta.env.VITE_SYNC_SERVER_URL || 'http://localhost:3000'
  const remoteSyncAdapter = new RemoteSyncAdapter(
    serverUrl,
    () => authStore.getValidToken(),
  )

  // Adapt RemoteSyncAdapter to the orchestrator's SyncAdapter interface
  const adapter: OrchestratorSyncAdapter = {
    pullRemoteOps(clientId: string, since?: string): Promise<RemoteOp[]> {
      return remoteSyncAdapter.pullRemoteOps(clientId, since)
    },
    pushPendingOps(): Promise<{ pushed: number; failed: number }> {
      return remoteSyncAdapter.pushPendingOps()
    },
    async getPendingOps() {
      return remoteSyncAdapter.getPendingOps()
    },
    markAcked(opIds: string[]): Promise<void> {
      return remoteSyncAdapter.markAcked(opIds)
    },
  }

  const clientId = getOrCreateClientId()

  const orchestrator = createSyncOrchestrator({
    adapter,
    applyRemoteOp: async (op: RemoteOp) => {
      // TODO: apply remote op to local database
      console.log('[useSync] applyRemoteOp (not yet implemented):', op.id)
    },
    showConflicts: (conflicts: ConflictPair[]): Promise<ResolvedConflict[]> => {
      pendingConflicts.value = conflicts
      return new Promise<ResolvedConflict[]>((resolve) => {
        conflictResolveCallback = resolve
      })
    },
    clientId,
    onStateChange: (state: SyncState) => {
      syncState.value = state
    },
  })

  /**
   * Called by the ConflictResolver component's `resolved` event.
   * Settles the promise that the orchestrator is awaiting and clears
   * the pending conflicts array so the UI unmounts the resolver.
   */
  function resolveConflicts(resolutions: ResolvedConflict[]) {
    if (conflictResolveCallback) {
      conflictResolveCallback(resolutions)
      conflictResolveCallback = null
    }
    pendingConflicts.value = []
  }

  /** Manually trigger a sync cycle. */
  function triggerSync() {
    if (!authStore.isLoggedIn || !isOnline.value) return
    orchestrator.runSync()
  }

  // ---------------------------------------------------------------------------
  // Lifecycle: mount / interval / online watcher
  // ---------------------------------------------------------------------------

  let intervalId: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    if (authStore.isLoggedIn && isOnline.value) {
      orchestrator.runSync()
    }

    intervalId = setInterval(() => {
      if (authStore.isLoggedIn && isOnline.value) {
        orchestrator.runSync()
      }
    }, SYNC_INTERVAL_MS)
  })

  onUnmounted(() => {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  })

  // Sync when coming back online
  watch(isOnline, (online, wasOnline) => {
    if (online && !wasOnline && authStore.isLoggedIn) {
      orchestrator.runSync()
    }
  })

  return {
    syncState,
    pendingConflicts,
    resolveConflicts,
    triggerSync,
  }
}
