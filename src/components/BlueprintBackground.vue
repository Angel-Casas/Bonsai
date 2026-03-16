<script setup lang="ts">
/**
 * BlueprintBackground - Low-resource grid background
 *
 * A simple two-color background with vertical and horizontal grid lines.
 * Designed for minimal resource usage - no animations or blur effects.
 * Colors are controlled by CSS variables from the active color palette.
 */
</script>

<template>
  <div class="blueprint-background">
    <div class="grid-container">
      <!-- Base background color -->
      <div class="bg-base"></div>

      <!-- Grid lines overlay -->
      <div class="grid-lines"></div>
    </div>
  </div>
</template>

<style scoped>
.blueprint-background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.grid-container {
  position: absolute;
  inset: 0;
}

/* Base background */
.bg-base {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  transition: background 0.4s ease;
}

/* Grid lines - horizontal and vertical */
.grid-lines {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
  background-size: 40px 40px;
  opacity: var(--grid-opacity, 0.3);
  transition: opacity 0.4s ease;
}

/* Reduced motion - no changes needed as there are no animations */
@media (prefers-reduced-motion: reduce) {
  .bg-base,
  .grid-lines {
    transition: none;
  }
}
</style>
