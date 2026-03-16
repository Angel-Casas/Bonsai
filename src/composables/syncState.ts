/**
 * Shared Sync State
 *
 * Module-level reactive refs for sync status so that any component
 * can read the current sync state without re-calling `useSync()`.
 *
 * `useSync()` (called once in App.vue) populates these refs.
 * Other components import `useSyncState()` to read them.
 */

import { ref, watch, type Ref } from 'vue'
import type { SyncState } from '@/db/syncOrchestrator'

/** Current sync orchestrator state. */
const syncState: Ref<SyncState> = ref('idle')

/** Callback to trigger a manual sync cycle. Set by useSync(). */
let triggerSyncFn: (() => void) | null = null

export function useSyncState() {
  return {
    syncState,
    triggerSync() {
      triggerSyncFn?.()
    },
  }
}

/**
 * Called by useSync() to wire the shared refs to the actual orchestrator.
 * Should only be called once from App.vue's setup.
 */
export function _bindSyncState(
  stateRef: Ref<SyncState>,
  trigger: () => void,
) {
  // Keep the shared ref in lock-step with the orchestrator's ref.
  watch(stateRef, (v) => {
    syncState.value = v
  }, { immediate: true })

  triggerSyncFn = trigger
}
