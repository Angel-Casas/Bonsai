<script setup lang="ts">
/**
 * ConflictResolver Component
 *
 * Modal dialog that presents sync conflicts one at a time and lets the user
 * choose how to resolve each one. Blocks sync until every conflict has a
 * resolution and the user clicks "Done".
 */

import { ref, computed } from 'vue'
import type { ConflictPair, Resolution, ResolvedConflict } from '../db/types'

const props = defineProps<{
  conflicts: ConflictPair[]
}>()

const emit = defineEmits<{
  resolved: [resolutions: ResolvedConflict[]]
}>()

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const currentIndex = ref(0)
const resolutions = ref(new Map<number, Resolution>())

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

const currentConflict = computed(() => props.conflicts[currentIndex.value])

const allResolved = computed(
  () => props.conflicts.length > 0 && resolutions.value.size === props.conflicts.length
)

const canGoBack = computed(() => currentIndex.value > 0)
const canGoForward = computed(() => currentIndex.value < props.conflicts.length - 1)

/** Whether "Keep both" is allowed for the current conflict type */
const keepBothAllowed = computed(() => {
  const t = currentConflict.value?.type
  return t === 'edit-vs-edit' || t === 'rename-vs-rename'
})

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

function decodeRemote(conflict: ConflictPair): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(conflict.remote.encryptedPayload))
  } catch {
    return null
  }
}

function decodeLocal(conflict: ConflictPair): Record<string, unknown> | null {
  try {
    return JSON.parse(conflict.local.payload)
  } catch {
    return null
  }
}

/** Pull a human-readable content string out of a decoded op payload */
function extractContent(payload: Record<string, unknown> | null): string {
  if (!payload) return '(unable to decode)'
  // message.edit / message.create payloads usually have "content"
  if (typeof payload.content === 'string') return payload.content
  // conversation.rename payloads use "title"
  if (typeof payload.title === 'string') return payload.title
  return JSON.stringify(payload, null, 2)
}

function extractTitle(payload: Record<string, unknown> | null): string {
  if (!payload) return '(unable to decode)'
  if (typeof payload.title === 'string') return payload.title
  if (typeof payload.content === 'string') return payload.content
  return JSON.stringify(payload, null, 2)
}

// ---------------------------------------------------------------------------
// Conflict description helpers
// ---------------------------------------------------------------------------

function conflictHeading(conflict: ConflictPair): string {
  switch (conflict.type) {
    case 'edit-vs-edit':
      return 'Edit conflict'
    case 'edit-vs-delete':
      return 'Edit vs. delete conflict'
    case 'rename-vs-rename':
      return 'Rename conflict'
    case 'rename-vs-delete':
      return 'Rename vs. delete conflict'
    case 'create-vs-delete':
      return 'Create vs. delete conflict'
    default:
      return 'Sync conflict'
  }
}

function isDeleteConflict(conflict: ConflictPair): boolean {
  return (
    conflict.type === 'edit-vs-delete' ||
    conflict.type === 'rename-vs-delete' ||
    conflict.type === 'create-vs-delete'
  )
}

