<script setup lang="ts">
/**
 * LinesBackground - Diagonal scanlines animated background
 *
 * A fixed-position background with soft gradient blobs viewed through
 * a diagonal line pattern. Creates a retro/CRT aesthetic.
 * Colors are controlled by CSS variables from the active color palette.
 */
</script>

<template>
  <div class="lines-background">
    <div class="bg-container">
      <!-- Dark base -->
      <div class="bg-base"></div>

      <!-- Gradient blobs -->
      <div class="blobs-layer">
        <div class="blob blob-1"></div>
        <div class="blob blob-2"></div>
        <div class="blob blob-3"></div>
        <div class="blob blob-4"></div>
      </div>

      <!-- Diagonal lines overlay -->
      <div class="lines-overlay"></div>
    </div>
  </div>
</template>

<style scoped>
.lines-background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.bg-container {
  position: absolute;
  inset: 0;
}

/* ============================================
   BASE BACKGROUND
   ============================================ */

.bg-base {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  transition: background 0.8s ease;
}

/* ============================================
   BLOBS LAYER
   ============================================ */

.blobs-layer {
  position: absolute;
  inset: -30%;
  width: 160%;
  height: 160%;
  filter: blur(80px);
}

.blob {
  position: absolute;
  border-radius: 50%;
  will-change: transform;
  transition: background 0.8s ease;
}

/* ============================================
   BLOB COLORS (use CSS variables from palette)
   ============================================ */

/* Primary blob - upper area */
.blob-1 {
  width: 80vmax;
  height: 80vmax;
  background: radial-gradient(ellipse at 40% 40%, var(--blob-1) 0%, var(--blob-1-dark) 40%, transparent 70%);
  top: -10%;
  left: 10%;
  animation: drift-1 30s ease-in-out infinite;
}

/* Secondary blob - lower area */
.blob-2 {
  width: 90vmax;
  height: 90vmax;
  background: radial-gradient(ellipse at 50% 50%, var(--blob-2) 0%, var(--blob-2-dark) 40%, transparent 70%);
  bottom: -30%;
  left: -10%;
  animation: drift-2 35s ease-in-out infinite;
}

/* Primary blob variant */
.blob-3 {
  width: 60vmax;
  height: 70vmax;
  background: radial-gradient(ellipse at 60% 40%, var(--blob-1) 0%, var(--blob-1-dark) 40%, transparent 70%);
  top: -10%;
  right: 0%;
  opacity: 0.7;
  animation: drift-3 28s ease-in-out infinite;
}

/* Secondary blob variant */
.blob-4 {
  width: 55vmax;
  height: 65vmax;
  background: radial-gradient(ellipse at 45% 55%, var(--blob-2) 0%, var(--blob-2-dark) 40%, transparent 70%);
  bottom: 0%;
  right: 0%;
  opacity: 0.8;
  animation: drift-4 32s ease-in-out infinite;
}

/* ============================================
   DIAGONAL LINES OVERLAY
   ============================================ */

.lines-overlay {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    45deg,
    transparent 0px,
    transparent 1px,
    var(--overlay-dark) 1px,
    var(--overlay-dark) 2px
  );
  pointer-events: none;
}

/* ============================================
   DRIFT ANIMATIONS
   ============================================ */

@keyframes drift-1 {
  0%, 100% {
    transform: translate(0, 0) scale(1);
  }
  33% {
    transform: translate(10%, 15%) scale(1.05);
  }
  66% {
    transform: translate(-5%, 8%) scale(0.98);
  }
}

@keyframes drift-2 {
  0%, 100% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(15%, -10%) scale(1.08);
  }
}

@keyframes drift-3 {
  0%, 100% {
    transform: translate(0, 0) scale(1);
  }
  25% {
    transform: translate(-15%, 10%) scale(1.03);
  }
  50% {
    transform: translate(-8%, 20%) scale(1.06);
  }
  75% {
    transform: translate(5%, 12%) scale(0.97);
  }
}

@keyframes drift-4 {
  0%, 100% {
    transform: translate(0, 0) scale(1);
  }
  40% {
    transform: translate(-20%, -15%) scale(1.1);
  }
  70% {
    transform: translate(-10%, -5%) scale(1.02);
  }
}

/* ============================================
   PERFORMANCE OPTIMIZATIONS
   ============================================ */

@media (prefers-reduced-motion: reduce) {
  .blob {
    animation: none;
  }
}

@media (max-width: 1024px) {
  .blob-1 {
    top: 5%;
    left: -10%;
  }

  .blob-2 {
    bottom: -20%;
    left: -10%;
  }
  .blob-3 {
    top: 0%;
    right: 0%;
  }
  .blob-4 {
    bottom: 0%;
    right: 0%;
  }
}

@media (max-width: 768px) {
  .blobs-layer {
    filter: blur(50px);
  }

  .blob-1 {
    top: -5%;
    left: -20%;
  }

  .blob-2 {
    bottom: -20%;
    left: -20%;
  }

  .blob-3 {
    top: -10%;
    right: 0%;
  }
  .blob-4 {
    bottom: 0%;
    right: -10%;
  }
}
</style>
