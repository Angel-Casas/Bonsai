/**
 * Locale Store - Reactive state for i18n
 *
 * Manages:
 * - Current locale state
 * - Loading state during locale switches
 * - Locale switching with lazy loading
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { setLocale, loadLocaleMessages, i18n } from '@/i18n'
import { SUPPORTED_LOCALES, type SupportedLocale, type LocaleConfig } from '@/i18n/types'

export const useLocaleStore = defineStore('locale', () => {
  // State
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  // Computed
  const currentLocale = computed(() => i18n.global.locale.value as SupportedLocale)

  const currentLocaleConfig = computed((): LocaleConfig => {
    return SUPPORTED_LOCALES.find((l) => l.code === currentLocale.value) ?? SUPPORTED_LOCALES[0]!
  })

  const isRTL = computed(() => currentLocaleConfig.value.direction === 'rtl')

  /**
   * Switch to a new locale
   */
  async function switchLocale(locale: SupportedLocale): Promise<boolean> {
    if (locale === currentLocale.value) {
      return true
    }

    isLoading.value = true
    loadError.value = null

    try {
      await setLocale(locale)
      return true
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : 'Failed to load language'
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Preload a locale without switching
   * Useful for hover preloading
   */
  async function preloadLocale(locale: SupportedLocale): Promise<void> {
    if (locale !== 'en') {
      await loadLocaleMessages(locale)
    }
  }

  /**
   * Initialize locale from localStorage on app start
   */
  async function initializeLocale(): Promise<void> {
    const stored = localStorage.getItem('bonsai-locale') as SupportedLocale | null
    if (stored && stored !== 'en') {
      await switchLocale(stored)
    }
  }

  return {
    // State
    isLoading,
    loadError,

    // Computed
    currentLocale,
    currentLocaleConfig,
    isRTL,
    supportedLocales: SUPPORTED_LOCALES,

    // Actions
    switchLocale,
    preloadLocale,
    initializeLocale,
  }
})
