/**
 * Online Status Composable
 * 
 * Tracks the browser's online/offline status reactively.
 * Used for offline indicator UI and blocking sends when offline.
 */

import { ref, onMounted, onUnmounted } from 'vue'

export function useOnlineStatus() {
  // Default to true if navigator.onLine is not supported
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)

  function handleOnline() {
    isOnline.value = true
  }

  function handleOffline() {
    isOnline.value = false
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  })

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  })

  return {
    isOnline,
  }
}
