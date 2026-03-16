<script setup lang="ts">
/**
 * TutorialOverlay - Full-screen interactive tutorial overlay
 *
 * Features:
 * - SVG mask spotlight with animated cutout
 * - Glass-morphism popover with step counter, navigation, progress bar
 * - Smooth animations between steps
 * - Keyboard navigation (Escape to dismiss)
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { useTutorial } from '@/composables/useTutorial'

const tutorial = useTutorial()

// ============================================================
// Popover positioning
// ============================================================

const POPOVER_MAX_WIDTH = 360
const POPOVER_EST_HEIGHT = 240
const VIEWPORT_MARGIN = 16
const GAP = 16

function getPopoverWidth(): number {
  return Math.min(POPOVER_MAX_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
}

function calculateBestPosition(rect: DOMRect): 'top' | 'bottom' | 'left' | 'right' {
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  const popoverW = getPopoverWidth()
  const spaceRight = window.innerWidth - rect.right
  const spaceLeft = rect.left

  if (spaceBelow >= POPOVER_EST_HEIGHT + GAP) return 'bottom'
  if (spaceAbove >= POPOVER_EST_HEIGHT + GAP) return 'top'
  if (spaceRight >= popoverW + GAP) return 'right'
  if (spaceLeft >= popoverW + GAP) return 'left'
  return spaceBelow >= spaceAbove ? 'bottom' : 'top'
}

const popoverStyle = computed(() => {
  const rect = tutorial.targetRect.value
  const step = tutorial.currentStep.value
  const popoverW = getPopoverWidth()

  // Centered modal (no target)
  if (!rect || !step?.target) {
    return {
      position: 'fixed' as const,
      top: '50%',
      left: `${VIEWPORT_MARGIN}px`,
      right: `${VIEWPORT_MARGIN}px`,
      width: `${popoverW}px`,
      margin: '0 auto',
      transform: 'translateY(-50%)',
    }
  }

  const pos = step.position === 'auto' ? calculateBestPosition(rect) : step.position

  let top: number
  let left: number

  switch (pos) {
    case 'bottom':
      top = rect.y + rect.height + GAP
      left = Math.max(VIEWPORT_MARGIN, Math.min(
        rect.x + rect.width / 2 - popoverW / 2,
        window.innerWidth - popoverW - VIEWPORT_MARGIN,
      ))
      break
    case 'top':
      top = rect.y - GAP - POPOVER_EST_HEIGHT
      left = Math.max(VIEWPORT_MARGIN, Math.min(
        rect.x + rect.width / 2 - popoverW / 2,
        window.innerWidth - popoverW - VIEWPORT_MARGIN,
      ))
      break
    case 'right':
      top = Math.max(VIEWPORT_MARGIN, rect.y + rect.height / 2 - POPOVER_EST_HEIGHT / 2)
      left = rect.x + rect.width + GAP
      // On narrow screens, if right positioning overflows, fall back to bottom-aligned
      if (left + popoverW > window.innerWidth - VIEWPORT_MARGIN) {
        left = VIEWPORT_MARGIN
        top = rect.y + rect.height + GAP
      }
      break
    case 'left':
      top = Math.max(VIEWPORT_MARGIN, rect.y + rect.height / 2 - POPOVER_EST_HEIGHT / 2)
      left = rect.x - GAP - popoverW
      // On narrow screens, if left positioning overflows, fall back to bottom-aligned
      if (left < VIEWPORT_MARGIN) {
        left = VIEWPORT_MARGIN
        top = rect.y + rect.height + GAP
      }
      break
    default:
      top = rect.y + rect.height + GAP
      left = rect.x
  }

  // Ensure popover stays on screen
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - POPOVER_EST_HEIGHT - VIEWPORT_MARGIN))
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - popoverW - VIEWPORT_MARGIN))

  return {
    position: 'fixed' as const,
    top: `${top}px`,
    left: `${left}px`,
    width: `${popoverW}px`,
    transform: 'none',
  }
})

const spotlightRingStyle = computed(() => {
  const rect = tutorial.targetRect.value
  if (!rect) return { display: 'none' }
  return {
    position: 'fixed' as const,
    top: `${rect.y}px`,
    left: `${rect.x}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: '8px',
  }
})

// ============================================================
// Description formatting (bold markdown)
// ============================================================

const formattedDescription = computed(() => {
  const desc = tutorial.currentStep.value?.description ?? ''
  return desc
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>')
})

// ============================================================
// Navigation
// ============================================================

function handleNext() {
  tutorial.nextStep()
}

function handleOverlayClick() {
  // Clicking the dark area does nothing — use skip button to dismiss
}

// ============================================================
// Keyboard
// ============================================================

function handleKeydown(e: KeyboardEvent) {
  if (!tutorial.isActive.value) return

  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    tutorial.stopTutorial()
  } else if (e.key === 'ArrowRight' && tutorial.canAdvance.value) {
    e.preventDefault()
    handleNext()
  } else if (e.key === 'ArrowLeft' && !tutorial.isFirstStep.value) {
    e.preventDefault()
    tutorial.prevStep()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown, { capture: true })
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown, true)
})
</script>

<template>
  <Teleport to="body">
    <!-- Click-blocking backdrop layer — z-index 9000 -->
    <Transition name="tutorial-overlay">
      <div v-if="tutorial.isActive.value" class="tutorial-backdrop-layer" @click="handleOverlayClick">
        <!-- SVG backdrop with mask cutout -->
        <svg v-if="tutorial.targetRect.value" class="tutorial-backdrop-svg">
          <defs>
            <mask id="tutorial-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                :x="tutorial.targetRect.value.x"
                :y="tutorial.targetRect.value.y"
                :width="tutorial.targetRect.value.width"
                :height="tutorial.targetRect.value.height"
                rx="8"
                fill="black"
                class="mask-cutout"
              />
            </mask>
          </defs>
          <rect
            width="100%" height="100%"
            fill="rgba(0, 0, 0, 0.75)"
            mask="url(#tutorial-mask)"
          />
        </svg>

        <!-- Solid backdrop when no target -->
        <div v-else class="tutorial-backdrop-solid" />
      </div>
    </Transition>

    <!-- Spotlight glow ring — z-index 9002 (above elevated targets at 9001) -->
    <div
      v-if="tutorial.isActive.value && tutorial.targetRect.value"
      class="tutorial-spotlight-ring"
      :style="spotlightRingStyle"
    />

    <!-- Popover — z-index 9002 (above elevated targets at 9001) -->
    <Transition name="tutorial-popover" mode="out-in">
      <div
        v-if="tutorial.isActive.value"
        :key="tutorial.currentStepIndex.value"
        class="tutorial-popover"
        :style="popoverStyle"
        @click.stop
      >
        <!-- Header -->
        <div class="popover-header">
          <span class="step-counter">
            {{ tutorial.currentStepIndex.value + 1 }} / {{ tutorial.totalSteps.value }}
          </span>
          <button class="skip-btn" title="Skip tutorial" @click="tutorial.stopTutorial()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Content -->
        <h3 class="popover-title">{{ tutorial.currentStep.value?.title }}</h3>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <p class="popover-description" v-html="formattedDescription" />

        <!-- Action hint -->
        <p
          v-if="tutorial.currentStep.value?.requiresAction && !tutorial.canAdvance.value"
          class="popover-action-hint"
        >
          {{ tutorial.currentStep.value.actionHint }}
        </p>

        <!-- Navigation -->
        <div class="popover-nav">
          <button
            v-if="!tutorial.isFirstStep.value"
            class="nav-btn nav-btn--prev"
            @click="tutorial.prevStep()"
          >
            Back
          </button>
          <div v-else class="nav-spacer" />

          <button
            class="nav-btn nav-btn--next"
            :disabled="tutorial.currentStep.value?.requiresAction && !tutorial.canAdvance.value"
            @click="handleNext"
          >
            {{ tutorial.isLastStep.value ? 'Finish' : 'Next' }}
          </button>
        </div>

        <!-- Progress bar -->
        <div class="popover-progress">
          <div class="progress-bar" :style="{ width: `${tutorial.progress.value}%` }" />
        </div>
      </div>
    </Transition>

    <!-- Completion modal -->
    <Transition name="completion-modal">
      <div v-if="tutorial.showCompletionModal.value" class="completion-overlay" @click.self="tutorial.dismissCompletion()">
        <div class="completion-card">
          <div class="completion-icon">&#10003;</div>
          <h3 class="completion-title">
            {{ tutorial.completedTutorialId.value === 'full-tour' ? 'Tour Complete!' : 'Setup Complete!' }}
          </h3>
          <p class="completion-description">
            {{ tutorial.completedTutorialId.value === 'full-tour'
              ? "You've explored all of Bonsai's features. You can revisit this tour anytime from Settings. Happy branching!"
              : "You're all set to use Bonsai. Explore branching conversations, customize your context, and more."
            }}
          </p>
          <button class="completion-dismiss-btn" @click="tutorial.dismissCompletion()">
            Got it!
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ============================================================
   Backdrop layer — z-index 9000
   Click-blocking overlay with SVG mask or solid fill.
   Separate from popover so elevated targets (9001) sit between
   the backdrop and the popover/ring (9002).
   ============================================================ */
