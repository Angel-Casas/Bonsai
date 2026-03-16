/**
 * Lerp-based scroll engine for the landing page.
 *
 * Does NOT listen to wheel/scroll events itself — the caller feeds deltas
 * or target positions, and the engine animates via requestAnimationFrame.
 */

import { computed, ref } from 'vue'

export interface SmoothScrollOptions {
  /** Lerp factor per frame – lower = smoother/slower (0.06–0.15 typical) */
  lerp?: number
  /** Max pixels the target can advance per single feedDelta call */
  maxDelta?: number
  /** Threshold in px below which we snap to target and stop animating */
  snapThreshold?: number
}

export function useSmoothScroll(options: SmoothScrollOptions = {}) {
  const {
    lerp = 0.1,
    maxDelta = 150,
    snapThreshold = 0.5,
  } = options

  const active = ref(false)

  let targetY = 0
  let currentY = 0
  let rafId: number | null = null
  let ticking = false

  function clampTarget() {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    targetY = Math.max(0, Math.min(targetY, maxScroll))
  }

  function tick() {
    if (!active.value) {
      ticking = false
      rafId = null
      return
    }

    const diff = targetY - currentY

    if (Math.abs(diff) < snapThreshold) {
      currentY = targetY
      window.scrollTo(0, currentY)
      ticking = false
      rafId = null
      return
    }

    currentY += diff * lerp
    window.scrollTo(0, currentY)
    rafId = requestAnimationFrame(tick)
  }

  function ensureTicking() {
    if (!ticking && active.value) {
      ticking = true
      tick()
    }
  }

  /** Feed a raw wheel delta (in px). Clamped to maxDelta. Starts animation. */
  function feedDelta(rawDelta: number) {
    const clamped = Math.sign(rawDelta) * Math.min(Math.abs(rawDelta), maxDelta)
    targetY += clamped
    clampTarget()
    ensureTicking()
  }

  /** Smoothly animate to an absolute Y position via the lerp engine. */
  function animateTo(y: number) {
    targetY = y
    clampTarget()
    ensureTicking()
  }

  /** Immediately set internal state to a given Y (no animation). */
  function jumpTo(y: number) {
    currentY = y
    targetY = y
  }

  /** Sync internal state to the current window.scrollY. Safe to call anytime. */
  function syncPosition() {
    if (!ticking) {
      currentY = window.scrollY
      targetY = window.scrollY
    }
  }

  /** Enable the engine. Call on mount. */
  function start() {
    if (active.value) return
    active.value = true
    currentY = window.scrollY
    targetY = window.scrollY
  }

  /** Disable the engine and cancel any pending animation. Call on unmount. */
  function stop() {
    if (!active.value) return
    active.value = false
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    ticking = false
  }

  const isAnimating = computed(() => ticking)

  return {
    feedDelta,
    animateTo,
    jumpTo,
    syncPosition,
    start,
    stop,
    isAnimating,
  }
}