function deleteMessage(conflict: ConflictPair): string {
  switch (conflict.type) {
    case 'edit-vs-delete':
      return 'You edited this, but it was deleted on another device.'
    case 'rename-vs-delete':
      return 'You renamed this, but it was deleted on another device.'
    case 'create-vs-delete':
      return 'Conversation deleted on another device. Keep local changes?'
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function choose(resolution: Resolution) {
  resolutions.value.set(currentIndex.value, resolution)
  // Force reactivity — Map mutations are not deeply reactive in Vue 3 by default
  resolutions.value = new Map(resolutions.value)
}

function prev() {
  if (canGoBack.value) currentIndex.value--
}

function next() {
  if (canGoForward.value) currentIndex.value++
}

function done() {
  if (!allResolved.value) return
  const result: ResolvedConflict[] = props.conflicts.map((pair, idx) => ({
    pair,
    resolution: resolutions.value.get(idx)!,
  }))
  emit('resolved', result)
}
</script>

<template>
  <div class="conflict-overlay" data-testid="conflict-resolver">
    <div class="conflict-card">
      <!-- Header -->
      <div class="conflict-header">
        <h2>Resolve Sync Conflicts</h2>
        <p class="conflict-progress">
          Conflict {{ currentIndex + 1 }} of {{ conflicts.length }}
        </p>
      </div>

      <!-- Conflict body -->
      <template v-if="currentConflict">
        <h3 class="conflict-type-heading">{{ conflictHeading(currentConflict) }}</h3>

        <!-- Delete-type conflicts -->
        <div v-if="isDeleteConflict(currentConflict)" class="delete-notice">
          <p class="delete-message">{{ deleteMessage(currentConflict) }}</p>
          <div class="local-preview">
            <span class="preview-label">Your local change</span>
            <pre class="preview-content">{{ extractContent(decodeLocal(currentConflict)) }}</pre>
          </div>
        </div>

        <!-- Side-by-side: edit-vs-edit -->
        <div v-else-if="currentConflict.type === 'edit-vs-edit'" class="side-by-side">
          <div class="side local-side">
            <span class="side-label">This device</span>
            <pre class="side-content">{{ extractContent(decodeLocal(currentConflict)) }}</pre>
          </div>
          <div class="side remote-side">
            <span class="side-label">Other device</span>
            <pre class="side-content">{{ extractContent(decodeRemote(currentConflict)) }}</pre>
          </div>
        </div>

        <!-- rename-vs-rename -->
        <div v-else-if="currentConflict.type === 'rename-vs-rename'" class="side-by-side">
          <div class="side local-side">
            <span class="side-label">This device</span>
            <p class="rename-title">"{{ extractTitle(decodeLocal(currentConflict)) }}"</p>
          </div>
          <div class="side remote-side">
            <span class="side-label">Other device</span>
            <p class="rename-title">"{{ extractTitle(decodeRemote(currentConflict)) }}"</p>
          </div>
        </div>

        <!-- Resolution buttons -->
        <div class="resolution-buttons">
          <button
            class="res-btn keep-mine"
            :class="{ selected: resolutions.get(currentIndex) === 'keep-local' }"
            data-testid="keep-local-btn"
            @click="choose('keep-local')"
          >
            Keep mine
          </button>
          <button
            class="res-btn keep-theirs"
            :class="{ selected: resolutions.get(currentIndex) === 'keep-remote' }"
            data-testid="keep-remote-btn"
            @click="choose('keep-remote')"
          >
            Keep theirs
          </button>
          <button
            v-if="keepBothAllowed"
            class="res-btn keep-both"
            :class="{ selected: resolutions.get(currentIndex) === 'keep-both' }"
            data-testid="keep-both-btn"
            @click="choose('keep-both')"
          >
            Keep both
          </button>
        </div>
      </template>

      <!-- Navigation -->
      <div class="conflict-nav">
        <button class="nav-btn" :disabled="!canGoBack" @click="prev">
          Previous
        </button>
        <button class="nav-btn" :disabled="!canGoForward" @click="next">
          Next
        </button>
      </div>

      <!-- Done -->
      <button
        class="done-btn"
        :disabled="!allResolved"
        data-testid="conflict-done-btn"
        @click="done"
      >
        Done
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ------------------------------------------------------------------ */
/* Overlay & card — same dark palette as LockScreen                   */
/* ------------------------------------------------------------------ */
.conflict-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  padding: 1rem;
}

.conflict-card {
  background: #2d2d44;
  border-radius: 1rem;
  padding: 2rem;
  max-width: 640px;
  width: 100%;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-height: 90vh;
  overflow-y: auto;
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */
.conflict-header {
  text-align: center;
}

.conflict-header h2 {
  color: #fff;
  font-size: 1.35rem;
  margin: 0 0 0.25rem;
}

.conflict-progress {
  color: #b0b0c0;
  font-size: 0.875rem;
  margin: 0;
}

.conflict-type-heading {
  color: #ff6b6b;
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  text-align: center;
}

/* ------------------------------------------------------------------ */
/* Delete-type notice                                                  */
/* ------------------------------------------------------------------ */
.delete-notice {
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.3);
  border-radius: 0.5rem;
  padding: 1rem;
}

.delete-message {
  color: #ff6b6b;
  font-weight: 500;
  margin: 0 0 0.75rem;
}

.local-preview {
  margin-top: 0.5rem;
}

.preview-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: #64b5f6;
  margin-bottom: 0.25rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.preview-content {
  background: #1a1a2e;
  border-radius: 0.5rem;
  padding: 0.75rem;
  color: #b0b0c0;
  font-size: 0.85rem;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  max-height: 12rem;
  overflow-y: auto;
}

/* ------------------------------------------------------------------ */
/* Side-by-side (edit-vs-edit, rename-vs-rename)                       */
/* ------------------------------------------------------------------ */
.side-by-side {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.side {
  background: #1a1a2e;
  border-radius: 0.5rem;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.side-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.local-side .side-label {
  color: #64b5f6;
}

.remote-side .side-label {
  color: #ffa726;
}

.side-content {
  color: #b0b0c0;
  font-size: 0.85rem;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  max-height: 14rem;
  overflow-y: auto;
}

.rename-title {
  color: #fff;
  font-size: 1rem;
  margin: 0;
  word-break: break-word;
}

/* ------------------------------------------------------------------ */
/* Resolution buttons                                                  */
/* ------------------------------------------------------------------ */
.resolution-buttons {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  flex-wrap: wrap;
}

.res-btn {
  padding: 0.625rem 1.25rem;
  border: 1px solid #444;
  border-radius: 0.5rem;
  background: #1a1a2e;
  color: #b0b0c0;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.res-btn:hover {
  background: #2d2d44;
  border-color: #64b5f6;
  color: #fff;
}

.res-btn.selected {
  background: rgba(100, 181, 246, 0.2);
  border-color: #64b5f6;
  color: #64b5f6;
  font-weight: 600;
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */
.conflict-nav {
  display: flex;
  justify-content: space-between;
}

.nav-btn {
  padding: 0.5rem 1rem;
  border: 1px solid #444;
  border-radius: 0.5rem;
  background: #1a1a2e;
  color: #b0b0c0;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.nav-btn:hover:not(:disabled) {
  background: #2d2d44;
  color: #fff;
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ------------------------------------------------------------------ */
/* Done button                                                         */
/* ------------------------------------------------------------------ */
.done-btn {
  padding: 0.875rem 1.5rem;
  border: none;
  border-radius: 0.5rem;
  background: #64b5f6;
  color: #1a1a2e;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
}

.done-btn:hover:not(:disabled) {
  background: #42a5f5;
}

.done-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ------------------------------------------------------------------ */
/* Responsive: stack side-by-side on narrow screens                    */
/* ------------------------------------------------------------------ */
@media (max-width: 480px) {
  .side-by-side {
    grid-template-columns: 1fr;
  }
  .conflict-card {
    padding: 1.25rem;
  }
}
</style>
