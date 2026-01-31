<script setup lang="ts">
/**
 * TopNavBar - Main Navigation Bar
 *
 * A full-width navigation bar containing:
 * - Logo (fractal tree icon + "Bonsai" text) on the left
 * - Language selector, theme toggle, and settings toggle on the right
 *
 * Props:
 * - showSettings: If true, shows the settings toggle button.
 * - showLogo: If true, shows the logo section.
 *
 * Used across all pages for consistent navigation.
 */

import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useThemeStore } from '@/stores/themeStore'
import LanguageSelector from '@/components/LanguageSelector.vue'

const props = withDefaults(defineProps<{
  showSettings?: boolean
  showLogo?: boolean
}>(), {
  showSettings: true,
  showLogo: true
})

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()

const isOnSettingsPage = computed(() => route.name === 'settings' || route.path === '/settings')

function toggleSettings() {
  if (isOnSettingsPage.value) {
    router.push({ name: 'home' })
  } else {
    router.push({ name: 'settings' })
  }
}

function goHome() {
  router.push({ name: 'home' })
}

onMounted(() => {
  themeStore.init()
})
</script>

<template>
  <nav class="top-navbar" :class="{ 'day-mode': themeStore.isDayMode }" data-testid="app-header">
    <!-- Logo Section -->
    <div v-if="props.showLogo" class="navbar-left">
      <button class="logo-btn" @click="goHome" title="Go to home">
        <!-- Fractal Tree SVG Icon -->
        <svg class="logo-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5">
          <!-- Main trunk -->
          <line x1="16" y1="30" x2="16" y2="18" />
          <!-- Main branches -->
          <line x1="16" y1="18" x2="10" y2="12" />
          <line x1="16" y1="18" x2="22" y2="12" />
          <!-- Secondary branches left -->
          <line x1="10" y1="12" x2="6" y2="8" />
          <line x1="10" y1="12" x2="12" y2="6" />
          <!-- Secondary branches right -->
          <line x1="22" y1="12" x2="20" y2="6" />
          <line x1="22" y1="12" x2="26" y2="8" />
          <!-- Tertiary branches -->
          <line x1="6" y1="8" x2="4" y2="5" />
          <line x1="6" y1="8" x2="8" y2="4" />
          <line x1="26" y1="8" x2="24" y2="4" />
          <line x1="26" y1="8" x2="28" y2="5" />
        </svg>
        <span class="logo-text">Bonsai</span>
      </button>
    </div>

    <!-- Controls Section -->
    <div class="navbar-right">
      <LanguageSelector />
      <button
        class="theme-toggle"
        :class="{ transitioning: themeStore.isTransitioning }"
        :title="themeStore.isDayMode ? 'Switch to night mode' : 'Switch to day mode'"
        @click="themeStore.toggle"
      >
        <!-- Moon icon for day mode (click to switch to night) -->
        <svg v-if="themeStore.isDayMode" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        <!-- Sun icon for night mode (click to switch to day) -->
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      </button>
      <!-- Settings toggle button -->
      <button
        v-if="props.showSettings"
        class="settings-toggle"
        :class="{ active: isOnSettingsPage }"
        :title="isOnSettingsPage ? 'Exit settings' : 'Open settings'"
        data-testid="settings-btn"
        @click="toggleSettings"
      >
        <!-- Settings gear icon -->
        <svg v-if="!isOnSettingsPage" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <!-- X/Close icon when on settings page -->
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.top-navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1rem;
  background: #0f172a;
  border-bottom: 1px solid rgba(231, 210, 124, 0.2);
  z-index: 1000;
  transition: background 0.4s ease, border-color 0.4s ease;
}

/* Logo Section */
.navbar-left {
  display: flex;
  align-items: center;
}

.logo-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 0.5rem;
  transition: all 0.3s ease;
}

.logo-btn:hover {
  background: #1a2332;
}

.logo-icon {
  width: 28px;
  height: 28px;
  color: #e7d27c;
  transition: color 0.4s ease;
}

.logo-text {
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 1.25rem;
  font-weight: 600;
  color: #e7d27c;
  transition: color 0.4s ease;
}

/* Controls Section */
.navbar-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.theme-toggle {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid rgba(231, 210, 124, 0.4);
  background: #0f172a;
  color: #e7d27c;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.4s ease, border-color 0.4s ease, color 0.4s ease, transform 0.3s ease;
}

.theme-toggle:hover {
  background: #1e293b;
  border-color: #e7d27c;
  transform: scale(1.08);
}

.theme-toggle svg {
  width: 20px;
  height: 20px;
  transition: transform 0.4s ease;
}

/* Icon spin during transition */
.theme-toggle.transitioning svg {
  animation: iconSpin 0.5s ease;
}

@keyframes iconSpin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* Settings toggle button */
.settings-toggle {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid rgba(231, 210, 124, 0.4);
  background: #0f172a;
  color: #e7d27c;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.4s ease, border-color 0.4s ease, color 0.4s ease, transform 0.3s ease;
}

.settings-toggle:hover {
  background: #1e293b;
  border-color: #e7d27c;
  transform: scale(1.08);
}

.settings-toggle.active {
  background: #e7d27c;
  border-color: #e7d27c;
  color: #0f172a;
}

.settings-toggle.active:hover {
  background: #f0dc8a;
  border-color: #f0dc8a;
  color: #0f172a;
  transform: scale(1.08);
}

.settings-toggle svg {
  width: 20px;
  height: 20px;
}

/* ============================================ */
/* Day mode styles */
/* ============================================ */
.top-navbar.day-mode {
  background: #fff8f0;
  border-bottom-color: rgba(196, 149, 106, 0.3);
}

.top-navbar.day-mode .logo-icon {
  color: #c4956a;
}

.top-navbar.day-mode .logo-text {
  color: #c4956a;
}

.top-navbar.day-mode .logo-btn:hover {
  background: #f5e6d3;
}

.top-navbar.day-mode .theme-toggle {
  background: #fff8f0;
  border-color: #c4956a;
  color: #c4956a;
}

.top-navbar.day-mode .theme-toggle:hover {
  background: #c4956a;
  color: #fff8f0;
}

.top-navbar.day-mode .settings-toggle {
  background: #fff8f0;
  border-color: #c4956a;
  color: #c4956a;
}

.top-navbar.day-mode .settings-toggle:hover {
  background: #c4956a;
  color: #fff8f0;
}

.top-navbar.day-mode .settings-toggle.active {
  background: #c4956a;
  border-color: #c4956a;
  color: #fff8f0;
}

.top-navbar.day-mode .settings-toggle.active:hover {
  background: #b8865c;
  border-color: #b8865c;
  color: #fff8f0;
}
</style>
