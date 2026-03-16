<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

function handleAction(toastId: number, callback: () => void) {
  callback()
  dismiss(toastId)
}

function handleSelect(toastId: number, onSelect: (value: string) => void, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (!value) return
  onSelect(value)
  dismiss(toastId)
}
</script>

<template>
  <div class="toast-container" aria-live="polite">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
        :class="[
          `toast--${toast.type}`,
          { 'toast--rich': toast.action || toast.select },
        ]"
      >
        <div class="toast-top">
          <span class="toast-message">{{ toast.message }}</span>
          <button class="toast-dismiss" @click="dismiss(toast.id)" aria-label="Dismiss">&times;</button>
        </div>
        <div v-if="toast.action || toast.select" class="toast-actions">
          <button
            v-if="toast.action"
            class="toast-action"
            @click="handleAction(toast.id, toast.action!.callback)"
          >
            {{ toast.action.label }}
          </button>
          <select
            v-if="toast.select"
            class="toast-select"
            @change="handleSelect(toast.id, toast.select!.onSelect, $event)"
          >
            <option value="" disabled selected>{{ toast.select.placeholder }}</option>
            <option
              v-for="opt in toast.select.options"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 5rem;
  right: 1.5rem;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 1rem;
  background: var(--bg-primary);
  border: 1px solid var(--glass-border);
  border-left: 3px solid var(--success);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--text-primary);
  min-width: 200px;
  max-width: 360px;
}

.toast--rich {
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
}

.toast--error {
  border-left-color: var(--error);
}

.toast--info {
  border-left-color: var(--accent);
}

.toast-top {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.toast-message {
  flex: 1;
}

.toast-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toast-action {
  flex-shrink: 0;
  padding: 0.25rem 0.5rem;
  border: 1px solid rgba(var(--accent-rgb), 0.4);
  border-radius: var(--radius-sm);
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.toast-action:hover {
  background: rgba(var(--accent-rgb), 0.2);
  border-color: rgba(var(--accent-rgb), 0.6);
}

.toast-select {
  flex: 1;
  min-width: 0;
  padding: 0.25rem 0.375rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary, rgba(255, 255, 255, 0.05));
  color: var(--text-primary);
  font-size: 0.75rem;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}

.toast-select:hover,
.toast-select:focus {
  border-color: rgba(var(--accent-rgb), 0.5);
  outline: none;
}

.toast-dismiss {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: all var(--transition-fast);
}

.toast-dismiss:hover {
  background: var(--border-muted);
  color: var(--text-primary);
}

/* Transition: slide in from right, fade out */
.toast-enter-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.toast-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.toast-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.toast-leave-to {
  transform: translateX(30%);
  opacity: 0;
}
</style>
