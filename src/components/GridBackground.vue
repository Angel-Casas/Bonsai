<script setup lang="ts">
/**
 * GridBackground - Decorative grid pattern background
 *
 * A fixed-position SVG grid pattern that creates a subtle
 * blueprint-style background effect. Supports day/night modes.
 */

import { useThemeStore } from '@/stores/themeStore'

const themeStore = useThemeStore()
</script>

<template>
  <div class="grid-background" :class="{ 'day-mode': themeStore.isDayMode }">
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="smallGrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke-width="0.5"/>
        </pattern>
        <pattern id="largeGrid" width="100" height="100" patternUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="url(#smallGrid)"/>
          <path d="M 100 0 L 0 0 0 100" fill="none" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#largeGrid)" />
    </svg>
  </div>
</template>

<style scoped>
.grid-background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

/* Night mode colors */
.grid-background svg path {
  stroke: rgba(231, 210, 124, 0.08);
  transition: stroke 0.4s ease;
}

.grid-background svg pattern#largeGrid > path {
  stroke: rgba(231, 210, 124, 0.15);
}

/* Day mode colors */
.grid-background.day-mode svg path {
  stroke: rgba(196, 149, 106, 0.18);
}

.grid-background.day-mode svg pattern#largeGrid > path {
  stroke: rgba(196, 149, 106, 0.28);
}
</style>
