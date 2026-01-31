import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useThemeStore = defineStore('theme', () => {
  const isDayMode = ref(false)
  const isTransitioning = ref(false)

  function init() {
    const saved = localStorage.getItem('bonsai-theme')
    if (saved === 'day') {
      isDayMode.value = true
      document.documentElement.classList.add('day-mode')
    } else {
      document.documentElement.classList.remove('day-mode')
    }
  }

  function toggle() {
    isTransitioning.value = true
    isDayMode.value = !isDayMode.value
    localStorage.setItem('bonsai-theme', isDayMode.value ? 'day' : 'night')

    // Apply class to document root for global background
    if (isDayMode.value) {
      document.documentElement.classList.add('day-mode')
    } else {
      document.documentElement.classList.remove('day-mode')
    }

    // End transition after animation completes
    setTimeout(() => {
      isTransitioning.value = false
    }, 400)
  }

  function setDayMode(value: boolean) {
    isDayMode.value = value
    localStorage.setItem('bonsai-theme', value ? 'day' : 'night')

    if (value) {
      document.documentElement.classList.add('day-mode')
    } else {
      document.documentElement.classList.remove('day-mode')
    }
  }

  return {
    isDayMode,
    isTransitioning,
    init,
    toggle,
    setDayMode
  }
})
