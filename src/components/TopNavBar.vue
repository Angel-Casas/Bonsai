<script setup lang="ts">
/**
 * TopNavBar - Main Navigation Bar
 *
 * A full-width navigation bar containing:
 * - Logo (fractal tree icon + "Bonsai" text) on the left
 * - Language selector, theme toggle, and settings toggle on the right
 * - On mobile: hamburger menu with glass dropdown
 *
 * Props:
 * - showSettings: If true, shows the settings toggle button.
 * - showLogo: If true, shows the logo section.
 *
 * Used across all pages for consistent navigation.
 */

import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useThemeStore } from '@/stores/themeStore'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import LanguageSelector from '@/components/LanguageSelector.vue'

const isScrolled = ref(false)
const isMobileMenuOpen = ref(false)

function handleScroll() {
  isScrolled.value = window.scrollY > 10
}

function toggleMobileMenu() {
  isMobileMenuOpen.value = !isMobileMenuOpen.value
}

function closeMobileMenu() {
  isMobileMenuOpen.value = false
}

const props = withDefaults(defineProps<{
  showSettings?: boolean
  showLogo?: boolean
}>(), {
  showSettings: true,
  showLogo: true
})

const router = useRouter()
const themeStore = useThemeStore()
const { isSettingsOpen, toggleSettings } = useSettingsPanel()

function goHome() {
  router.push({ name: 'home' })
}

onMounted(() => {
  themeStore.init()
  window.addEventListener('scroll', handleScroll)
  handleScroll() // Check initial scroll position
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <nav class="top-navbar" :class="{ 'day-mode': themeStore.isDayMode, 'scrolled': isScrolled }" data-testid="app-header">
    <!-- Logo Section -->
    <div v-if="props.showLogo" class="navbar-left">
      <button class="logo-btn" title="Go to home" data-testid="logo-btn" @click="goHome">
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

    <!-- Desktop Controls Section -->
    <div class="navbar-right desktop-controls">
      <LanguageSelector />
      <button
        class="theme-toggle"
        data-testid="theme-toggle"
        :class="{ 'is-day': themeStore.isDayMode, transitioning: themeStore.isTransitioning }"
        :title="themeStore.isDayMode ? 'Switch to night mode' : 'Switch to day mode'"
        @click="themeStore.toggle"
      >
        <!-- Horizontal track line -->
        <span class="toggle-track" :class="{ glow: themeStore.isTransitioning }"></span>
        <!-- Sliding knob with current icon -->
        <span class="toggle-knob">
          <!-- Sun icon (day mode) -->
          <svg v-if="themeStore.isDayMode" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
          <!-- Moon icon (night mode) -->
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </span>
      </button>
      <!-- Settings toggle button -->
      <button
        v-if="props.showSettings"
        class="settings-toggle"
        :class="{ active: isSettingsOpen }"
        :title="isSettingsOpen ? 'Exit settings' : 'Open settings'"
        data-testid="settings-btn"
        @click="toggleSettings"
      >
        <!-- Settings gear icon -->
        <svg v-if="!isSettingsOpen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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

    <!-- Mobile Menu Button -->
    <button
      class="mobile-menu-btn"
      :class="{ active: isMobileMenuOpen }"
      title="Menu"
      data-testid="mobile-menu-btn"
      @click="toggleMobileMenu"
    >
      <!-- Hamburger icon -->
      <svg v-if="!isMobileMenuOpen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
      <!-- Close icon -->
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>

    <!-- Mobile Menu Dropdown -->
    <Transition name="menu-slide">
      <div v-if="isMobileMenuOpen" class="mobile-menu-dropdown">
        <div class="mobile-menu-content">
          <!-- Language Selector -->
          <div class="mobile-menu-item">
            <span class="mobile-menu-label">Language</span>
            <LanguageSelector @change="closeMobileMenu" />
          </div>

          <!-- Theme Toggle -->
          <button
            class="mobile-menu-item mobile-menu-btn-item"
            data-testid="mobile-theme-btn"
            @click="themeStore.toggle(); closeMobileMenu()"
          >
            <span class="mobile-menu-label">Theme</span>
            <div class="mobile-menu-icon">
              <svg v-if="themeStore.isDayMode" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
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
              <span class="mobile-menu-value">{{ themeStore.isDayMode ? 'Day' : 'Night' }}</span>
            </div>
          </button>

          <!-- Settings -->
          <button
            v-if="props.showSettings"
            class="mobile-menu-item mobile-menu-btn-item"
            data-testid="mobile-settings-btn"
            @click="toggleSettings(); closeMobileMenu()"
          >
            <span class="mobile-menu-label">{{ isSettingsOpen ? 'Exit Settings' : 'Settings' }}</span>
            <div class="mobile-menu-icon">
              <svg v-if="!isSettingsOpen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
          </button>
        </div>
      </div>
    </Transition>

    <!-- Backdrop for mobile menu -->
    <Transition name="fade">
      <div
        v-if="isMobileMenuOpen"
        class="mobile-menu-backdrop"
        @click="closeMobileMenu"
      />
    </Transition>
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
  background: transparent;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--glass-border);
  z-index: 1000;
  transition: background 0.4s ease, border-color 0.4s ease;
  overflow: visible;
}

.day-mode.top-navbar {
  background: rgba(255, 255, 255, 0.75);
}

.top-navbar.scrolled {
  background: transparent;
  border-bottom-color: transparent;
}

