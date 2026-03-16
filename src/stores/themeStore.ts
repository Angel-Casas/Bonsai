import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Day mode palettes - pastel colors with 2 distinct colors each
export type DayPalette = 'cream-sage' | 'blush-coral' | 'lavender-plum' | 'mint-teal' | 'peach-terracotta' | 'classic-day' | 'blueprint-day'

// Night mode palettes - dark themes with 2 distinct colors each
export type NightPalette = 'charcoal-rose' | 'navy-seafoam' | 'slate-amber' | 'classic-night' | 'midnight-violet' | 'forest-copper' | 'blueprint-night'

export interface PaletteInfo {
  id: string
  name: string
  primary: string // Background color for preview
  accent: string  // Accent color for preview
}

export const DAY_PALETTES: PaletteInfo[] = [
  { id: 'classic-day', name: 'Classic', primary: '#fff8f0', accent: '#5eead4' },
  { id: 'cream-sage', name: 'Sky & Honey', primary: '#F8FAFF', accent: '#D4A855' },
  { id: 'blush-coral', name: 'Blush & Coral', primary: '#FFF0F3', accent: '#E8A0A0' },
  { id: 'lavender-plum', name: 'Lavender & Plum', primary: '#F5F0FF', accent: '#B8A0D0' },
  { id: 'mint-teal', name: 'Mint & Lavender', primary: '#F8FAF8', accent: '#60A088' },
  { id: 'peach-terracotta', name: 'Coral & Honey', primary: '#FFF8F2', accent: '#C08060' },
  { id: 'blueprint-day', name: 'Lite', primary: '#FFFFFF', accent: '#0227f6' },
]

export const NIGHT_PALETTES: PaletteInfo[] = [
  { id: 'classic-night', name: 'Classic', primary: '#0f172a', accent: '#E7D27C' },
  { id: 'charcoal-rose', name: 'Charcoal & Rose', primary: '#1a1a20', accent: '#D4A0B0' },
  { id: 'navy-seafoam', name: 'Navy & Seafoam', primary: '#0d1520', accent: '#88C0B0' },
  { id: 'slate-amber', name: 'Slate & Amber', primary: '#1e1e24', accent: '#D4B070' },
  { id: 'midnight-violet', name: 'Midnight & Violet', primary: '#12101a', accent: '#A890C8' },
  { id: 'forest-copper', name: 'Forest & Copper', primary: '#101814', accent: '#C89870' },
  { id: 'blueprint-night', name: 'Lite', primary: '#000000', accent: '#E7D27C' },
]

export const useThemeStore = defineStore('theme', () => {
  const isDayMode = ref(false)
  const isTransitioning = ref(false)
  const dayPalette = ref<DayPalette>('blueprint-day')
  const nightPalette = ref<NightPalette>('blueprint-night')

  const currentPalette = computed(() => {
    return isDayMode.value ? dayPalette.value : nightPalette.value
  })

  const isBlueprint = computed(() => {
    const palette = isDayMode.value ? dayPalette.value : nightPalette.value
    return palette === 'blueprint-day' || palette === 'blueprint-night'
  })

  function applyPaletteClass() {
    // Remove all palette classes
    const allPalettes = [...DAY_PALETTES, ...NIGHT_PALETTES].map(p => `palette-${p.id}`)
    document.documentElement.classList.remove(...allPalettes)

    // Apply current palette class
    const palette = isDayMode.value ? dayPalette.value : nightPalette.value
    document.documentElement.classList.add(`palette-${palette}`)
  }

  function init() {
    // Load theme preference
    const saved = localStorage.getItem('bonsai-theme')
    if (saved === 'day') {
      isDayMode.value = true
      document.documentElement.classList.add('day-mode')
    } else {
      document.documentElement.classList.remove('day-mode')
    }

    // Load palette preferences
    const savedDayPalette = localStorage.getItem('bonsai-day-palette') as DayPalette | null
    if (savedDayPalette && DAY_PALETTES.some(p => p.id === savedDayPalette)) {
      dayPalette.value = savedDayPalette
    }

    const savedNightPalette = localStorage.getItem('bonsai-night-palette') as NightPalette | null
    if (savedNightPalette && NIGHT_PALETTES.some(p => p.id === savedNightPalette)) {
      nightPalette.value = savedNightPalette
    }

    applyPaletteClass()
  }

  let transitionTimer: ReturnType<typeof setTimeout> | null = null

  function toggle() {
    // Clear any pending timer so rapid toggles don't cut the glow short
    if (transitionTimer) {
      clearTimeout(transitionTimer)
      transitionTimer = null
    }

    isTransitioning.value = true
    isDayMode.value = !isDayMode.value
    localStorage.setItem('bonsai-theme', isDayMode.value ? 'day' : 'night')

    // Apply class to document root for global background
    if (isDayMode.value) {
      document.documentElement.classList.add('day-mode')
    } else {
      document.documentElement.classList.remove('day-mode')
    }

    applyPaletteClass()

    // Keep glow class on for 1.3s, then CSS transition handles the fade-out
    transitionTimer = setTimeout(() => {
      isTransitioning.value = false
      transitionTimer = null
    }, 1300)
  }

  function setDayMode(value: boolean) {
    isDayMode.value = value
    localStorage.setItem('bonsai-theme', value ? 'day' : 'night')

    if (value) {
      document.documentElement.classList.add('day-mode')
    } else {
      document.documentElement.classList.remove('day-mode')
    }

    applyPaletteClass()
  }

  function setDayPalette(palette: DayPalette) {
    dayPalette.value = palette
    localStorage.setItem('bonsai-day-palette', palette)
    if (isDayMode.value) {
      applyPaletteClass()
    }
  }

  function setNightPalette(palette: NightPalette) {
    nightPalette.value = palette
    localStorage.setItem('bonsai-night-palette', palette)
    if (!isDayMode.value) {
      applyPaletteClass()
    }
  }

  return {
    isDayMode,
    isTransitioning,
    dayPalette,
    nightPalette,
    currentPalette,
    isBlueprint,
    init,
    toggle,
    setDayMode,
    setDayPalette,
    setNightPalette,
  }
})
