/**
 * Models Store
 *
 * Manages available models fetched from NanoGPT API.
 * Caches results to avoid refetching on every component mount.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetchModels, AVAILABLE_MODELS, type ModelConfig } from '@/api/nanogpt'
import { getApiKey } from '@/api/settings'

/** Cache duration in milliseconds (5 minutes) */
const CACHE_DURATION_MS = 5 * 60 * 1000

export const useModelsStore = defineStore('models', () => {
  // State
  const models = ref<ModelConfig[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const lastFetchedAt = ref<number | null>(null)

  // Computed
  const availableModels = computed(() => {
    // Return fetched models if available, otherwise fallback to static list
    return models.value.length > 0 ? models.value : AVAILABLE_MODELS
  })

  const isCacheValid = computed(() => {
    if (!lastFetchedAt.value) return false
    return Date.now() - lastFetchedAt.value < CACHE_DURATION_MS
  })

  // Actions
  async function loadModels(force = false) {
    // Skip if cache is valid and not forcing refresh
    if (!force && isCacheValid.value && models.value.length > 0) {
      return
    }

    // Skip if already loading
    if (isLoading.value) {
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const apiKey = getApiKey()
      const fetchedModels = await fetchModels(apiKey)
      models.value = fetchedModels
      lastFetchedAt.value = Date.now()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch models'
      // Keep using fallback models on error
      console.warn('Failed to fetch models from API, using fallback list:', error.value)
    } finally {
      isLoading.value = false
    }
  }

  function clearCache() {
    models.value = []
    lastFetchedAt.value = null
    error.value = null
  }

  return {
    // State
    models,
    isLoading,
    error,
    lastFetchedAt,
    // Computed
    availableModels,
    isCacheValid,
    // Actions
    loadModels,
    clearCache,
  }
})
