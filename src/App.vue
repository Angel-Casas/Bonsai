<script setup lang="ts">
/**
 * App Shell
 * 
 * Root component that includes:
 * - Router view for page navigation
 * - Global offline indicator banner
 */

import { useOnlineStatus } from '@/composables/useOnlineStatus'

const { isOnline } = useOnlineStatus()
</script>

<template>
  <!-- Offline Banner -->
  <div
    v-if="!isOnline"
    class="fixed top-0 left-0 right-0 z-50 bg-yellow-600 px-4 py-2 text-center text-sm font-medium text-white"
    data-testid="offline-banner"
  >
    <span class="inline-flex items-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
      </svg>
      You're offline. Some features may be unavailable.
    </span>
  </div>

  <!-- Main Router View (with padding when offline banner is visible) -->
  <div :class="{ 'pt-10': !isOnline }">
    <RouterView />
  </div>
</template>
