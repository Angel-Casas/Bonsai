import { ref } from 'vue'

/**
 * Shared settings panel state.
 * Module-level ref so all components share the same open/close state.
 */
const isSettingsOpen = ref(false)

export function useSettingsPanel() {
  function openSettings() {
    isSettingsOpen.value = true
  }

  function closeSettings() {
    isSettingsOpen.value = false
  }

  function toggleSettings() {
    isSettingsOpen.value = !isSettingsOpen.value
  }

  return {
    isSettingsOpen,
    openSettings,
    closeSettings,
    toggleSettings,
  }
}
