<script setup lang="ts">
/**
 * SearchPanel - Search UI for conversation messages
 *
 * Features:
 * - Search input with debounced updates
 * - Results list with match highlighting
 * - Jump-to-message on click
 * - Shows branch title and role indicators
 * - Keyboard navigation (Escape to close)
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { Message } from '@/db/types'
import { searchMessages, getMatchSnippet, debounce, type SearchResult } from '@/utils/searchUtils'

const props = defineProps<{
  messages: Message[]
  isOpen: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [messageId: string]
}>()

// Search state
const searchQuery = ref('')
const searchResults = ref<SearchResult[]>([])
const searchInputRef = ref<HTMLInputElement | null>(null)

// Debounced search function
const performSearch = debounce((query: string) => {
  searchResults.value = searchMessages(props.messages, query)
}, 150)

// Watch for query changes
watch(searchQuery, (newQuery) => {
  performSearch(newQuery)
})

// Watch for messages changes (refresh search)
watch(() => props.messages, () => {
  if (searchQuery.value) {
    performSearch(searchQuery.value)
  }
})

// Focus input when panel opens
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    // Use nextTick-like delay to ensure element is in DOM
    setTimeout(() => {
      searchInputRef.value?.focus()
    }, 50)
  } else {
    // Clear search when closing
    searchQuery.value = ''
    searchResults.value = []
  }
})

// Keyboard handler for Escape
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  performSearch.cancel()
})

// Helpers
function getRoleIcon(role: Message['role']): string {
  switch (role) {
    case 'system':
      return '⚙️'
    case 'user':
      return '👤'
    case 'assistant':
      return '🤖'
    default:
      return '💬'
  }
}

function getRoleLabel(role: Message['role']): string {
  switch (role) {
    case 'system':
      return 'System'
    case 'user':
      return 'You'
    case 'assistant':
      return 'Assistant'
    default:
      return role
  }
}

function handleSelectResult(result: SearchResult) {
  emit('select', result.message.id)
  emit('close')
}

// Highlight match helper
function highlightMatch(result: SearchResult): string {
  const snippet = getMatchSnippet(
    result.matchedText,
    result.matchStart,
    result.matchEnd,
    40
  )

  const escape = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const prefix = snippet.hasMoreBefore ? '...' : ''
  const suffix = snippet.hasMoreAfter ? '...' : ''

  return `${prefix}${escape(snippet.prefix)}<mark class="bg-yellow-500/30 text-yellow-200 rounded px-0.5">${escape(snippet.match)}</mark>${escape(snippet.suffix)}${suffix}`
}

// Computed
const hasResults = computed(() => searchResults.value.length > 0)
const hasQuery = computed(() => searchQuery.value.trim().length > 0)
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-4 pt-16"
    data-testid="search-panel"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-2xl rounded-lg bg-gray-800 shadow-2xl" @click.stop>
      <!-- Search Input -->
      <div class="border-b border-gray-700 p-4">
        <div class="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clip-rule="evenodd"
            />
          </svg>
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            placeholder="Search messages and branch titles..."
            class="w-full rounded-lg border border-gray-600 bg-gray-700 py-3 pl-10 pr-4 text-white placeholder-gray-400 focus:border-emerald-500 focus:outline-none"
            data-testid="search-input"
          />
          <button
            v-if="searchQuery"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            @click="searchQuery = ''"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
        <p class="mt-2 text-xs text-gray-500">
          Press <kbd class="rounded bg-gray-700 px-1.5 py-0.5 text-gray-400">Esc</kbd> to close
        </p>
      </div>

      <!-- Results -->
      <div class="max-h-[60vh] overflow-y-auto">
        <!-- Empty state: no query -->
        <div
          v-if="!hasQuery"
          class="flex flex-col items-center justify-center py-12 text-gray-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="mb-3 h-10 w-10" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
          </svg>
          <p>Type to search messages</p>
        </div>

        <!-- Empty state: no results -->
        <div
          v-else-if="!hasResults"
          class="flex flex-col items-center justify-center py-12 text-gray-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="mb-3 h-10 w-10" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
          <p>No results found for "{{ searchQuery }}"</p>
        </div>

        <!-- Results list -->
        <div v-else class="divide-y divide-gray-700">
          <button
            v-for="result in searchResults"
            :key="`${result.message.id}-${result.matchType}`"
            class="w-full px-4 py-3 text-left transition-colors hover:bg-gray-700/50"
            :data-testid="`search-result-${result.message.id}`"
            @click="handleSelectResult(result)"
          >
            <!-- Header row -->
            <div class="mb-1 flex items-center gap-2">
              <!-- Role icon -->
              <span class="text-sm">{{ getRoleIcon(result.message.role) }}</span>
              
              <!-- Role label -->
              <span class="text-xs text-gray-400">{{ getRoleLabel(result.message.role) }}</span>

              <!-- Branch title badge -->
              <span
                v-if="result.message.branchTitle"
                class="rounded bg-purple-900/50 px-2 py-0.5 text-xs text-purple-300"
              >
                {{ result.message.branchTitle }}
              </span>

              <!-- Match type indicator -->
              <span
                v-if="result.matchType === 'branchTitle'"
                class="ml-auto rounded bg-purple-600/30 px-2 py-0.5 text-xs text-purple-300"
              >
                title match
              </span>
            </div>

            <!-- Snippet with highlighted match -->
            <div class="text-sm text-gray-300">
              <template v-if="result.matchType === 'branchTitle'">
                <!-- For branch title matches, show the title with highlight -->
                <span class="text-gray-400">Branch: </span>
                <span v-html="highlightMatch(result)"></span>
              </template>
              <template v-else>
                <!-- For content matches, show snippet -->
                <span v-html="highlightMatch(result)"></span>
              </template>
            </div>
          </button>
        </div>

        <!-- Results count -->
        <div
          v-if="hasResults"
          class="border-t border-gray-700 px-4 py-2 text-xs text-gray-500"
        >
          {{ searchResults.length }} result{{ searchResults.length === 1 ? '' : 's' }}
        </div>
      </div>
    </div>
  </div>
</template>
