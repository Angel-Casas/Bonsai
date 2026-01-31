/**
 * i18n Configuration
 *
 * Sets up vue-i18n with:
 * - English as default (bundled)
 * - Lazy loading for other locales
 * - localStorage persistence
 */

import { createI18n } from 'vue-i18n'
import type { SupportedLocale } from './types'
import en from './locales/en.json'

// Create i18n instance with English as default
export const i18n = createI18n({
  legacy: false, // Use Composition API
  locale: getStoredLocale(),
  fallbackLocale: 'en',
  messages: {
    en,
  },
})

/**
 * Get stored locale from localStorage, or return default
 */
function getStoredLocale(): SupportedLocale {
  if (typeof window === 'undefined') return 'en'
  const stored = localStorage.getItem('bonsai-locale')
  if (stored && ['en', 'zh', 'hi', 'es', 'ar', 'bn', 'pt', 'ru', 'ja', 'fr'].includes(stored)) {
    return stored as SupportedLocale
  }
  return 'en'
}

/**
 * Lazy load a locale's messages
 * Returns true if loaded successfully
 */
export async function loadLocaleMessages(locale: SupportedLocale): Promise<boolean> {
  // English is already loaded
  if (locale === 'en') {
    return true
  }

  // Check if already loaded
  if ((i18n.global.availableLocales as string[]).includes(locale)) {
    return true
  }

  try {
    // Dynamic import for lazy loading
    const messages = await import(`./locales/${locale}.json`)
    i18n.global.setLocaleMessage(locale as 'en', messages.default)
    return true
  } catch (error) {
    console.error(`Failed to load locale: ${locale}`, error)
    return false
  }
}

/**
 * Set the active locale with lazy loading
 */
export async function setLocale(locale: SupportedLocale): Promise<void> {
  const loaded = await loadLocaleMessages(locale)
  if (loaded) {
    // @ts-expect-error - vue-i18n typing issue with locale assignment
    i18n.global.locale.value = locale
    localStorage.setItem('bonsai-locale', locale)

    // Update document direction for RTL languages
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = locale
  }
}

/**
 * Initialize locale on app startup
 * Loads the stored locale's messages if not English
 */
export async function initLocale(): Promise<void> {
  const storedLocale = getStoredLocale()
  if (storedLocale !== 'en') {
    await loadLocaleMessages(storedLocale)
    // Update document direction for RTL languages
    document.documentElement.dir = storedLocale === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = storedLocale
  }
}

export default i18n
