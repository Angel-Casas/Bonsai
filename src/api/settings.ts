/**
 * Settings Storage for Bonsai PWA
 * 
 * Stores API keys and other settings in localStorage.
 * This is intentionally separate from IndexedDB to keep sensitive
 * data in a different storage mechanism.
 */

const STORAGE_KEYS = {
  NANOGPT_API_KEY: 'bonsai:nanogpt:apiKey',
  DEFAULT_MODEL: 'bonsai:settings:defaultModel',
} as const

/**
 * Get the stored NanoGPT API key
 */
export function getApiKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.NANOGPT_API_KEY)
  } catch {
    // localStorage might not be available in some contexts
    return null
  }
}

/**
 * Set the NanoGPT API key
 */
export function setApiKey(apiKey: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.NANOGPT_API_KEY, apiKey)
  } catch {
    // Silently fail if localStorage is not available
  }
}

/**
 * Remove the stored API key
 */
export function clearApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.NANOGPT_API_KEY)
  } catch {
    // Silently fail if localStorage is not available
  }
}

/**
 * Check if an API key is configured
 */
export function hasApiKey(): boolean {
  const key = getApiKey()
  return key !== null && key.length > 0
}

/**
 * Get the global default model preference
 * Falls back to DEFAULT_MODEL constant if not set
 */
export function getGlobalDefaultModel(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.DEFAULT_MODEL)
  } catch {
    return null
  }
}

/**
 * Set the global default model preference
 */
export function setGlobalDefaultModel(model: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DEFAULT_MODEL, model)
  } catch {
    // Silently fail if localStorage is not available
  }
}

/**
 * Mask an API key for display (show first 4 and last 4 chars)
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return '••••••••'
  }
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`
}