.day-mode.top-navbar.scrolled {
  background: rgba(255, 255, 255, 0.75);
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
  background: var(--btn-ghost-hover);
}

.logo-icon {
  width: 28px;
  height: 28px;
  color: var(--accent);
  transition: color 0.4s ease;
}

.logo-text {
  font-family: var(--font-sans);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--accent);
  transition: color 0.4s ease;
}

/* Controls Section */
.navbar-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.theme-toggle {
  width: 72px;
  height: 42px;
  border-radius: 21px;
  border: 1px solid var(--btn-ghost-border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  transition: border-color 0.4s ease, transform 0.3s ease;
  position: relative;
}

.theme-toggle:hover {
  border-color: var(--accent);
  transform: scale(1.05);
}

/* Horizontal track line through the center */
.toggle-track {
  position: absolute;
  top: 50%;
  left: 6px;
  right: 6px;
  height: 2px;
  background: var(--border-subtle);
  transform: translateY(-50%);
  border-radius: 1px;
  z-index: 0;
  /* Slow fade-out when .glow is removed */
  transition: background 1s ease, box-shadow 1s ease, height 0.4s ease;
}

.toggle-track.glow {
  height: 3px;
  background: var(--accent);
  box-shadow:
    0 0 8px 2px rgba(var(--accent-rgb), 1),
    0 0 20px 4px rgba(var(--accent-rgb), 0.8),
    0 0 40px 8px rgba(var(--accent-rgb), 0.4);
  /* Fast light-up when .glow is added */
  transition: background 0.15s ease, box-shadow 0.15s ease, height 0.15s ease;
}

/* Sliding knob */
.toggle-knob {
  position: absolute;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--accent);
  top: 50%;
  left: 4px;
  transform: translateY(-50%);
  transition: left 0.45s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--bg-primary);
}

.theme-toggle:not(.is-day) .toggle-knob {
  left: calc(100% - 38px);
}

.toggle-knob svg {
  width: 18px;
  height: 18px;
}

.theme-toggle.transitioning .toggle-knob svg {
  animation: iconSpin 0.5s ease;
}

@keyframes iconSpin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}


/* Settings toggle button */
.settings-toggle {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid var(--btn-ghost-border);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.4s ease, border-color 0.4s ease, color 0.4s ease, transform 0.3s ease;
}

.settings-toggle:hover {
  background: var(--btn-ghost-hover);
  border-color: var(--accent);
  transform: scale(1.08);
}

.settings-toggle.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
}

.settings-toggle.active:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: var(--bg-primary);
  transform: scale(1.08);
}

.settings-toggle svg {
  width: 20px;
  height: 20px;
}

.day-mode .logo-btn:hover {
  background: var(--bg-card);
}

/* Mobile Menu Button - hidden on desktop */
.mobile-menu-btn {
  display: none;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid var(--btn-ghost-border);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  align-items: center;
  justify-content: center;
  transition: background 0.3s ease, border-color 0.3s ease, transform 0.3s ease;
}

.mobile-menu-btn:hover {
  background: var(--btn-ghost-hover);
  border-color: var(--accent);
}

.mobile-menu-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
}

.mobile-menu-btn svg {
  width: 20px;
  height: 20px;
}

/* Mobile Menu Dropdown */
.mobile-menu-dropdown {
  position: absolute;
  top: 100%;
  right: 1rem;
  min-width: 220px;
  margin-top: 0.5rem;
  background: var(--bg-card);
  backdrop-filter: blur(20px);
  border: 1px solid var(--accent);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  z-index: 1001;
  overflow: visible;
}

/* Language selector in mobile menu */
.mobile-menu-dropdown .mobile-menu-item :deep(.language-selector) {
  flex: 1;
}

.mobile-menu-dropdown .mobile-menu-item :deep(.language-trigger) {
  width: 100%;
  justify-content: flex-end;
  border: none;
  padding: 0;
  background: transparent;
}

.mobile-menu-dropdown .mobile-menu-item :deep(.language-trigger:hover) {
  background: transparent;
}

.mobile-menu-dropdown .mobile-menu-item :deep(.language-dropdown) {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 0.25rem;
  border-radius: 8px;
  z-index: 1100;
}

.mobile-menu-content {
  padding: 0.5rem;
  overflow: visible;
}

.mobile-menu-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  transition: background 0.2s ease;
  overflow: visible;
}

.mobile-menu-btn-item {
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--font-sans);
  text-align: left;
}

.mobile-menu-btn-item:hover {
  background: var(--btn-ghost-hover);
}

.mobile-menu-label {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
}

.mobile-menu-icon {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--accent);
}

.mobile-menu-icon svg {
  width: 20px;
  height: 20px;
}

.mobile-menu-value {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* Mobile Menu Backdrop */
.mobile-menu-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  z-index: 999;
}

/* Menu slide transition */
.menu-slide-enter-active,
.menu-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.menu-slide-enter-from,
.menu-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* Fade transition for backdrop */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Day mode adjustments for mobile menu */

.day-mode .mobile-menu-dropdown {
  background: rgba(255, 255, 255, 0.95);
  border-color: var(--border-color);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.day-mode .mobile-menu-backdrop {
  background: rgba(0, 0, 0, 0.2);
}

/* Responsive: Show mobile menu on small screens */
@media (max-width: 640px) {
  .desktop-controls {
    display: none;
  }

  .mobile-menu-btn {
    display: flex;
  }

  .mobile-menu-dropdown {
    right: 1rem;
    left: 1rem;
    min-width: auto;
  }
}
</style>
