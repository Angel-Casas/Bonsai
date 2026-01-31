<script setup lang="ts">
/**
 * Language Selector Dropdown
 *
 * Features:
 * - Shows current language with native name
 * - Dropdown with all supported languages
 * - Loading indicator during locale switch
 * - Preloads locale on hover for faster switching
 */

import { ref, onMounted, onUnmounted } from 'vue'
import { useLocaleStore } from '@/stores/localeStore'
import { useThemeStore } from '@/stores/themeStore'
import type { SupportedLocale } from '@/i18n/types'

const localeStore = useLocaleStore()
const themeStore = useThemeStore()

const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function closeDropdown() {
  isOpen.value = false
}

async function selectLocale(locale: SupportedLocale) {
  await localeStore.switchLocale(locale)
  closeDropdown()
}

function handlePreload(locale: SupportedLocale) {
  localeStore.preloadLocale(locale)
}

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div ref="dropdownRef" class="language-selector" :class="{ 'day-mode': themeStore.isDayMode }">
    <button
      class="language-trigger"
      :aria-expanded="isOpen"
      aria-label="Select language"
      @click="toggleDropdown"
    >
      <svg
        class="globe-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10" />
        <path
          d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
        />
      </svg>
      <span class="current-locale">{{ localeStore.currentLocaleConfig.nativeName }}</span>
      <svg
        class="chevron-icon"
        :class="{ rotated: isOpen }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>

      <div v-if="localeStore.isLoading" class="loading-overlay">
        <svg class="spinner" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-dasharray="32"
            stroke-linecap="round"
          />
        </svg>
      </div>
    </button>

    <Transition name="dropdown">
      <div v-if="isOpen" class="language-dropdown">
        <button
          v-for="locale in localeStore.supportedLocales"
          :key="locale.code"
          class="locale-option"
          :class="{ active: locale.code === localeStore.currentLocale }"
          @click="selectLocale(locale.code)"
          @mouseenter="handlePreload(locale.code)"
        >
          <span class="locale-native">{{ locale.nativeName }}</span>
          <span class="locale-english">{{ locale.name }}</span>
          <svg
            v-if="locale.code === localeStore.currentLocale"
            class="check-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.language-selector {
  position: relative;
  z-index: 1000;
  background-color: #0f172a;
  border-radius: 0.5rem;
  transition: background-color 0.4s ease;
}

.language-selector.day-mode {
  background-color: #fff8f0;
}

.language-trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(231, 210, 124, 0.4);
  background-color: #0f172a;
  color: #e7d27c;
  cursor: pointer;
  transition: all 0.4s ease;
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 0.875rem;
  position: relative;
}

.language-trigger:hover {
  background-color: #1e293b;
  border-color: #e7d27c;
}

.globe-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.current-locale {
  min-width: 3rem;
}

.chevron-icon {
  width: 16px;
  height: 16px;
  transition: transform 0.2s ease;
}

.chevron-icon.rotated {
  transform: rotate(180deg);
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #0f172a;
  border-radius: 0.5rem;
  transition: all 0.4s ease;
}

.spinner {
  width: 20px;
  height: 20px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.language-dropdown {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  min-width: 180px;
  background-color: #0f172a;
  border: 1px solid rgba(231, 210, 124, 0.3);
  border-radius: 0.5rem;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  transition: all 0.4s ease;
}

.locale-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem 1rem;
  border: none;
  background-color: transparent;
  color: #e2e8f0;
  cursor: pointer;
  text-align: left;
  transition: all 0.4s ease;
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
}

.locale-option:hover {
  background-color: #1e293b;
}

.locale-option.active {
  background-color: #1a2332;
}

.locale-native {
  font-weight: 500;
  flex: 1;
}

.locale-english {
  font-size: 0.75rem;
  color: rgba(226, 232, 240, 0.6);
  transition: color 0.4s ease;
}

.check-icon {
  width: 16px;
  height: 16px;
  color: #e7d27c;
  transition: color 0.4s ease;
}

/* Dropdown transition */
.dropdown-enter-active,
.dropdown-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Day mode styles */
.language-selector.day-mode .language-trigger {
  background-color: #fff8f0;
  border-color: #c4956a;
  color: #c4956a;
}

.language-selector.day-mode .language-trigger:hover {
  background-color: #f5e6d3;
  border-color: #c4956a;
}

.language-selector.day-mode .loading-overlay {
  background-color: #fff8f0;
}

.language-selector.day-mode .language-dropdown {
  background-color: #fff8f0;
  border-color: #c4956a;
}

.language-selector.day-mode .locale-option {
  color: #2d2a26;
}

.language-selector.day-mode .locale-option:hover {
  background-color: #f5e6d3;
}

.language-selector.day-mode .locale-option.active {
  background-color: #f9efe3;
}

.language-selector.day-mode .locale-english {
  color: rgba(45, 42, 38, 0.6);
}

.language-selector.day-mode .check-icon {
  color: #c4956a;
}

/* RTL support for page-level RTL (e.g., when Arabic is selected) */
[dir='rtl'] .language-trigger {
  flex-direction: row-reverse;
}
</style>
