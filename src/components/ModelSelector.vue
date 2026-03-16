<script setup lang="ts">
/**
 * ModelSelector - Enhanced dropdown for selecting AI models
 *
 * Features:
 * - Search/filter models
 * - Group by provider
 * - Provider filter panel
 * - Sort by name/price
 * - Provider icons
 * - Keyboard navigation
 * - Smooth animations
 */

import { ref, computed, watch, nextTick } from 'vue'
import { useModelsStore } from '@/stores/modelsStore'
import { useThemeStore } from '@/stores/themeStore'
import type { ModelConfig } from '@/api/nanogpt'

const themeStore = useThemeStore()

const props = defineProps<{
  modelValue: string | null
  conversationDefault?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  close: []
}>()

const modelsStore = useModelsStore()
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const highlightedIndex = ref(0)

// Filter & Sort state
type SortOption = 'name' | 'price-low' | 'price-high' | 'provider' | 'newest' | 'oldest'
const sortBy = ref<SortOption>('provider')
const selectedProviders = ref<Set<string>>(new Set())
const showFilters = ref(true)

// Mobile tab state
type MobileTab = 'models' | 'filters'
const mobileTab = ref<MobileTab>('models')

// Format date for display
function formatDate(timestamp: number | undefined): string | null {
  if (!timestamp) return null
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function formatDateFull(timestamp: number | undefined): string {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Format pricing for display
function formatPrice(price: number): string {
  if (price < 0.01) {
    return `$${price.toFixed(4)}`
  } else if (price < 1) {
    return `$${price.toFixed(3)}`
  } else {
    return `$${price.toFixed(2)}`
  }
}

function formatPriceShort(price: number): string {
  if (price < 0.001) {
    return `$${(price * 1000).toFixed(2)}m`
  } else if (price < 1) {
    return `$${price.toFixed(2)}`
  } else {
    return `$${price.toFixed(0)}`
  }
}

function getPricingDisplay(model: ModelConfig): string | null {
  if (!model.pricing) return null
  const input = formatPriceShort(model.pricing.input)
  const output = formatPriceShort(model.pricing.output)
  return `${input}/${output}`
}

function getPricingTooltip(model: ModelConfig): string {
  if (!model.pricing) return ''
  return `Input: ${formatPrice(model.pricing.input)}/M tokens\nOutput: ${formatPrice(model.pricing.output)}/M tokens`
}

function getAveragePrice(model: ModelConfig): number {
  if (!model.pricing) return Infinity
  return (model.pricing.input + model.pricing.output) / 2
}

// Provider detection and icons
const PROVIDER_CONFIG: Record<string, { name: string; icon: string; color: string }> = {
  'openai': { name: 'OpenAI', icon: '◐', color: '#10a37f' },
  'gpt': { name: 'OpenAI', icon: '◐', color: '#10a37f' },
  'chatgpt': { name: 'OpenAI', icon: '◐', color: '#10a37f' },
  'o1': { name: 'OpenAI', icon: '◐', color: '#10a37f' },
  'o3': { name: 'OpenAI', icon: '◐', color: '#10a37f' },
  'o4': { name: 'OpenAI', icon: '◐', color: '#10a37f' },
  'claude': { name: 'Anthropic', icon: '◈', color: '#cc785c' },
  'anthropic': { name: 'Anthropic', icon: '◈', color: '#cc785c' },
  'gemini': { name: 'Google', icon: '◆', color: '#4285f4' },
  'google': { name: 'Google', icon: '◆', color: '#4285f4' },
  'deepseek': { name: 'DeepSeek', icon: '◇', color: '#0066ff' },
  'mistral': { name: 'Mistral', icon: '▲', color: '#ff7000' },
  'llama': { name: 'Meta', icon: '◎', color: '#0668e1' },
  'meta': { name: 'Meta', icon: '◎', color: '#0668e1' },
  'grok': { name: 'xAI', icon: '✕', color: '#1da1f2' },
  'x-ai': { name: 'xAI', icon: '✕', color: '#1da1f2' },
  'qwen': { name: 'Alibaba', icon: '◉', color: '#ff6a00' },
}

function getProviderInfo(modelId: string) {
  const lowerId = modelId.toLowerCase()
  for (const [key, config] of Object.entries(PROVIDER_CONFIG)) {
    if (lowerId.includes(key)) {
      return config
    }
  }
  return { name: 'Other', icon: '●', color: '#888888' }
}

// Get all available providers from models
const availableProviders = computed(() => {
  const providers = new Map<string, { name: string; icon: string; color: string; count: number }>()

  for (const model of modelsStore.availableModels) {
    const info = getProviderInfo(model.id)
    const existing = providers.get(info.name)
    if (existing) {
      existing.count++
    } else {
      providers.set(info.name, { ...info, count: 1 })
    }
  }

  // Sort by count descending
  return Array.from(providers.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([, info]) => info)
})

// Toggle provider filter
function toggleProvider(providerName: string) {
  const newSet = new Set(selectedProviders.value)
  if (newSet.has(providerName)) {
    newSet.delete(providerName)
  } else {
    newSet.add(providerName)
  }
  selectedProviders.value = newSet
}

function clearProviderFilters() {
  selectedProviders.value = new Set()
}

function selectAllProviders() {
  selectedProviders.value = new Set(availableProviders.value.map(p => p.name))
}

// Filter and sort models
const filteredModels = computed(() => {
  const query = searchQuery.value.toLowerCase().trim()
  let models = [...modelsStore.availableModels]

  // Apply search filter
  if (query) {
    models = models.filter(m =>
      m.id.toLowerCase().includes(query) ||
      m.name.toLowerCase().includes(query) ||
      getProviderInfo(m.id).name.toLowerCase().includes(query)
    )
  }

  // Apply provider filter
  if (selectedProviders.value.size > 0) {
    models = models.filter(m =>
      selectedProviders.value.has(getProviderInfo(m.id).name)
    )
  }

  // Apply sorting
  switch (sortBy.value) {
    case 'name':
      models.sort((a, b) => a.name.localeCompare(b.name))
      break
    case 'price-low':
      models.sort((a, b) => getAveragePrice(a) - getAveragePrice(b))
      break
    case 'price-high':
      models.sort((a, b) => getAveragePrice(b) - getAveragePrice(a))
      break
    case 'newest':
      models.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      break
    case 'oldest':
      models.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      break
    case 'provider':
      // Keep default grouping order
      break
  }

  return models
})

const groupedModels = computed(() => {
  if (sortBy.value !== 'provider') {
    // Return flat list when sorting by something other than provider
    return [{ provider: '', models: filteredModels.value }]
  }

  const groups: Record<string, ModelConfig[]> = {}

  for (const model of filteredModels.value) {
    const provider = getProviderInfo(model.id).name
    if (!groups[provider]) {
      groups[provider] = []
    }
    groups[provider].push(model)
  }

  // Sort groups: popular providers first
  const providerOrder = ['OpenAI', 'Anthropic', 'Google', 'DeepSeek', 'Mistral', 'Meta', 'xAI']
  const sortedGroups: { provider: string; models: ModelConfig[] }[] = []

  for (const provider of providerOrder) {
    if (groups[provider]) {
      sortedGroups.push({ provider, models: groups[provider] })
      delete groups[provider]
    }
  }

  // Add remaining providers
  for (const [provider, models] of Object.entries(groups)) {
    sortedGroups.push({ provider, models })
  }

  return sortedGroups
})

// Flat list for keyboard navigation
const flatModels = computed(() => filteredModels.value)

// Active filter count
const activeFilterCount = computed(() => {
  let count = 0
  if (selectedProviders.value.size > 0) count++
  if (sortBy.value !== 'provider') count++
  return count
})

// Keyboard navigation
function handleKeydown(e: KeyboardEvent) {
  const total = flatModels.value.length
  if (total === 0) return

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      highlightedIndex.value = (highlightedIndex.value + 1) % total
      scrollToHighlighted()
      break
    case 'ArrowUp':
      e.preventDefault()
      highlightedIndex.value = (highlightedIndex.value - 1 + total) % total
      scrollToHighlighted()
      break
    case 'Enter':
      e.preventDefault()
      const selectedModel = flatModels.value[highlightedIndex.value]
      if (selectedModel) {
        selectModel(selectedModel.id)
      }
      break
    case 'Escape':
      e.preventDefault()
      emit('close')
      break
  }
}

function scrollToHighlighted() {
  nextTick(() => {
    const el = document.querySelector(`[data-model-index="${highlightedIndex.value}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function selectModel(modelId: string | null) {
  emit('update:modelValue', modelId)
  emit('close')
}

function isSelected(modelId: string) {
  if (props.modelValue === null) {
    return modelId === props.conversationDefault
  }
  return modelId === props.modelValue
}

// Reset highlight when filters change
watch([searchQuery, selectedProviders, sortBy], () => {
  highlightedIndex.value = 0
})

// Focus search input on mount
watch(() => searchInput.value, (el) => {
  if (el) {
    nextTick(() => el.focus())
  }
}, { immediate: true })

// Load models when opened
modelsStore.loadModels()
</script>

<template>
  <div
    class="model-selector"
    :class="{ 'day-mode': themeStore.isDayMode }"
    @keydown="handleKeydown"
  >
    <!-- Mobile Tabs -->
    <div class="mobile-tabs">
      <button
        class="mobile-tab"
        :class="{ active: mobileTab === 'models' }"
        @click="mobileTab = 'models'"
      >
        Models
        <span class="tab-count">{{ filteredModels.length }}</span>
      </button>
      <button
        class="mobile-tab"
        :class="{ active: mobileTab === 'filters' }"
        @click="mobileTab = 'filters'"
      >
        Filters
        <span v-if="activeFilterCount > 0" class="tab-badge">{{ activeFilterCount }}</span>
      </button>
    </div>

    <div class="selector-layout">
      <!-- Left Panel: Model List -->
      <div class="models-panel" :class="{ 'mobile-hidden': mobileTab !== 'models' }">
        <!-- Header with search -->
        <div class="selector-header">
          <div class="search-wrapper">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref="searchInput"
              v-model="searchQuery"
              type="text"
              placeholder="Search models..."
              class="search-input"
              data-testid="model-search-input"
            />
            <span v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </span>
          </div>
        </div>

        <!-- Use default option -->
        <div class="default-option">
          <button
            class="model-option"
            :class="{ selected: props.modelValue === null }"
            @click="selectModel(null)"
          >
            <span class="model-icon default-icon">↩</span>
            <div class="model-info">
              <span class="model-name">Use conversation default</span>
              <span v-if="props.conversationDefault" class="model-id">{{ props.conversationDefault }}</span>
            </div>
            <span v-if="props.modelValue === null" class="check-icon">✓</span>
          </button>
        </div>

        <!-- Loading state -->
        <div v-if="modelsStore.isLoading" class="loading-state">
          <div class="loading-spinner"></div>
          <span>Loading models...</span>
        </div>

        <!-- Model list -->
        <div v-else class="model-list">
          <!-- Empty state -->
          <div v-if="filteredModels.length === 0" class="empty-state">
            <span>No models found</span>
            <button v-if="searchQuery || selectedProviders.size > 0" class="clear-search-btn" @click="searchQuery = ''; clearProviderFilters()">
              Clear filters
            </button>
          </div>

          <!-- Grouped models -->
          <template v-for="group in groupedModels" :key="group.provider">
            <div class="provider-group">
              <div v-if="group.provider" class="provider-header">
                <span
                  class="provider-icon"
                  :style="{ color: getProviderInfo(group.models[0]?.id ?? '').color }"
                >
                  {{ getProviderInfo(group.models[0]?.id ?? '').icon }}
                </span>
                <span class="provider-name">{{ group.provider }}</span>
                <span class="provider-count">{{ group.models.length }}</span>
              </div>

              <button
                v-for="model in group.models"
                :key="model.id"
                class="model-option"
                :class="{
                  selected: isSelected(model.id),
                  highlighted: flatModels.indexOf(model) === highlightedIndex
                }"
                :data-model-index="flatModels.indexOf(model)"
                :title="getPricingTooltip(model)"
                @click="selectModel(model.id)"
                @mouseenter="highlightedIndex = flatModels.indexOf(model)"
              >
                <span
                  class="model-icon"
                  :style="{ color: getProviderInfo(model.id).color }"
                >
                  {{ getProviderInfo(model.id).icon }}
                </span>
                <div class="model-info">
                  <div class="model-name-row">
                    <span class="model-name">{{ model.name }}</span>
                  </div>
                  <div class="model-meta">
                    <span class="model-id">{{ model.id }}</span>
                    <span v-if="model.createdAt" class="model-date" :title="formatDateFull(model.createdAt)">
                      {{ formatDate(model.createdAt) }}
                    </span>
                  </div>
                </div>
                <span v-if="model.pricing" class="model-pricing" :title="getPricingTooltip(model)">
                  {{ getPricingDisplay(model) }}
                </span>
                <span v-if="isSelected(model.id)" class="check-icon">✓</span>
              </button>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div class="selector-footer">
          <span class="model-count">{{ filteredModels.length }} models</span>
          <button class="toggle-filters-btn" @click="showFilters = !showFilters">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M7 12h10M10 18h4" />
            </svg>
            <span>Filters</span>
            <span v-if="activeFilterCount > 0" class="filter-badge">{{ activeFilterCount }}</span>
          </button>
        </div>
      </div>

      <!-- Right Panel: Filters -->
      <Transition name="slide">
        <div v-if="showFilters || mobileTab === 'filters'" class="filters-panel" :class="{ 'mobile-hidden': mobileTab !== 'filters' }">
          <div class="filters-header">
            <span class="filters-title">Filters & Sort</span>
            <button class="close-filters-btn" @click="showFilters = false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Sort Options -->
          <div class="filter-section">
            <div class="filter-section-title">Sort by</div>
            <div class="sort-options">
              <button
                class="sort-option"
                :class="{ active: sortBy === 'provider' }"
                @click="sortBy = 'provider'"
              >
                <span class="sort-icon">◫</span>
                Provider
              </button>
              <button
                class="sort-option"
                :class="{ active: sortBy === 'name' }"
                @click="sortBy = 'name'"
              >
                <span class="sort-icon">↓A</span>
                Name
              </button>
              <button
                class="sort-option"
                :class="{ active: sortBy === 'price-low' }"
                @click="sortBy = 'price-low'"
              >
                <span class="sort-icon">$↑</span>
                Cheapest
              </button>
              <button
                class="sort-option"
                :class="{ active: sortBy === 'price-high' }"
                @click="sortBy = 'price-high'"
              >
                <span class="sort-icon">$↓</span>
                Priciest
              </button>
              <button
                class="sort-option"
                :class="{ active: sortBy === 'newest' }"
                @click="sortBy = 'newest'"
              >
                <span class="sort-icon">★</span>
                Newest
              </button>
              <button
                class="sort-option"
                :class="{ active: sortBy === 'oldest' }"
                @click="sortBy = 'oldest'"
              >
                <span class="sort-icon">○</span>
                Oldest
              </button>
            </div>
          </div>

          <!-- Provider Filters -->
          <div class="filter-section">
            <div class="filter-section-header">
              <span class="filter-section-title">Providers</span>
              <div class="provider-actions">
                <button
                  v-if="selectedProviders.size > 0"
                  class="provider-action-btn"
                  @click="clearProviderFilters"
                >
                  Clear
                </button>
                <button
                  v-else
                  class="provider-action-btn"
                  @click="selectAllProviders"
                >
                  All
                </button>
              </div>
            </div>
            <div class="provider-filters">
              <button
                v-for="provider in availableProviders"
                :key="provider.name"
                class="provider-filter"
                :class="{
                  active: selectedProviders.has(provider.name),
                  dimmed: selectedProviders.size > 0 && !selectedProviders.has(provider.name)
                }"
                @click="toggleProvider(provider.name)"
              >
                <span class="provider-filter-icon" :style="{ color: provider.color }">
                  {{ provider.icon }}
                </span>
                <span class="provider-filter-name">{{ provider.name }}</span>
                <span class="provider-filter-count">{{ provider.count }}</span>
              </button>
            </div>
          </div>

          <!-- Price Legend -->
          <div class="filter-section price-legend">
            <div class="filter-section-title">Price Format</div>
            <div class="legend-content">
              <div class="legend-item">
                <span class="legend-label">Input / Output</span>
                <span class="legend-value">per 1M tokens</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.model-selector {
  width: auto;
  height: 520px;
  max-height: calc(100vh - 200px);
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.selector-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Day mode - higher opacity backgrounds for better readability */
.model-selector.day-mode {
  background: rgba(255, 255, 255, 0.95);
}

.model-selector.day-mode .filters-panel {
  background: rgba(255, 255, 255, 0.7);
}

.model-selector.day-mode .selector-header {
  background: rgba(255, 255, 255, 0.7);
}

.model-selector.day-mode .selector-footer {
  background: rgba(255, 255, 255, 0.7);
}

.model-selector.day-mode .search-input {
  background: rgba(255, 255, 255, 0.9);
}

.model-selector.day-mode .model-option:hover,
.model-selector.day-mode .model-option.highlighted {
  background: rgba(0, 0, 0, 0.1);
}

.model-selector.day-mode .model-option.selected {
  background: rgba(0, 0, 0, 0.15);
}

.model-selector.day-mode .sort-option:hover {
  background: rgba(0, 0, 0, 0.1);
}

.model-selector.day-mode .sort-option.active {
  background: rgba(0, 0, 0, 0.15);
}

.model-selector.day-mode .provider-filter:hover {
  background: rgba(0, 0, 0, 0.1);
}

.model-selector.day-mode .provider-filter.active {
  background: rgba(0, 0, 0, 0.15);
}

.model-selector.day-mode .legend-content {
  background: rgba(0, 0, 0, 0.1);
}

/* Models Panel (Left) */
.models-panel {
  width: 340px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  min-height: 0;
  overflow: hidden;
}

/* Filters Panel (Right) */
.filters-panel {
  width: 200px;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.7);
  overflow-y: auto;
}

.filters-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.filters-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.close-filters-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.close-filters-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.close-filters-btn svg {
  width: 14px;
  height: 14px;
}

/* Filter Sections */
.filter-section {
  padding: 12px;
  border-bottom: 1px solid var(--border-muted);
}

.filter-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.filter-section-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.filter-section-header .filter-section-title {
  margin-bottom: 0;
}

.provider-actions {
  display: flex;
  gap: 4px;
}

.provider-action-btn {
  padding: 2px 6px;
  background: transparent;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 10px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.provider-action-btn:hover {
  background: rgba(var(--accent-rgb), 0.1);
  border-color: rgba(var(--accent-rgb), 0.3);
  color: var(--accent);
}

/* Sort Options */
.sort-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sort-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all var(--transition-fast);
  text-align: left;
}

.sort-option:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.sort-option.active {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(var(--accent-rgb), 0.3);
  color: var(--accent);
}

.sort-icon {
  width: 20px;
  font-size: 11px;
  text-align: center;
}

/* Provider Filters */
.provider-filters {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.provider-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all var(--transition-fast);
  text-align: left;
}

.provider-filter:hover {
  background: rgba(255, 255, 255, 0.1);
}

.provider-filter.active {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(var(--accent-rgb), 0.25);
  color: var(--text-primary);
}

.provider-filter.dimmed {
  opacity: 0.5;
}

.provider-filter-icon {
  font-size: 12px;
  width: 16px;
  text-align: center;
}

.provider-filter-name {
  flex: 1;
}

.provider-filter-count {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--border-muted);
  padding: 1px 5px;
  border-radius: 8px;
}

/* Price Legend */
.price-legend {
  margin-top: auto;
}

.legend-content {
  background: rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-md);
  padding: 8px;
}

.legend-item {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
}

.legend-label {
  color: var(--text-secondary);
}

.legend-value {
  color: var(--text-muted);
}

/* Slide Transition */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
  width: 0;
  opacity: 0;
}

/* Header */
.selector-header {
  padding: 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: rgba(0, 0, 0, 0.7);
  flex-shrink: 0;
}

.search-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 10px 36px;
  background: rgba(0, 0, 0, 0.9);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  font-family: var(--font-sans);
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1);
}

.search-clear {
  position: absolute;
  right: 8px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-muted);
  transition: color var(--transition-fast), background var(--transition-fast);
}

.search-clear:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.1);
}

.search-clear svg {
  width: 14px;
  height: 14px;
}

/* Default option */
.default-option {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

/* Model list */
.model-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px;
}

.model-list::-webkit-scrollbar {
  width: 6px;
}

.model-list::-webkit-scrollbar-track {
  background: transparent;
}

.model-list::-webkit-scrollbar-thumb {
  background: rgba(var(--accent-rgb), 0.2);
  border-radius: 3px;
}

.model-list::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--accent-rgb), 0.3);
}

/* Provider groups */
.provider-group {
  margin-bottom: 4px;
}

.provider-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.provider-icon {
  font-size: 12px;
}

.provider-name {
  flex: 1;
}

.provider-count {
  background: var(--border-muted);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
}

/* Model option */
.model-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  transition: background var(--transition-fast);
}

.model-option:hover,
.model-option.highlighted {
  background: rgba(255, 255, 255, 0.1);
}

.model-option.selected {
  background: rgba(255, 255, 255, 0.15);
}

.model-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}

.model-icon.default-icon {
  color: var(--text-muted);
}

.model-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.model-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-id {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-date {
  font-size: 9px;
  color: var(--text-secondary);
  background: var(--border-muted);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  flex-shrink: 0;
}

.model-pricing {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--success);
  background: var(--success-bg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  flex-shrink: 0;
}

.check-icon {
  color: var(--accent);
  font-size: 14px;
  font-weight: bold;
  flex-shrink: 0;
}

/* Loading state */
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  color: var(--text-muted);
  font-size: 14px;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(var(--accent-rgb), 0.2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px;
  color: var(--text-muted);
  font-size: 14px;
}

.clear-search-btn {
  padding: 6px 12px;
  background: rgba(var(--accent-rgb), 0.1);
  border: 1px solid rgba(var(--accent-rgb), 0.2);
  border-radius: var(--radius-md);
  color: var(--accent);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.clear-search-btn:hover {
  background: rgba(var(--accent-rgb), 0.2);
}

/* Footer */
.selector-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-top: 1px solid var(--border-subtle);
  background: rgba(0, 0, 0, 0.7);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.model-count {
  font-weight: 500;
}

.toggle-filters-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(var(--accent-rgb), 0.1);
  border: 1px solid rgba(var(--accent-rgb), 0.2);
  border-radius: var(--radius-md);
  color: var(--accent);
  font-size: 11px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.toggle-filters-btn:hover {
  background: rgba(var(--accent-rgb), 0.2);
}

.toggle-filters-btn svg {
  width: 14px;
  height: 14px;
}

.filter-badge {
  background: var(--accent);
  color: var(--bg-primary);
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 8px;
  min-width: 16px;
  text-align: center;
}

/* Mobile Tabs - Hidden on desktop */
.mobile-tabs {
  display: none;
}

/* Mobile Responsive Styles */
@media (max-width: 560px) {
  .model-selector {
    width: 100%;
    max-width: 100%;
    height: auto;
    max-height: 100%;
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
  }

  .mobile-tabs {
    display: flex;
    border-bottom: 1px solid var(--border-subtle);
    background: rgba(var(--accent-rgb), 0.08);
    flex-shrink: 0;
  }

  .mobile-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .mobile-tab:hover {
    color: var(--text-primary);
    background: rgba(var(--accent-rgb), 0.05);
  }

  .mobile-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.08);
  }

  .tab-count {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--border-muted);
    padding: 2px 6px;
    border-radius: 10px;
  }

  .mobile-tab.active .tab-count {
    background: rgba(var(--accent-rgb), 0.2);
    color: var(--accent);
  }

  .tab-badge {
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
  }

  .selector-layout {
    flex-direction: column;
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .models-panel {
    width: 100%;
    border-right: none;
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
  }

  .filters-panel {
    width: 100%;
    flex: 1;
    min-height: 0;
    position: static;
    border-radius: 0;
    overflow-x: hidden;
  }

  /* Ensure model info truncates properly */
  .model-info {
    overflow: hidden;
    min-width: 0;
  }

  .model-meta {
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .model-id {
    max-width: 120px;
  }

  .mobile-hidden {
    display: none !important;
  }

  /* Hide desktop filter toggle on mobile */
  .toggle-filters-btn {
    display: none;
  }

  /* Hide filters close button on mobile (use tabs instead) */
  .close-filters-btn {
    display: none;
  }

  /* Disable slide transition on mobile */
  .slide-enter-active,
  .slide-leave-active {
    transition: none;
  }

  .slide-enter-from,
  .slide-leave-to {
    width: auto;
    opacity: 1;
  }

  /* Compact header */
  .selector-header {
    padding: 8px;
  }

  .search-input {
    padding: 8px 32px;
    font-size: 13px;
  }

  /* Compact default option */
  .default-option {
    padding: 2px 6px;
  }

  /* Compact model list */
  .model-list {
    padding: 2px 6px;
  }

  /* Compact provider headers */
  .provider-header {
    padding: 6px 8px 2px;
    font-size: 10px;
  }

  /* Compact model options */
  .model-option {
    padding: 6px 8px;
    gap: 8px;
  }

  .model-icon {
    width: 16px;
    height: 16px;
    font-size: 12px;
  }

  .model-name {
    font-size: 12px;
  }

  .model-id {
    font-size: 9px;
  }

  .model-date {
    font-size: 8px;
    padding: 1px 4px;
  }

  .model-pricing {
    font-size: 9px;
    padding: 1px 4px;
  }

  .check-icon {
    font-size: 12px;
  }

  /* Compact footer */
  .selector-footer {
    padding: 6px 8px;
    font-size: 10px;
  }

  /* Compact filter sections */
  .filter-section {
    padding: 8px;
  }

  .filter-section-title {
    font-size: 9px;
    margin-bottom: 6px;
  }

  .sort-option {
    padding: 6px 8px;
    font-size: 11px;
    gap: 6px;
  }

  .sort-icon {
    width: 16px;
    font-size: 10px;
  }

  .provider-filter {
    padding: 5px 6px;
    font-size: 11px;
    gap: 6px;
  }

  .provider-filter-icon {
    font-size: 10px;
    width: 14px;
  }

  .provider-filter-count {
    font-size: 9px;
    padding: 1px 4px;
  }

  .filters-header {
    padding: 8px;
  }

  .filters-title {
    font-size: 11px;
  }

  /* Compact loading/empty states */
  .loading-state,
  .empty-state {
    padding: 20px;
    font-size: 12px;
  }

  .loading-spinner {
    width: 16px;
    height: 16px;
  }
}
</style>