.tutorial-backdrop-layer {
  position: fixed;
  inset: 0;
  z-index: 9000;
  pointer-events: auto;
}

.tutorial-backdrop-svg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.tutorial-backdrop-svg .mask-cutout {
  transition: x 0.4s cubic-bezier(0.4, 0, 0.2, 1),
              y 0.4s cubic-bezier(0.4, 0, 0.2, 1),
              width 0.4s cubic-bezier(0.4, 0, 0.2, 1),
              height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.tutorial-backdrop-solid {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  pointer-events: none;
}

/* ============================================================
   Spotlight glow ring
   ============================================================ */
.tutorial-spotlight-ring {
  position: fixed;
  border: 2px solid rgba(var(--accent-rgb, 231, 210, 124), 0.6);
  box-shadow:
    0 0 0 4px rgba(var(--accent-rgb, 231, 210, 124), 0.15),
    0 0 20px rgba(var(--accent-rgb, 231, 210, 124), 0.3);
  pointer-events: none;
  z-index: 9001;
  transition:
    top 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    left 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    width 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  animation: tutorial-pulse 2s ease-in-out infinite;
}

@keyframes tutorial-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 4px rgba(var(--accent-rgb, 231, 210, 124), 0.15),
      0 0 20px rgba(var(--accent-rgb, 231, 210, 124), 0.3);
  }
  50% {
    box-shadow:
      0 0 0 6px rgba(var(--accent-rgb, 231, 210, 124), 0.25),
      0 0 30px rgba(var(--accent-rgb, 231, 210, 124), 0.5);
  }
}

