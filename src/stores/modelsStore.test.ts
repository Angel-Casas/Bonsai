/**
 * Models Store Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useModelsStore } from './modelsStore'
import { AVAILABLE_MODELS } from '@/api/nanogpt'

// Mock the settings API
vi.mock('@/api/settings', () => ({
  getApiKey: vi.fn(() => 'test-api-key'),
}))

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

describe('modelsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('has empty models array', () => {
      const store = useModelsStore()
      expect(store.models).toEqual([])
    })

    it('is not loading initially', () => {
      const store = useModelsStore()
      expect(store.isLoading).toBe(false)
    })

    it('has no error initially', () => {
      const store = useModelsStore()
      expect(store.error).toBeNull()
    })

    it('returns fallback models when no models fetched', () => {
      const store = useModelsStore()
      expect(store.availableModels).toEqual(AVAILABLE_MODELS)
    })
  })

  describe('loadModels', () => {
    it('fetches models from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          object: 'list',
          data: [
            { id: 'gpt-4', object: 'model', created: 1234567890, owned_by: 'openai' },
            { id: 'claude-3', object: 'model', created: 1234567890, owned_by: 'anthropic' },
          ],
        }),
      })

      const store = useModelsStore()
      await store.loadModels()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://nano-gpt.com/api/v1/models?detailed=true',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Accept: 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        })
      )

      expect(store.models).toHaveLength(2)
      expect(store.models[0]!.id).toBe('gpt-4')
      expect(store.models[1]!.id).toBe('claude-3')
    })

    it('sets loading state while fetching', async () => {
      let resolvePromise: (value: unknown) => void
      const fetchPromise = new Promise(resolve => {
        resolvePromise = resolve
      })
      mockFetch.mockReturnValueOnce(fetchPromise)

      const store = useModelsStore()
      const loadPromise = store.loadModels()

      expect(store.isLoading).toBe(true)

      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ object: 'list', data: [] }),
      })
      await loadPromise

      expect(store.isLoading).toBe(false)
    })

    it('handles fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const store = useModelsStore()
      await store.loadModels()

      expect(store.error).toBe('Network error')
      // Should still return fallback models
      expect(store.availableModels).toEqual(AVAILABLE_MODELS)
    })

    it('handles HTTP errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const store = useModelsStore()
      await store.loadModels()

      expect(store.error).toBe('Failed to fetch models: HTTP 500')
      expect(store.availableModels).toEqual(AVAILABLE_MODELS)
    })

    it('uses cache when valid', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          object: 'list',
          data: [{ id: 'gpt-4', object: 'model', created: 1234567890, owned_by: 'openai' }],
        }),
      })

      const store = useModelsStore()
      await store.loadModels()
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Second call should use cache
      await store.loadModels()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('force refresh bypasses cache', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          object: 'list',
          data: [{ id: 'gpt-4', object: 'model', created: 1234567890, owned_by: 'openai' }],
        }),
      })

      const store = useModelsStore()
      await store.loadModels()
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Force refresh should bypass cache
      await store.loadModels(true)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('clearCache', () => {
    it('clears models and cache timestamp', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          object: 'list',
          data: [{ id: 'gpt-4', object: 'model', created: 1234567890, owned_by: 'openai' }],
        }),
      })

      const store = useModelsStore()
      await store.loadModels()
      expect(store.models).toHaveLength(1)
      expect(store.isCacheValid).toBe(true)

      store.clearCache()

      expect(store.models).toEqual([])
      expect(store.lastFetchedAt).toBeNull()
      expect(store.isCacheValid).toBe(false)
    })
  })

  describe('formatModelName', () => {
    it('formats model IDs nicely', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          object: 'list',
          data: [
            { id: 'chatgpt-4o-latest', object: 'model', created: 1234567890, owned_by: 'openai' },
            { id: 'claude-3-opus', object: 'model', created: 1234567890, owned_by: 'anthropic' },
          ],
        }),
      })

      const store = useModelsStore()
      await store.loadModels()

      expect(store.models[0]!.name).toBe('Chatgpt 4o Latest')
      expect(store.models[1]!.name).toBe('Claude 3 Opus')
    })
  })
})