/* ============================================================
   Popover
   ============================================================ */
.tutorial-popover {
  position: fixed;
  z-index: 9002;
  max-width: calc(100vw - 2rem);
  background: var(--glass-bg-solid, rgba(15, 23, 42, 0.92));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border, rgba(231, 210, 124, 0.1));
  border-radius: var(--radius-xl, 16px);
  padding: 1.25rem;
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.25));
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #e2e8f0);
  pointer-events: auto;
}

.popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.step-counter {
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  color: var(--accent, #E7D27C);
  background: rgba(var(--accent-rgb, 231, 210, 124), 0.1);
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm, 4px);
}

.skip-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  background: transparent;
  color: var(--text-muted, rgba(226, 232, 240, 0.6));
  cursor: pointer;
  border-radius: var(--radius-sm, 4px);
  transition: all 0.2s ease;
}

.skip-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #e2e8f0);
}

.skip-btn svg {
  width: 14px;
  height: 14px;
}

.popover-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--text-primary, #e2e8f0);
}

.popover-description {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-secondary, #929ca9);
  margin-bottom: 0.75rem;
}

.popover-description :deep(strong) {
  color: var(--accent, #E7D27C);
  font-weight: 600;
}

.popover-action-hint {
  font-size: 0.8125rem;
  color: var(--accent, #E7D27C);
  font-style: italic;
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.625rem;
  background: rgba(var(--accent-rgb, 231, 210, 124), 0.08);
  border-radius: var(--radius-md, 8px);
  border-left: 3px solid var(--accent, #E7D27C);
}

/* ============================================================
   Navigation
   ============================================================ */
.popover-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.nav-spacer {
  flex: 1;
}

.nav-btn {
  padding: 0.5rem 1.125rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: all 0.3s ease;
}

.nav-btn--prev {
  background: transparent;
  border: 1px solid var(--border-subtle, rgba(231, 210, 124, 0.15));
  color: var(--text-secondary, #929ca9);
}

.nav-btn--prev:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border-color, rgba(231, 210, 124, 0.4));
  color: var(--text-primary, #e2e8f0);
}

.nav-btn--next {
  background: var(--accent, #E7D27C);
  border: none;
  color: var(--bg-primary, #0f172a);
  font-weight: 600;
}

.nav-btn--next:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-accent, 0 4px 15px rgba(231, 210, 124, 0.3));
}

.nav-btn--next:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
}

/* ============================================================
   Progress bar
   ============================================================ */
.popover-progress {
  height: 3px;
  background: rgba(var(--accent-rgb, 231, 210, 124), 0.12);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--accent, #E7D27C);
  border-radius: 2px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ============================================================
   Transitions
   ============================================================ */

/* Overlay enter/leave */
.tutorial-overlay-enter-active {
  transition: opacity 0.3s ease;
}
.tutorial-overlay-leave-active {
  transition: opacity 0.3s ease;
}
.tutorial-overlay-enter-from,
.tutorial-overlay-leave-to {
  opacity: 0;
}

/* Popover enter/leave */
.tutorial-popover-enter-active {
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.tutorial-popover-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.tutorial-popover-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}
.tutorial-popover-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

/* ============================================================
   Reduced motion
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .tutorial-spotlight-ring {
    animation: none;
  }
  .tutorial-backdrop-svg .mask-cutout,
  .tutorial-spotlight-ring,
  .progress-bar {
    transition: none;
  }
  .tutorial-popover-enter-active,
  .tutorial-popover-leave-active,
  .tutorial-overlay-enter-active,
  .tutorial-overlay-leave-active,
  .completion-modal-enter-active,
  .completion-modal-leave-active {
    transition: none;
  }
}

/* ============================================================
   Completion modal
   ============================================================ */
.completion-overlay {
  position: fixed;
  inset: 0;
  z-index: 9010;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.completion-card {
  width: 340px;
  max-width: calc(100vw - 2rem);
  background: var(--glass-bg-solid, rgba(15, 23, 42, 0.92));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border, rgba(231, 210, 124, 0.1));
  border-radius: var(--radius-xl, 16px);
  padding: 2rem 1.5rem 1.5rem;
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.25));
  text-align: center;
}

.completion-icon {
  width: 3.5rem;
  height: 3.5rem;
  margin: 0 auto 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.75rem;
  color: var(--bg-primary, #0f172a);
  background: var(--accent, #E7D27C);
  border-radius: 50%;
  font-weight: 700;
}

.completion-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary, #e2e8f0);
  margin-bottom: 0.5rem;
}

.completion-description {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-secondary, #929ca9);
  margin-bottom: 1.5rem;
}

.completion-dismiss-btn {
  display: block;
  width: 100%;
  padding: 0.75rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: 0.9375rem;
  font-weight: 600;
  background: var(--accent, #E7D27C);
  color: var(--bg-primary, #0f172a);
  border: none;
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: all 0.2s ease;
}

.completion-dismiss-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-accent, 0 4px 15px rgba(231, 210, 124, 0.3));
}

/* Completion modal transition */
.completion-modal-enter-active {
  transition: opacity 0.3s ease;
}
.completion-modal-enter-active .completion-card {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
}
.completion-modal-leave-active {
  transition: opacity 0.2s ease;
}
.completion-modal-leave-active .completion-card {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.completion-modal-enter-from {
  opacity: 0;
}
.completion-modal-enter-from .completion-card {
  transform: scale(0.9) translateY(12px);
  opacity: 0;
}
.completion-modal-leave-to {
  opacity: 0;
}
.completion-modal-leave-to .completion-card {
  transform: scale(0.95);
  opacity: 0;
}
</style>
