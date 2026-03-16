<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Motion } from 'motion-v'
import TopNavBar from '@/components/TopNavBar.vue'
import { useThemeStore } from '@/stores/themeStore'
import { useSmoothScroll } from '@/composables/useSmoothScroll'

// Parallax layer images
import stampDayImg from '@/assets/bonsai-stamp-day.png'
import stampNightImg from '@/assets/bonsai-stamp-night.png'

// Letter images for BONSAI title
import BDay from '@/assets/B-day.png'
import ODay from '@/assets/O-day.png'
import NDay from '@/assets/N-day.png'
import SDay from '@/assets/S-day.png'
import ADay from '@/assets/A-day.png'
import IDay from '@/assets/I-day.png'
import BNight from '@/assets/B-night.png'
import ONight from '@/assets/O-night.png'
import NNight from '@/assets/N-night.png'
import SNight from '@/assets/S-night.png'
import ANight from '@/assets/A-night.png'
import INight from '@/assets/I-night.png'
import bg1 from '@/assets/parallax/bg-1.png'
import bg2 from '@/assets/parallax/bg-2.png'
import bg3 from '@/assets/parallax/bg-3.png'
import bg4 from '@/assets/parallax/bg-4.png'
import bg5 from '@/assets/parallax/bg-5.png'
import bg6 from '@/assets/parallax/bg-6.png'

import bg1Night from '@/assets/parallax/bg-1-night.png'
import bg2Night from '@/assets/parallax/bg-2-night.png'
import bg3Night from '@/assets/parallax/bg-3-night.png'
import bg4Night from '@/assets/parallax/bg-4-night.png'
import bg5Night from '@/assets/parallax/bg-5-night.png'
import bg6Night from '@/assets/parallax/bg-6-night.png'

const router = useRouter()
const { t, tm } = useI18n()
const themeStore = useThemeStore()

// =============================================================================
// PARALLAX BACKGROUND
// =============================================================================
const dayImages = [bg1, bg2, bg3, bg4, bg5, bg6]
const nightImages = [bg1Night, bg2Night, bg3Night, bg4Night, bg5Night, bg6Night]
const parallaxImages = computed(() => themeStore.isDayMode ? dayImages : nightImages)
const stampImage = computed(() => themeStore.isDayMode ? stampDayImg : stampNightImg)

const titleLetters = computed(() => {
  const day = [BDay, ODay, NDay, SDay, ADay, IDay]
  const night = [BNight, ONight, NNight, SNight, ANight, INight]
  const srcs = themeStore.isDayMode ? day : night
  return srcs.map((src, i) => ({ src, alt: 'BONSAI'[i] }))
})

const parallaxProgress = ref(0)
let parallaxRafId: number | null = null

const parallaxLayers = [
  { baseScale: 1.0, speed: 0.40 },  // bg-1 — furthest (slight overscale to mask edge bleed)
  { baseScale: 1.0, speed: 0.80 },  // bg-2
  { baseScale: 1.0, speed: 1.30 },  // bg-3
  { baseScale: 1.0, speed: 1.70 },  // bg-4
  { baseScale: 1.0, speed: 2.40 },  // bg-5
  { baseScale: 1.07, speed: 0 },  // bg-6 — closest
] as const

function getParallaxScale(index: number): number {
  const { baseScale, speed } = parallaxLayers[index]!
  return baseScale + parallaxProgress.value * speed
}

function updateParallaxProgress() {
  if (parallaxRafId !== null) return
  parallaxRafId = requestAnimationFrame(() => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    parallaxProgress.value = maxScroll > 0 ? Math.min(window.scrollY / maxScroll, 1) : 0
    updateHeroProgress()
    parallaxRafId = null
  })
}

// =============================================================================
// HERO SCROLL-DRIVEN ANIMATION
// =============================================================================
const heroProgress = ref(0)
const HERO_SCROLL_RANGE = 2.5
// Capture initial viewport height to avoid jitter from mobile browser chrome hiding/showing
let stableViewportHeight = 0

// Mobile auto-scroll: one touch gesture auto-scrolls through the hero section
let heroAutoScrollRafId: number | null = null
let heroAutoDirection = 0 // 1 = forward, -1 = backward, 0 = stopped
let heroTouchStartY = 0
let heroTouchActive = false
const HERO_AUTO_SCROLL_SPEED = 32 // pixels per frame (~480px/s at 60fps)
const HERO_AUTO_STOP_PROGRESS = 0.55 // stop when all visible animations are done

function getHeroEnd(): number {
  const vh = stableViewportHeight || window.innerHeight
  return vh * HERO_SCROLL_RANGE
}

function updateHeroProgress() {
  const vh = stableViewportHeight || window.innerHeight
  const heroEnd = vh * HERO_SCROLL_RANGE
  heroProgress.value = heroEnd > 0 ? Math.min(window.scrollY / heroEnd, 1) : 0
}

function heroAutoScrollLoop() {
  if (heroAutoDirection === 0) {
    heroAutoScrollRafId = null
    return
  }
  const heroEnd = getHeroEnd()
  const stopScroll = heroEnd * HERO_AUTO_STOP_PROGRESS
  const newScroll = window.scrollY + heroAutoDirection * HERO_AUTO_SCROLL_SPEED

  if (heroAutoDirection > 0 && newScroll >= stopScroll) {
    window.scrollTo(0, stopScroll)
    heroAutoDirection = 0
    heroAutoScrollRafId = null
    return
  }
  if (heroAutoDirection < 0 && newScroll <= 0) {
    window.scrollTo(0, 0)
    heroAutoDirection = 0
    heroAutoScrollRafId = null
    return
  }

  window.scrollTo(0, newScroll)
  heroAutoScrollRafId = requestAnimationFrame(heroAutoScrollLoop)
}

function startHeroAutoScroll(direction: number) {
  heroAutoDirection = direction
  if (heroAutoScrollRafId === null) {
    heroAutoScrollRafId = requestAnimationFrame(heroAutoScrollLoop)
  }
}

function onHeroTouchStart(e: TouchEvent) {
  if (!e.touches[0]) return
  heroTouchStartY = e.touches[0].clientY
  heroTouchActive = true
  // Pause auto-scroll while touching
  heroAutoDirection = 0
}

function onHeroTouchMove(e: TouchEvent) {
  if (!heroTouchActive || !e.touches[0]) return
  const stopScroll = getHeroEnd() * HERO_AUTO_STOP_PROGRESS
  // Only intercept within hero auto-scroll range; let native scroll handle the rest
  if (window.scrollY >= stopScroll) return

  const touchY = e.touches[0].clientY
  const delta = heroTouchStartY - touchY // positive = scrolling down

  if (Math.abs(delta) > 8) {
    e.preventDefault()
    const direction = delta > 0 ? 1 : -1
    startHeroAutoScroll(direction)
    heroTouchStartY = touchY
  }
}

function onHeroTouchEnd() {
  heroTouchActive = false
  // Auto-scroll continues in current direction (momentum)
}

const descriptionOpacity = computed(() => {
  if (heroProgress.value < 0.1) return 0
  if (heroProgress.value > 0.35) return 1
  return (heroProgress.value - 0.1) / 0.25
})

const descriptionTranslateY = computed(() => {
  if (heroProgress.value < 0.1) return 40
  if (heroProgress.value > 0.35) return 0
  return 40 * (1 - (heroProgress.value - 0.1) / 0.25)
})

// Tile-flip reveal for frame image
const TILE_COLS = 6
const TILE_ROWS = 6
const TILE_COUNT = TILE_COLS * TILE_ROWS
// Compute each tile's normalized threshold (0-1) — center-outward ripple
function getTileThreshold(index: number): number {
  const col = index % TILE_COLS
  const row = Math.floor(index / TILE_COLS)
  const cx = (TILE_COLS - 1) / 2
  const cy = (TILE_ROWS - 1) / 2
  const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2)
  const maxDist = Math.sqrt(cx ** 2 + cy ** 2)
  return dist / maxDist
}

// Map heroProgress (0.05–0.30) to tile flip states
function isTileFlipped(index: number): boolean {
  const start = 0.05
  const end = 0.30
  const progress = (heroProgress.value - start) / (end - start)
  return progress > getTileThreshold(index)
}

// Scroll-driven staggered letter reveal (heroProgress 0.12–0.38)
function getLetterStyle(index: number): Record<string, string> {
  const LETTER_START = 0.12
  const LETTER_END = 0.38
  const LETTER_COUNT = 6
  // Each letter gets an equal slice of the range, staggered
  const sliceDuration = (LETTER_END - LETTER_START) / (LETTER_COUNT + 1)
  const letterStart = LETTER_START + index * sliceDuration
  const letterEnd = letterStart + sliceDuration * 2 // overlap for smoothness
  const p = heroProgress.value
  const t = Math.min(Math.max((p - letterStart) / (letterEnd - letterStart), 0), 1)
  // Ease-out cubic
  const eased = 1 - Math.pow(1 - t, 3)
  const opacity = eased
  const translateY = (1 - eased) * 30
  const scale = 0.7 + eased * 0.3
  return {
    opacity: String(opacity),
    transform: `translateY(${translateY}px) scale(${scale})`,
  }
}


const trustTagsOpacity = computed(() => {
  if (heroProgress.value < 0.35) return 0
  if (heroProgress.value > 0.5) return 1
  return (heroProgress.value - 0.35) / 0.15
})

const heroSectionDone = computed(() => heroProgress.value >= 1)

// Scroll indicator drifts from center-right to bottom-right on mobile as user scrolls
const isMobile = ref(false)
const scrollIndicatorStyle = computed(() => {
  if (!isMobile.value) return {}
  const p = Math.min(Math.max(heroProgress.value / 0.3, 0), 1)
  const eased = p * p // ease-in for smooth start
  // Interpolate from 50svh to 82svh
  const topPercent = 50 + eased * 32
  return {
    top: `${topPercent}svh`,
    transform: `translateY(-${50 - eased * 50}%)`,
  }
})

const activeFaqIndex = ref<number | null>(null)
const vizStep = ref(0)
const hasScrolled = ref(false)
const isAnimating = ref(false)

// Scroll hijack state machine
const ScrollState = { FREE: 0, LOCKING: 1, LOCKED: 2, RELEASING: 3 } as const
type ScrollStateType = (typeof ScrollState)[keyof typeof ScrollState]
const branchingSectionRef = ref<HTMLElement | null>(null)
let scrollState: ScrollStateType = ScrollState.FREE
const sectionCentered = ref(false)

// Step transition timing
let accumulatedDelta = 0
const STEP_THRESHOLD = 100
const STEP_COOLDOWN_MS = 400
let lastStepChangeTime = 0

// Release cooldown
const RELEASE_COOLDOWN_MS = 500
let releaseTimer: ReturnType<typeof setTimeout> | null = null

// Chat scroll boundary buffer
let chatBoundaryDelta = 0
const CHAT_BOUNDARY_THRESHOLD = 200

// IntersectionObservers
let centerObserver: IntersectionObserver | null = null
let escapeObserver: IntersectionObserver | null = null

const LOCK_OFFSET = 40

// Lerp scroll engine (no internal listeners — we feed it from handleWheel)
const { feedDelta, animateTo, syncPosition, start: startScroll, stop: stopScroll } = useSmoothScroll({
  lerp: 0.09,
  maxDelta: 120,
})

// Branch highlighting state
const hoveredBranch = ref<string | null>(null)
const highlightedBranch = ref<string | null>(null)
const isUserHovering = ref(false)
let highlightInterval: number | null = null
const branches = ['legal', 'copy', 'ux'] as const

// Step 3: Chat UI state
const activeChatBranch = ref('main')
const isFlipped = ref(false)
const mobileTab = ref<'branches' | 'chat'>('branches') // For small screen tab switching

// Mock conversation data - context state is managed separately
const messageContextState = reactive<Record<number, boolean>>({
  1: true, 2: true, 3: true, 4: true,
  5: true, 6: true, 7: true,
  8: true, 9: true, 10: false,
  11: true, 12: true
})

// Mock conversation data (computed from translations)
const mockConversation = computed(() => {
  const mainMsgs = tm('mockConversation.main.messages') as Array<{ role: string; content: string }>
  const legalMsgs = tm('mockConversation.legal.messages') as Array<{ role: string; content: string }>
  const copyMsgs = tm('mockConversation.copy.messages') as Array<{ role: string; content: string }>
  const uxMsgs = tm('mockConversation.ux.messages') as Array<{ role: string; content: string }>

  return {
    main: {
      title: t('mockConversation.main.title'),
      messages: (mainMsgs || []).map((msg, i) => ({
        id: i + 1,
        role: msg.role,
        content: msg.content,
        inContext: messageContextState[i + 1] ?? true
      }))
    },
    legal: {
      title: t('mockConversation.legal.title'),
      subtitle: t('mockConversation.legal.subtitle'),
      branchPoint: 2,
      messages: (legalMsgs || []).map((msg, i) => ({
        id: i + 5,
        role: msg.role,
        content: msg.content,
        inContext: messageContextState[i + 5] ?? true
      }))
    },
    copy: {
      title: t('mockConversation.copy.title'),
      subtitle: t('mockConversation.copy.subtitle'),
      branchPoint: 3,
      messages: (copyMsgs || []).map((msg, i) => ({
        id: i + 8,
        role: msg.role,
        content: msg.content,
        inContext: messageContextState[i + 8] ?? true
      }))
    },
    ux: {
      title: t('mockConversation.ux.title'),
      subtitle: t('mockConversation.ux.subtitle'),
      branchPoint: 4,
      messages: (uxMsgs || []).map((msg, i) => ({
        id: i + 11,
        role: msg.role,
        content: msg.content,
        inContext: messageContextState[i + 11] ?? true
      }))
    }
  }
})

// Message type for display
type DisplayMessage = {
  id: number
  role: string
  content: string
  inContext: boolean
  fromBranch?: string
  isBranchPoint?: boolean
}

// Get messages to display for current branch (includes main branch context)
const displayMessages = computed((): DisplayMessage[] => {
  const messages: DisplayMessage[] = []
  const conv = mockConversation.value

  if (activeChatBranch.value === 'main') {
    return conv.main.messages.map((m: { id: number; role: string; content: string; inContext: boolean }) => ({ ...m, fromBranch: 'main' }))
  }

  const branch = conv[activeChatBranch.value as keyof typeof conv]
  if (!branch || !('branchPoint' in branch)) return messages

  // Add main branch messages up to branch point
  const mainMessages = conv.main.messages.slice(0, branch.branchPoint)
  mainMessages.forEach((m: { id: number; role: string; content: string; inContext: boolean }) => messages.push({ ...m, fromBranch: 'main' }))

  // Add branch point marker
  messages.push({ id: -1, role: 'system', content: '', inContext: true, fromBranch: 'marker', isBranchPoint: true })

  // Add branch messages
  branch.messages.forEach((m: { id: number; role: string; content: string; inContext: boolean }) => messages.push({ ...m, fromBranch: activeChatBranch.value }))

  return messages
})

// Track animation states
const animatingMessages = ref<Map<number, string>>(new Map())
const animatingBranches = ref<Map<string, string>>(new Map())

// Get context status for a branch (all, some, or none in context)
function getBranchContextStatus(branchKey: string): 'all' | 'some' | 'none' {
  const conv = mockConversation.value
  const branch = conv[branchKey as keyof typeof conv]
  if (!branch) return 'none'

  const inContextCount = branch.messages.filter((m: { inContext: boolean }) => m.inContext).length
  if (inContextCount === branch.messages.length) return 'all'
  if (inContextCount === 0) return 'none'
  return 'some'
}

// Toggle all messages in a branch
function toggleBranchContext(branchKey: string, event: Event) {
  const conv = mockConversation.value
  const branch = conv[branchKey as keyof typeof conv]
  if (!branch) return

  // If all are in context, remove all. Otherwise, add all.
  const allInContext = branch.messages.every((m: { inContext: boolean }) => m.inContext)
  const newValue = !allInContext

  // Update the context state
  branch.messages.forEach((m: { id: number }) => {
    messageContextState[m.id] = newValue
  })

  // Trigger animation
  const animationType = newValue ? 'context-added' : 'context-removed'
  animatingBranches.value.set(branchKey, animationType)

  // Add pulse class to button
  const button = event.target as HTMLElement
  const toggleBtn = button.closest('.context-toggle-all') as HTMLElement
  if (toggleBtn) {
    toggleBtn.classList.add('just-toggled')
    setTimeout(() => toggleBtn.classList.remove('just-toggled'), 400)
  }

  // Remove animation class after animation completes
  setTimeout(() => {
    animatingBranches.value.delete(branchKey)
  }, 500)
}

// Get animation class for a branch
function getBranchAnimationClass(branchKey: string): string {
  return animatingBranches.value.get(branchKey) || ''
}

// Toggle message context
function toggleMessageContext(messageId: number, event: Event) {
  // Toggle the context state
  const currentState = messageContextState[messageId] ?? true
  messageContextState[messageId] = !currentState

  // Trigger animation
  const animationType = messageContextState[messageId] ? 'context-added' : 'context-removed'
  animatingMessages.value.set(messageId, animationType)

  // Add pulse class to button
  const button = event.target as HTMLElement
  const toggleBtn = button.closest('.context-toggle') as HTMLElement
  if (toggleBtn) {
    toggleBtn.classList.add('just-toggled')
    setTimeout(() => toggleBtn.classList.remove('just-toggled'), 400)
  }

  // Remove animation class after animation completes
  setTimeout(() => {
    animatingMessages.value.delete(messageId)
  }, 500)
}

// Get animation class for a message
function getMessageAnimationClass(messageId: number): string {
  return animatingMessages.value.get(messageId) || ''
}

// =============================================================================
// SCROLL INDICATOR
// =============================================================================
function handleScroll() {
  hasScrolled.value = window.scrollY > 50
}

// =============================================================================
// SCROLL HIJACK FOR "HOW IT WORKS" SECTION
// =============================================================================

function snapToSection(element: HTMLElement): Promise<void> {
  const rect = element.getBoundingClientRect()
  const target = window.scrollY + rect.top - LOCK_OFFSET
  // Use the lerp engine (not native behavior:'smooth') to avoid fighting
  animateTo(target)
  return new Promise(resolve => {
    const check = () => {
      if (Math.abs(window.scrollY - target) < 2) {
        resolve()
      } else {
        requestAnimationFrame(check)
      }
    }
    requestAnimationFrame(check)
  })
}

function lockScroll() {
  scrollState = ScrollState.LOCKED
  document.body.style.overflow = 'hidden'
  accumulatedDelta = 0
}

function releaseScroll(direction: 'up' | 'down') {
  if (scrollState !== ScrollState.LOCKED) return

  scrollState = ScrollState.RELEASING
  document.body.style.overflow = ''
  accumulatedDelta = 0

  // Sync lerp engine then scroll to adjacent section
  syncPosition()
  const section = branchingSectionRef.value
  if (section) {
    const sibling = direction === 'down'
      ? section.nextElementSibling as HTMLElement
      : section.previousElementSibling as HTMLElement
    if (sibling) {
      const rect = sibling.getBoundingClientRect()
      animateTo(window.scrollY + rect.top)
    }
  }

  // Timed cooldown: return to FREE after delay (no position-based dead zone)
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => {
    scrollState = ScrollState.FREE
    releaseTimer = null
  }, RELEASE_COOLDOWN_MS)
}

function handleWheel(event: WheelEvent) {
  // ---- Guard: settings overlay scroll ----
  const target = event.target as HTMLElement
  if (target.closest('.settings-overlay')) return

  // ---- Guard: chat sub-container scroll ----
  const chatContainer = target.closest('.chat-messages') as HTMLElement | null

  if (chatContainer) {
    const scrollingDown = event.deltaY > 0
    const scrollingUp = event.deltaY < 0
    const atBottom = chatContainer.scrollTop + chatContainer.clientHeight >= chatContainer.scrollHeight - 2
    const atTop = chatContainer.scrollTop <= 2

    if ((scrollingDown && !atBottom) || (scrollingUp && !atTop)) {
      chatBoundaryDelta = 0
      return // Let chat scroll naturally
    }

    chatBoundaryDelta += Math.abs(event.deltaY)
    if (chatBoundaryDelta < CHAT_BOUNDARY_THRESHOLD) {
      event.preventDefault()
      return
    }
    chatBoundaryDelta = 0
    // Fall through to page scroll logic
  }

  // ---- Ignore ctrl/meta (zoom) ----
  if (event.ctrlKey || event.metaKey) return

  const state = scrollState

  // ---- RELEASING: consume silently (timed cooldown, no dead zone) ----
  if (state === ScrollState.RELEASING) {
    event.preventDefault()
    return
  }

  // ---- LOCKING: consume silently while snap animation runs ----
  if (state === ScrollState.LOCKING) {
    event.preventDefault()
    return
  }

  // ---- LOCKED: drive step changes ----
  if (state === ScrollState.LOCKED) {
    event.preventDefault()

    const now = Date.now()
    if (now - lastStepChangeTime < STEP_COOLDOWN_MS) return
    if (isAnimating.value) return

    const scrollingDown = event.deltaY > 0
    const scrollingUp = event.deltaY < 0

    // Reset on direction change
    if ((scrollingDown && accumulatedDelta < 0) || (scrollingUp && accumulatedDelta > 0)) {
      accumulatedDelta = 0
    }

    accumulatedDelta += event.deltaY

    if (scrollingDown && accumulatedDelta >= STEP_THRESHOLD) {
      accumulatedDelta = 0
      if (vizStep.value < 2) {
        lastStepChangeTime = now
        goToStep(vizStep.value + 1)
      } else {
        releaseScroll('down')
      }
    } else if (scrollingUp && accumulatedDelta <= -STEP_THRESHOLD) {
      accumulatedDelta = 0
      if (vizStep.value > 0) {
        lastStepChangeTime = now
        goToStep(vizStep.value - 1)
      } else {
        releaseScroll('up')
      }
    }
    return
  }

  // ---- FREE: check for hijack trigger, otherwise smooth scroll ----
  if (sectionCentered.value && branchingSectionRef.value) {
    event.preventDefault()
    scrollState = ScrollState.LOCKING

    snapToSection(branchingSectionRef.value).then(() => {
      // Only lock if we're still in LOCKING (wasn't cancelled by resize etc.)
      if (scrollState === ScrollState.LOCKING) {
        lockScroll()
      }
    })
    return
  }

  // Normal smooth scroll via lerp engine
  event.preventDefault()

  let rawDelta = event.deltaY
  if (event.deltaMode === 1) rawDelta *= 40
  if (event.deltaMode === 2) rawDelta *= 800

  feedDelta(rawDelta)
}

function setupObservers() {
  const section = branchingSectionRef.value
  if (!section) return

  // Center observer: fires when section enters the middle 40% of viewport
  centerObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        sectionCentered.value = entry.isIntersecting
      }
    },
    {
      rootMargin: '-30% 0px -30% 0px',
      threshold: 0,
    }
  )
  centerObserver.observe(section)

  // Escape observer: emergency release if section fully leaves viewport while locked
  escapeObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting && scrollState === ScrollState.LOCKED) {
          scrollState = ScrollState.FREE
          document.body.style.overflow = ''
          accumulatedDelta = 0
          syncPosition()
        }
      }
    },
    { threshold: 0.1 }
  )
  escapeObserver.observe(section)
}

function handleResize() {
  isMobile.value = window.innerWidth < 768
  if (window.innerWidth < 768) {
    // Release on mobile
    if (scrollState === ScrollState.LOCKED || scrollState === ScrollState.LOCKING) {
      document.body.style.overflow = ''
      scrollState = ScrollState.FREE
      syncPosition()
    }
    window.removeEventListener('wheel', handleWheel)
  } else {
    window.removeEventListener('wheel', handleWheel)
    window.addEventListener('wheel', handleWheel, { passive: false })
  }
}

// =============================================================================
// NAVIGATION
// =============================================================================
function enterApp() {
  router.push({ name: 'home' })
}

// =============================================================================
// DATA
// =============================================================================
const faqItems = computed(() => {
  const items = tm('faq.items')
  // tm() returns the raw message, which should be the array
  if (Array.isArray(items)) {
    return items as Array<{ question: string; answer: string }>
  }
  return []
})

const features = computed(() => [
  {
    title: t('features.items.branchAnywhere.title'),
    description: t('features.items.branchAnywhere.description'),
    icon: 'branch',
  },
  {
    title: t('features.items.hybridContext.title'),
    description: t('features.items.hybridContext.description'),
    icon: 'context',
  },
  {
    title: t('features.items.lowerTokenSpend.title'),
    description: t('features.items.lowerTokenSpend.description'),
    icon: 'coins',
  },
  {
    title: t('features.items.splitView.title'),
    description: t('features.items.splitView.description'),
    icon: 'split',
  },
  {
    title: t('features.items.graphExplorer.title'),
    description: t('features.items.graphExplorer.description'),
    icon: 'graph',
  },
  {
    title: t('features.items.localEncrypted.title'),
    description: t('features.items.localEncrypted.description'),
    icon: 'lock',
  },
])


const vizSteps = computed(() => [
  {
    step: 1,
    title: t('howItWorks.steps.branchAnywhere.title'),
    description: t('howItWorks.steps.branchAnywhere.description'),
    buttonText: t('howItWorks.steps.branchAnywhere.buttonText'),
  },
  {
    step: 2,
    title: t('howItWorks.steps.keepContextFocused.title'),
    description: t('howItWorks.steps.keepContextFocused.description'),
    buttonText: t('howItWorks.steps.keepContextFocused.buttonText'),
  },
  {
    step: 3,
    title: t('howItWorks.steps.controlYourContext.title'),
    description: t('howItWorks.steps.controlYourContext.description'),
    buttonText: '',
  },
])

// Current viz step with safe access
const currentVizStep = computed(() => {
  return vizSteps.value[vizStep.value] ?? vizSteps.value[0]!
})

// Advance to next step with animation
function advanceVizStep() {
  if (isAnimating.value || vizStep.value >= 2) return
  goToStep(vizStep.value + 1)
}

// Go to a specific step
function goToStep(step: number) {
  if (isAnimating.value) return
  isAnimating.value = true

  const previousStep = vizStep.value
  vizStep.value = step

  // Handle flip animation
  if (step === 2 && previousStep < 2) {
    // Going to step 3 - flip to back
    setTimeout(() => {
      isFlipped.value = true
    }, 100)
  } else if (step < 2 && previousStep === 2) {
    // Going back from step 3 - flip to front
    isFlipped.value = false
  }

  // Reset animation flag after transition completes
  setTimeout(() => {
    isAnimating.value = false
  }, 500)
}

// =============================================================================
// BRANCH HIGHLIGHTING
// =============================================================================
function getRandomBranch(exclude: string | null): string {
  const available = branches.filter(b => b !== exclude)
  return available[Math.floor(Math.random() * available.length)] ?? 'legal'
}

let hoverDebounceTimeout: number | null = null
let resumeRandomTimeout: number | null = null

function startRandomHighlight() {
  if (highlightInterval) return
  // Initial highlight
  highlightedBranch.value = getRandomBranch(highlightedBranch.value)

  highlightInterval = window.setInterval(() => {
    // Only change if user is not hovering
    if (!isUserHovering.value) {
      highlightedBranch.value = getRandomBranch(highlightedBranch.value)
    }
  }, 3000)
}

function stopRandomHighlight() {
  if (highlightInterval) {
    clearInterval(highlightInterval)
    highlightInterval = null
  }
  if (hoverDebounceTimeout) {
    clearTimeout(hoverDebounceTimeout)
    hoverDebounceTimeout = null
  }
  if (resumeRandomTimeout) {
    clearTimeout(resumeRandomTimeout)
    resumeRandomTimeout = null
  }
  highlightedBranch.value = null
}

function onBranchHover(branch: string) {
  // Clear any pending timeouts
  if (hoverDebounceTimeout) {
    clearTimeout(hoverDebounceTimeout)
    hoverDebounceTimeout = null
  }
  if (resumeRandomTimeout) {
    clearTimeout(resumeRandomTimeout)
    resumeRandomTimeout = null
  }

  // Only update if we're hovering a different branch
  if (hoveredBranch.value !== branch) {
    isUserHovering.value = true
    hoveredBranch.value = branch
    // Clear the random highlight so it doesn't show when we stop hovering
    highlightedBranch.value = null
  }
}

function onBranchLeave() {
  // Debounce the leave event to prevent flickering
  if (hoverDebounceTimeout) {
    clearTimeout(hoverDebounceTimeout)
  }

  hoverDebounceTimeout = window.setTimeout(() => {
    hoveredBranch.value = null

    // Wait 1 second before resuming random highlights
    if (resumeRandomTimeout) {
      clearTimeout(resumeRandomTimeout)
    }
    resumeRandomTimeout = window.setTimeout(() => {
      if (!hoveredBranch.value) {
        isUserHovering.value = false
        highlightedBranch.value = getRandomBranch(highlightedBranch.value)
      }
    }, 1000)
  }, 50)
}

// Computed for which branch is currently active (hovered or random)
const activeBranch = computed(() => hoveredBranch.value || highlightedBranch.value)


// =============================================================================
// MOTION ANIMATION PRESETS
// =============================================================================
function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 30 },
    inView: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay, ease: 'easeOut' },
  }
}

function fadeIn(delay = 0) {
  return {
    initial: { opacity: 0 },
    inView: { opacity: 1 },
    transition: { duration: 0.5, delay, ease: 'easeOut' },
  }
}

// =============================================================================
// LIFECYCLE
// =============================================================================
onMounted(() => {
  stableViewportHeight = window.innerHeight
  isMobile.value = window.innerWidth < 768
  if (isMobile.value) {
    document.addEventListener('touchstart', onHeroTouchStart, { passive: true })
    document.addEventListener('touchmove', onHeroTouchMove, { passive: false })
    document.addEventListener('touchend', onHeroTouchEnd, { passive: true })
  }
  startScroll()

  window.addEventListener('scroll', handleScroll)
  window.addEventListener('scroll', updateParallaxProgress, { passive: true })
  window.addEventListener('resize', handleResize)

  if (window.innerWidth >= 768) {
    window.addEventListener('wheel', handleWheel, { passive: false })
  }

  // Setup observers after DOM settles
  setTimeout(setupObservers, 100)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('scroll', updateParallaxProgress)
  window.removeEventListener('wheel', handleWheel)
  window.removeEventListener('resize', handleResize)
  stopRandomHighlight()
  stopScroll()

  if (heroAutoScrollRafId !== null) cancelAnimationFrame(heroAutoScrollRafId)
  document.removeEventListener('touchstart', onHeroTouchStart)
  document.removeEventListener('touchmove', onHeroTouchMove)
  document.removeEventListener('touchend', onHeroTouchEnd)
  if (parallaxRafId !== null) cancelAnimationFrame(parallaxRafId)

  // Clean up scroll lock
  if (scrollState === ScrollState.LOCKED || scrollState === ScrollState.LOCKING) {
    document.body.style.overflow = ''
  }
  scrollState = ScrollState.FREE

  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }

  centerObserver?.disconnect()
  escapeObserver?.disconnect()
})

// Watch for step changes to start/stop random highlighting
watch(vizStep, (newStep) => {
  if (newStep >= 1) {
    // Start random highlighting when branches are visible
    setTimeout(() => startRandomHighlight(), 1000)
  } else {
    stopRandomHighlight()
  }
})
</script>

<template>
  <div class="landing-page" :class="{ 'day-mode': themeStore.isDayMode, 'theme-transitioning': themeStore.isTransitioning }">
    <!-- Top Navigation Bar -->
    <TopNavBar />

    <!-- Parallax Background -->
    <div class="parallax-viewport">
      <div class="parallax-frame">
        <div
          v-for="(_, i) in 6"
          :key="i"
          class="parallax-layer"
          :style="{
            zIndex: i,
            transform: `scale(${getParallaxScale(i)})`,
          }"
        >
          <img :src="parallaxImages[i]" :alt="`Layer ${i + 1}`" draggable="false" />
        </div>
      </div>
    </div>

    <!-- ================================================================== -->
    <!-- HERO SECTION (Scroll-Driven Cinematic Reveal) -->
    <!-- ================================================================== -->
    <section class="hero-section">
      <!-- Fixed layer: title + description + trust tags (fades out when done) -->
      <div class="hero-fixed-layer" :class="{ 'hero-fixed-layer--done': heroSectionDone }">
        <!-- Left: Stamp Logo + Horizontal Title -->
        <div class="hero-title-container">
          <!-- Stamp image with tile-reveal -->
          <div class="hero-stamp-wrapper">
            <img
              class="hero-stamp-img"
              :src="stampImage"
              alt="Bonsai"
              draggable="false"
            />
            <!-- Tile grid overlay — covers stamp, tiles flip away to reveal it -->
            <div class="tile-grid-overlay">
              <div
                v-for="idx in TILE_COUNT"
                :key="idx - 1"
                class="reveal-tile"
                :class="{ flipped: isTileFlipped(idx - 1) }"
              />
            </div>
          </div>
          <!-- Horizontal title below the stamp — letter images with staggered scroll reveal -->
          <h1 class="hero-title-letters" data-testid="hero-headline">
            <img
              v-for="(letter, i) in titleLetters"
              :key="i"
              :src="letter.src"
              :alt="letter.alt"
              class="title-letter-img"
              :style="getLetterStyle(i)"
              draggable="false"
            />
          </h1>
        </div>

        <!-- Right top: Subtitle -->
        <div
          class="hero-subtitle-reveal"
          :style="{
            opacity: descriptionOpacity,
            transform: `translateY(${descriptionTranslateY}px)`,
          }"
        >
          <p class="hero-description-line">{{ t('hero.subtitle') }}</p>
        </div>

        <!-- Right center: Tagline -->
        <div
          class="hero-tagline-reveal"
          :style="{
            opacity: descriptionOpacity,
            transform: `translateY(${descriptionTranslateY}px)`,
          }"
        >
          <p class="hero-description-tagline">{{ t('footer.tagline') }}</p>
        </div>

        <!-- Trust Tags -->
        <div class="trust-tags" :style="{ opacity: trustTagsOpacity }">
          <div class="trust-tag">
            <span class="tag-dot"></span>
            {{ t('hero.trustTags.localFirst') }}
          </div>
          <div class="trust-tag">
            <span class="tag-dot"></span>
            {{ t('hero.trustTags.encrypted') }}
          </div>
          <div class="trust-tag">
            <span class="tag-dot"></span>
            {{ t('hero.trustTags.offline') }}
          </div>
        </div>
      </div>

      <!-- CTAs at bottom of viewport -->
      <div class="hero-ctas" :class="{ 'hero-ctas--done': heroSectionDone }" :style="scrollIndicatorStyle">
        <button class="cta-primary" data-testid="enter-app-btn" @click="enterApp">
          {{ t('hero.cta.enterApp') }}
          <svg class="cta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Scroll indicator with text -->
        <div class="scroll-indicator" :class="{ 'scroll-indicator--hidden': heroSectionDone }">
          <span class="scroll-indicator-text" :class="{ 'scroll-indicator-text--hidden': hasScrolled }">SCROLL DOWN</span>
          <div class="scroll-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
        </div>
      </div>
    </section>

    <!-- ================================================================== -->
    <!-- HOW IT WORKS SECTION (Interactive Branching Visualization) -->
    <!-- ================================================================== -->
    <section id="branching-viz" ref="branchingSectionRef" class="branching-section">
      <div class="section-container">
        <div class="section-header">
          <Motion tag="span" class="section-tag" v-bind="fadeIn(0)" :inViewOptions="{ amount: 0.1 }">{{ t('howItWorks.sectionTag') }}</Motion>
          <Motion tag="h2" class="section-title" v-bind="fadeUp(0.05)" :inViewOptions="{ amount: 0.1 }">{{ t('howItWorks.title') }}</Motion>
          <Motion tag="p" class="section-subtitle" v-bind="fadeUp(0.15)" :inViewOptions="{ amount: 0.1 }">{{ t('howItWorks.subtitle') }}</Motion>
        </div>

        <div class="branching-layout">
          <!-- Sidebar -->
          <div class="viz-sidebar">
            <div class="step-indicator">
              <span :key="`step-num-${vizStep}`" class="step-number animate-text">{{ currentVizStep.step }}</span>
              <span class="step-of">{{ t('howItWorks.stepOf') }} 3</span>
            </div>
            <h3 :key="`title-${vizStep}`" class="sidebar-title animate-text delay-1">{{ currentVizStep.title }}</h3>
            <p :key="`desc-${vizStep}`" class="sidebar-description animate-text delay-2">{{ currentVizStep.description }}</p>

            <!-- Step progress dots -->
            <div class="step-dots">
              <button
                v-for="i in 3"
                :key="i"
                class="step-dot"
                :class="{ active: vizStep >= i - 1, current: vizStep === i - 1 }"
                @click="goToStep(i - 1)"
              />
            </div>
          </div>

          <!-- Diagram with Flip Container -->
          <div class="flip-container" :class="{ flipped: isFlipped }">
            <div class="flip-inner">
              <!-- Front: SVG Diagram -->
              <div class="flip-front branching-diagram">
            <svg class="diagram-svg" viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid meet">
              <defs>
                <!-- Grid pattern -->
                <pattern id="diagramGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path class="grid-line" d="M 40 0 L 0 0 0 40" fill="none" stroke-width="1"/>
                </pattern>
                <!-- Glow filter -->
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
                <!-- Strong glow for buttons -->
                <filter id="buttonGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
                <!-- Context highlight gradient -->
                <linearGradient id="contextHighlight" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#D97706" stop-opacity="0.8" />
                  <stop offset="100%" stop-color="#D97706" stop-opacity="0.3" />
                </linearGradient>
              </defs>

              <!-- Background grid -->
              <rect width="100%" height="100%" fill="url(#diagramGrid)" />

              <!-- Highlight paths (rendered FIRST so they appear BEHIND main paths as glow) -->
              <!-- Main branch highlight -->
              <path
                v-if="vizStep >= 1 && activeBranch === 'legal'"
                key="main-legal"
                d="M 50 250 L 200 250"
                stroke="#93C5FD"
                stroke-width="14"
                fill="none"
                stroke-linecap="round"
                class="highlight-glow highlight-travel"
                style="--path-length: 150"
              />
              <path
                v-if="vizStep >= 1 && activeBranch === 'copy'"
                key="main-copy"
                d="M 50 250 L 400 250"
                stroke="#F9A8D4"
                stroke-width="14"
                fill="none"
                stroke-linecap="round"
                class="highlight-glow highlight-travel"
                style="--path-length: 350"
              />
              <path
                v-if="vizStep >= 1 && activeBranch === 'ux'"
                key="main-ux"
                d="M 50 250 L 600 250"
                stroke="#FDBA74"
                stroke-width="14"
                fill="none"
                stroke-linecap="round"
                class="highlight-glow highlight-travel"
                style="--path-length: 550"
              />

              <!-- Branch highlights -->
              <path
                v-if="vizStep >= 1 && activeBranch === 'legal'"
                key="branch-legal"
                d="M 200 250 C 280 250, 280 100, 360 100 L 850 100"
                stroke="#93C5FD"
                stroke-width="14"
                fill="none"
                stroke-linecap="round"
                class="highlight-glow highlight-travel-branch"
                style="--path-length: 800"
              />
              <path
                v-if="vizStep >= 1 && activeBranch === 'copy'"
                key="branch-copy"
                d="M 400 250 C 480 250, 480 170, 560 170 L 850 170"
                stroke="#F9A8D4"
                stroke-width="14"
                fill="none"
                stroke-linecap="round"
                class="highlight-glow highlight-travel-branch"
                style="--path-length: 600"
              />
              <path
                v-if="vizStep >= 1 && activeBranch === 'ux'"
                key="branch-ux"
                d="M 600 250 C 680 250, 680 380, 760 380 L 850 380"
                stroke="#FDBA74"
                stroke-width="14"
                fill="none"
                stroke-linecap="round"
                class="highlight-glow highlight-travel-branch"
                style="--path-length: 450"
              />

              <!-- Main horizontal line (always visible) -->
              <path
                d="M 50 250 L 900 250"
                stroke="currentColor"
                stroke-width="3"
                fill="none"
                stroke-linecap="round"
                class="main-path"
              />

              <!-- Branch 1: Legal Thread - branches early at x=200 (visible after step 1) -->
              <g
                class="branch-group"
                :class="{ visible: vizStep >= 1, animating: vizStep === 1 && isAnimating, highlighted: activeBranch === 'legal' }"
              >
                <path
                  d="M 200 250 C 280 250, 280 100, 360 100 L 850 100"
                  stroke="#93C5FD"
                  stroke-width="3"
                  fill="none"
                  stroke-linecap="round"
                  class="branch-path branch-legal"
                />
              </g>

              <!-- Branch 2: Copywriting - branches mid at x=400 (visible after step 1) -->
              <g
                class="branch-group"
                :class="{ visible: vizStep >= 1, animating: vizStep === 1 && isAnimating, highlighted: activeBranch === 'copy' }"
              >
                <path
                  d="M 400 250 C 480 250, 480 170, 560 170 L 850 170"
                  stroke="#F9A8D4"
                  stroke-width="3"
                  fill="none"
                  stroke-linecap="round"
                  class="branch-path branch-copy"
                />
              </g>

              <!-- Branch 3: UX Decisions - branches late at x=600 (visible after step 1) -->
              <g
                class="branch-group"
                :class="{ visible: vizStep >= 1, animating: vizStep === 1 && isAnimating, highlighted: activeBranch === 'ux' }"
              >
                <path
                  d="M 600 250 C 680 250, 680 380, 760 380 L 850 380"
                  stroke="#FDBA74"
                  stroke-width="3"
                  fill="none"
                  stroke-linecap="round"
                  class="branch-path branch-ux"
                />
              </g>

              <!-- Start node -->
              <circle class="start-node" cx="50" cy="250" r="5" fill="currentColor" filter="url(#glow)" />

              <!-- Branch point 1 (x=200) - always visible -->
              <g class="branch-node">
                <circle cx="200" cy="250" r="10" fill="transparent" stroke="currentColor" stroke-width="2" />
                <circle cx="200" cy="250" r="5" fill="currentColor" />
              </g>

              <!-- Branch point 2 (x=400) - visible after step 1 -->
              <g v-if="vizStep >= 1" class="branch-node">
                <circle cx="400" cy="250" r="10" fill="transparent" stroke="currentColor" stroke-width="2" />
                <circle cx="400" cy="250" r="5" fill="currentColor" />
              </g>

              <!-- Branch point 3 (x=600) - visible after step 1 -->
              <g v-if="vizStep >= 1" class="branch-node">
                <circle cx="600" cy="250" r="10" fill="transparent" stroke="currentColor" stroke-width="2" />
                <circle cx="600" cy="250" r="5" fill="currentColor" />
              </g>

              <!-- End node on main line -->
              <circle class="end-node" cx="900" cy="250" r="5" fill="currentColor" filter="url(#glow)" />

              <!-- Interactive button - moves position based on step -->
              <g
                v-if="vizStep < 2"
                class="branch-button animated-button-group"
                :class="{ 'step-1': vizStep === 1 }"
                @click="advanceVizStep"
              >
                <foreignObject
                  x="110"
                  y="118"
                  width="200"
                  height="105"
                >
                  <div class="continue-btn-wrapper">
                      <div class="continue-btn">
                        <span>{{ t('howItWorks.continueButton') }}</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                </foreignObject>
              </g>

              <!-- Animated dots traveling along branches (only visible when branches are shown) -->
              <circle v-if="vizStep >= 1" r="4" fill="#93C5FD" filter="url(#glow)" class="traveling-dot">
                <animateMotion dur="4s" repeatCount="indefinite" path="M 200 250 C 280 250, 280 100, 360 100 L 850 100" />
              </circle>
              <circle v-if="vizStep >= 1" r="4" fill="#F9A8D4" filter="url(#glow)" class="traveling-dot">
                <animateMotion dur="4.5s" repeatCount="indefinite" begin="0.5s" path="M 400 250 C 480 250, 480 170, 560 170 L 850 170" />
              </circle>
              <circle v-if="vizStep >= 1" r="4" fill="#FDBA74" filter="url(#glow)" class="traveling-dot">
                <animateMotion dur="3.5s" repeatCount="indefinite" begin="1s" path="M 600 250 C 680 250, 680 380, 760 380 L 850 380" />
              </circle>
              <circle r="4" fill="currentColor" filter="url(#glow)" class="traveling-dot traveling-dot-main">
                <animateMotion dur="5s" repeatCount="indefinite" begin="0.2s" path="M 50 250 L 900 250" />
              </circle>


              <!-- Branch Labels -->
              <foreignObject x="60" y="270" width="220" height="60">
                <div class="branch-label branch-label-main">
                  <span class="label-dot main"></span>
                  {{ t('howItWorks.branchLabels.centralPlan') }}
                </div>
              </foreignObject>

              <foreignObject v-if="vizStep >= 1" x="580" y="35" width="220" height="60">
                <div
                  class="branch-label branch-label-legal"
                  :class="{ 'fade-in': vizStep === 1 }"
                  @mouseenter="onBranchHover('legal')"
                  @mouseleave="onBranchLeave"
                >
                  <span class="label-dot legal"></span>
                  {{ t('howItWorks.branchLabels.legalThread') }}
                </div>
              </foreignObject>

              <foreignObject v-if="vizStep >= 1" x="580" y="175" width="220" height="60">
                <div
                  class="branch-label branch-label-copy"
                  :class="{ 'fade-in': vizStep === 1 }"
                  @mouseenter="onBranchHover('copy')"
                  @mouseleave="onBranchLeave"
                >
                  <span class="label-dot copy"></span>
                  {{ t('howItWorks.branchLabels.copywriting') }}
                </div>
              </foreignObject>

              <foreignObject v-if="vizStep >= 1" x="720" y="390" width="220" height="60">
                <div
                  class="branch-label branch-label-ux"
                  :class="{ 'fade-in': vizStep === 1 }"
                  @mouseenter="onBranchHover('ux')"
                  @mouseleave="onBranchLeave"
                >
                  <span class="label-dot ux"></span>
                  {{ t('howItWorks.branchLabels.uxDecisions') }}
                </div>
              </foreignObject>
            </svg>
          </div>

              <!-- Back: Chat UI -->
              <div class="flip-back chat-demo">
                <!-- Mobile Tabs (only visible on small screens) -->
                <div class="mobile-chat-tabs">
                  <button
                    class="mobile-tab"
                    :class="{ active: mobileTab === 'branches' }"
                    @click="mobileTab = 'branches'"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    {{ t('mockConversation.branches') }}
                  </button>
                  <button
                    class="mobile-tab"
                    :class="{ active: mobileTab === 'chat' }"
                    @click="mobileTab = 'chat'"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    {{ t('mockConversation.conversation') }}
                  </button>
                  <button class="mobile-tab flip-btn" :title="t('mockConversation.viewDiagram')" @click="goToStep(1)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                  </button>
                </div>

                <!-- Chat Sidebar -->
                <div class="chat-sidebar" :class="{ 'mobile-hidden': mobileTab !== 'branches' }">
                  <div class="chat-sidebar-header">
                    <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    <span>{{ t('mockConversation.branches') }}</span>
                    <button class="flip-back-btn" :title="t('mockConversation.viewDiagram')" @click="goToStep(1)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                    </button>
                  </div>

                  <!-- Main Branch -->
                  <div
                    class="branch-nav-item"
                    :class="[
                      { active: activeChatBranch === 'main' },
                      'context-' + getBranchContextStatus('main'),
                      getBranchAnimationClass('main')
                    ]"
                    @click="activeChatBranch = 'main'"
                  >
                    <div class="branch-nav-indicator main"></div>
                    <div class="branch-nav-content">
                      <span class="branch-nav-title">{{ mockConversation.main.title }}</span>
                      <span class="branch-nav-subtitle">{{ t('mockConversation.mainConversation') }}</span>
                    </div>
                    <button
                      class="context-toggle-all"
                      :class="{ 'all-active': getBranchContextStatus('main') === 'all' }"
                      :title="getBranchContextStatus('main') === 'all' ? 'Remove all from context' : 'Add all to context'"
                      @click.stop="toggleBranchContext('main', $event)"
                    >
                      <svg v-if="getBranchContextStatus('main') === 'all'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <svg v-else-if="getBranchContextStatus('main') === 'some'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                        <line x1="2" y1="2" x2="22" y2="22" stroke-width="1.5" />
                      </svg>
                      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    </button>
                  </div>

                  <!-- Sub-branches -->
                  <div
                    v-for="branchKey in ['legal', 'copy', 'ux']"
                    :key="branchKey"
                    class="branch-nav-item sub-branch"
                    :class="[
                      { active: activeChatBranch === branchKey },
                      'context-' + getBranchContextStatus(branchKey),
                      getBranchAnimationClass(branchKey)
                    ]"
                    @click="activeChatBranch = branchKey"
                  >
                    <div class="branch-nav-indicator" :class="branchKey"></div>
                    <div class="branch-nav-content">
                      <span class="branch-nav-title">{{ mockConversation[branchKey as keyof typeof mockConversation].title }}</span>
                      <span class="branch-nav-subtitle">{{ (mockConversation[branchKey as keyof typeof mockConversation] as any).subtitle }}</span>
                    </div>
                    <button
                      class="context-toggle-all"
                      :class="{ 'all-active': getBranchContextStatus(branchKey) === 'all' }"
                      :title="getBranchContextStatus(branchKey) === 'all' ? 'Remove all from context' : 'Add all to context'"
                      @click.stop="toggleBranchContext(branchKey, $event)"
                    >
                      <svg v-if="getBranchContextStatus(branchKey) === 'all'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <svg v-else-if="getBranchContextStatus(branchKey) === 'some'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                        <line x1="2" y1="2" x2="22" y2="22" stroke-width="1.5" />
                      </svg>
                      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    </button>
                  </div>
                </div>

                <!-- Chat Messages -->
                <div class="chat-messages" :class="{ 'mobile-hidden': mobileTab !== 'chat' }">
                  <div class="chat-messages-inner">
                    <template v-for="message in displayMessages" :key="message.id">
                      <!-- Branch point indicator -->
                      <div v-if="message.isBranchPoint" class="branch-point-indicator">
                        <div class="branch-point-line"></div>
                        <span class="branch-point-label">
                          {{ t('mockConversation.branchedTo') }} {{ mockConversation[activeChatBranch as keyof typeof mockConversation].title }}
                        </span>
                        <div class="branch-point-line"></div>
                      </div>

                      <!-- Regular message -->
                      <div
                        v-else
                        class="chat-message"
                        :class="[
                          message.role,
                          { 'out-of-context': !message.inContext },
                          { 'from-main': message.fromBranch === 'main' && activeChatBranch !== 'main' },
                          getMessageAnimationClass(message.id)
                        ]"
                      >
                        <div class="message-avatar">
                          <svg v-if="message.role === 'user'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="10" rx="2" />
                            <circle cx="8.5" cy="16" r="1.5" />
                            <circle cx="15.5" cy="16" r="1.5" />
                            <path d="M9 21v1" />
                            <path d="M15 21v1" />
                            <path d="M12 11V7" />
                            <circle cx="12" cy="4" r="2" />
                          </svg>
                        </div>
                        <div class="message-content">
                          <p>{{ message.content }}</p>
                        </div>
                        <button
                          class="context-toggle"
                          :class="{ active: message.inContext }"
                          :title="message.inContext ? 'Remove from context' : 'Add to context'"
                          @click="toggleMessageContext(message.id, $event)"
                        >
                          <svg v-if="message.inContext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        </button>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ================================================================== -->
    <!-- FEATURES SECTION -->
    <!-- ================================================================== -->
    <section class="features-section">
      <div class="section-container">
        <div class="section-header">
          <Motion tag="span" class="section-tag" v-bind="fadeIn(0)" :inViewOptions="{ amount: 0.1 }">{{ t('features.sectionTag') }}</Motion>
          <Motion tag="h2" class="section-title" v-bind="fadeUp(0.05)" :inViewOptions="{ amount: 0.1 }">{{ t('features.title') }}</Motion>
          <Motion tag="p" class="section-subtitle" v-bind="fadeUp(0.15)" :inViewOptions="{ amount: 0.1 }">{{ t('features.subtitle') }}</Motion>
        </div>

        <div class="features-grid">
          <Motion v-for="(feature, i) in features" :key="feature.title" tag="div" class="feature-card" v-bind="fadeUp(0.1 + i * 0.08)" :inViewOptions="{ amount: 0.2 }">
            <div class="feature-number">{{ String(i + 1).padStart(2, '0') }}</div>
            <div class="feature-icon">
              <!-- Branch -->
              <svg v-if="feature.icon === 'branch'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="6" r="3" />
                <path d="M6 15V9a6 6 0 016-6h3m0 0l-3-3m3 3l-3 3" />
              </svg>
              <!-- Context -->
              <svg v-else-if="feature.icon === 'context'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18M3 9h6M15 3v18M15 15h6" />
              </svg>
              <!-- Coins -->
              <svg v-else-if="feature.icon === 'coins'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
                <path d="M7 6h1v4" />
                <path d="m16.71 13.88.7.71-2.82 2.82" />
              </svg>
              <!-- Split -->
              <svg v-else-if="feature.icon === 'split'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="8" height="18" rx="1" />
                <rect x="13" y="3" width="8" height="18" rx="1" />
              </svg>
              <!-- Graph -->
              <svg v-else-if="feature.icon === 'graph'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="5" r="3" />
                <circle cx="5" cy="19" r="3" />
                <circle cx="19" cy="19" r="3" />
                <path d="M12 8v3M8 15l-1.5 2M16 15l1.5 2" />
              </svg>
              <!-- Lock -->
              <svg v-else-if="feature.icon === 'lock'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 118 0v4" />
              </svg>
            </div>
            <h3 class="feature-title">{{ feature.title }}</h3>
            <p class="feature-description">{{ feature.description }}</p>
          </Motion>
        </div>
      </div>
    </section>


    <!-- ================================================================== -->
    <!-- FAQ SECTION -->
    <!-- ================================================================== -->
    <section class="faq-section">
      <div class="section-container">
        <div class="section-header">
          <Motion tag="span" class="section-tag" v-bind="fadeIn(0)" :inViewOptions="{ amount: 0.1 }">{{ t('faq.sectionTag') }}</Motion>
          <Motion tag="h2" class="section-title" v-bind="fadeUp(0.05)" :inViewOptions="{ amount: 0.1 }">{{ t('faq.title') }}</Motion>
        </div>

        <div class="faq-list">
          <Motion
            v-for="(item, i) in faqItems"
            :key="i"
            tag="div"
            class="faq-item"
            :class="{ open: activeFaqIndex === i }"
            v-bind="fadeUp(0.1 + i * 0.08)"
            :inViewOptions="{ amount: 0.3 }"
          >
            <button class="faq-question" @click="activeFaqIndex = activeFaqIndex === i ? null : i">
              <span class="faq-num">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="faq-text">{{ item.question }}</span>
              <svg class="faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div v-show="activeFaqIndex === i" class="faq-answer">
              <p>{{ item.answer }}</p>
            </div>
          </Motion>
        </div>
      </div>
    </section>

    <!-- ================================================================== -->
    <!-- FOOTER SECTION -->
    <!-- ================================================================== -->
    <footer class="footer-section">
      <div class="section-container">
        <Motion tag="div" class="footer-cta-wrapper" v-bind="fadeUp(0)" :inViewOptions="{ amount: 0.1 }">
          <button class="cta-primary footer-cta-spacing" @click="enterApp">
            {{ t('footer.cta') }}
            <svg class="cta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </Motion>

        <Motion tag="p" class="footer-tagline" v-bind="fadeIn(0.2)" :inViewOptions="{ amount: 0.1 }">{{ t('footer.tagline') }}</Motion>

        <Motion tag="div" class="footer-links" v-bind="fadeIn(0.3)" :inViewOptions="{ amount: 0.1 }">
          <span class="footer-link">{{ t('footer.links.dataStored') }}</span>
          <span class="footer-sep">|</span>
          <a href="#" class="footer-link">{{ t('footer.links.github') }}</a>
          <span class="footer-sep">|</span>
          <a href="#" class="footer-link">{{ t('footer.links.docs') }}</a>
        </Motion>

        <Motion tag="div" class="footer-version" v-bind="fadeIn(0.4)" :inViewOptions="{ amount: 0.1 }">v1.0.0</Motion>
      </div>
    </footer>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');

/* ============================================================================= */
/* CSS CUSTOM PROPERTIES (VARIABLES) */
/* ============================================================================= */
.landing-page {
  /* Night mode colors — pure black + gold */
  --bg-primary: #000000;
  --bg-secondary: rgba(10, 10, 10, 0.85);
  --bg-tertiary: rgba(10, 10, 10, 0.95);
  --text-primary: #e2e8f0;
  --text-secondary: #929ca9;
  --text-muted: rgba(226, 232, 240, 0.6);
  --text-description: #CDD4DE;
  --accent: #E7D27C;
  --accent-rgb: 231, 210, 124;
  --border-color: rgba(231, 210, 124, 0.4);
  --border-subtle: rgba(231, 210, 124, 0.15);

  /* Branch colors */
  --branch-blue: #93C5FD;
  --branch-pink: #F9A8D4;
  --branch-orange: #FDBA74;

  /* Typography */
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;

  /* Border radius — sharp edges */
  --radius-sm: 0;
  --radius-md: 0;
  --radius-lg: 0;
  --radius-xl: 0;
  --radius-2xl: 0;
  --radius-pill: 0;
  --radius-full: 50%; /* keep for circular dots only */

  /* Blur values */
  --blur-sm: blur(8px);
  --blur-md: blur(10px);
  --blur-lg: blur(12px);

  /* Transitions */
  --transition-fast: 0.2s ease;
  --transition-normal: 0.3s ease;
  --transition-slow: 0.4s ease;

  /* Shadows */
  --shadow-sm: 0 4px 15px rgba(0, 0, 0, 0.1);
  --shadow-md: 0 8px 25px rgba(0, 0, 0, 0.15);
  --shadow-accent: 0 4px 15px rgba(var(--accent-rgb), 0.3);
  --shadow-accent-lg: 0 8px 25px rgba(var(--accent-rgb), 0.4);
}

/* Day mode color overrides — Chinese blue-and-white porcelain */
.landing-page.day-mode {
  --bg-primary: #FFFFFF;
  --bg-secondary: rgba(255, 255, 255, 0.95);
  --bg-tertiary: rgba(255, 255, 255, 0.98);
  --text-primary: var(--accent);
  --text-secondary: #578cff;
  --text-muted: rgba(var(--accent-rgb), 0.6);
  --accent: #0227f6;
  --accent-rgb: 2, 39, 246;
  --accent-mid: #3860e8;
  --accent-dark: #011DC4;
  --accent-darker: #01159A;
  --border-color: var(--accent);
  --border-subtle: #a3bbff;
  --shadow-accent: 0 4px 15px rgba(var(--accent-rgb), 0.3);
  --shadow-accent-lg: 0 8px 25px rgba(var(--accent-rgb), 0.4);
}

/* ============================================================================= */
/* BASE STYLES */
/* ============================================================================= */
.landing-page {
  min-height: 100svh;
  padding-top: 60px; /* Account for fixed navbar */
  color: var(--text-primary);
  font-family: var(--font-sans);
  overflow-x: hidden;
  position: relative;
  background: var(--bg-primary);
  transition: color var(--transition-slow);
}

/* ============================================================================= */
/* PARALLAX BACKGROUND */
/* ============================================================================= */
.parallax-viewport {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.parallax-frame {
  position: absolute;
  /* Anchor to stable svh center so mobile browser chrome changes don't cause jumps */
  top: 50svh;
  left: 50vw;
  transform: translate(-50%, -50%);
  /* Keep square: use the smaller of 50vw / 50svh so the cutout layer is never cropped */
  width: min(50vw, 50svh);
  height: min(50vw, 50svh);
  overflow: hidden;
}

.parallax-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center center;
  will-change: transform;
  transition: transform 0.05s linear;
}

.parallax-layer img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
}

/* ============================================================================= */
/* TOP CONTROLS (Language selector + Theme toggle) */
/* ============================================================================= */
.top-controls {
  position: fixed;
  top: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  z-index: var(--z-navbar);
}

/* ============================================================================= */
/* THEME TOGGLE */
/* ============================================================================= */
.theme-toggle {
  border-color: var(--border-color);
}

/* ============================================================================= */
/* THEME TRANSITION ANIMATION */
/* ============================================================================= */

/* Smooth fade for the whole page during transition */
.theme-transitioning {
  animation: themeFade 0.5s ease;
}

@keyframes themeFade {
  0% {
    opacity: 1;
  }
  30% {
    opacity: 0.6;
  }
  100% {
    opacity: 1;
  }
}

/* ============================================================================= */
/* DAY MODE - Warm Pastel Theme */
/* ============================================================================= */
/* Note: Color variables are automatically switched via .landing-page.day-mode above */

.day-mode .theme-toggle {
  border-color: var(--accent);
}

/* Language selector */
.day-mode :deep(.language-trigger) {
  background: transparent;
  border-color: rgba(56, 96, 232, 0.2);
  color: var(--accent-mid);
}

.day-mode :deep(.language-trigger:hover) {
  background: rgba(56, 96, 232, 0.06);
  border-color: var(--accent-mid);
}

.day-mode :deep(.loading-overlay) {
  background: var(--bg-secondary);
}

.day-mode :deep(.language-dropdown) {
  background: var(--bg-tertiary);
  border-color: var(--accent);
  box-shadow: 0 10px 40px rgba(var(--accent-rgb), 0.15);
}

.day-mode :deep(.locale-option) {
  color: var(--text-primary);
}

.day-mode :deep(.locale-option:hover) {
  background: rgba(var(--accent-rgb), 0.15);
}

.day-mode :deep(.locale-option.active) {
  background: rgba(var(--accent-rgb), 0.1);
}

.day-mode :deep(.locale-english) {
  color: var(--text-muted);
}

.day-mode :deep(.check-icon) {
  color: var(--accent);
}

/* Hero section */
.day-mode .hero-title {
  color: var(--text-primary);
  text-shadow: none;
}

.day-mode .title-accent {
  color: var(--accent);
  text-shadow: none;
}

.day-mode .hero-subtitle {
  color: var(--text-secondary);
  text-shadow: none;
}

.day-mode .trust-tag {
  color: var(--text-secondary);
}

.day-mode .tag-dot {
  background: var(--accent);
}

/* CTA Buttons */
.day-mode .cta-primary {
  color: #FFFFFF;
  /* Blue glow top-right, black center */
  --grd-pos-x: 100%;
  --grd-pos-y: 0%;
  --grd-spread-x: 120.24%;
  --grd-spread-y: 103.18%;
  --grd-c1: var(--accent-mid);
  --grd-c2: var(--accent);
  --grd-c3: var(--accent-dark);
  --grd-c4: #010e60;
  --grd-c5: #000000;
  --grd-s1: 0%;
  --grd-s2: 8.8%;
  --grd-s3: 21.44%;
  --grd-s4: 71.34%;
  --grd-s5: 85.76%;
  box-shadow: 0 4px 15px rgba(var(--accent-rgb), 0.2);
}

.day-mode .cta-primary:hover {
  /* Vivid blue on hover */
  --grd-c1: var(--accent-mid);
  --grd-c2: var(--accent);
  --grd-c3: var(--accent-dark);
  --grd-c4: #010e60;
  --grd-c5: #000520;
  box-shadow: 0 8px 25px rgba(var(--accent-rgb), 0.35);
}

.day-mode .cta-primary::before {
  opacity: 0.4;
}

.day-mode .cta-primary:hover::before {
  opacity: 0.7;
}

.day-mode .cta-secondary {
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.1);
  border-color: var(--accent);
}

.day-mode .cta-secondary:hover {
  background: rgba(var(--accent-rgb), 0.2);
}

.day-mode .scroll-arrow {
  color: var(--accent);
}

.day-mode .scroll-indicator-text {
  color: var(--accent);
}

/* Day mode hero overrides */
.day-mode .hero-description-line {
  color: var(--accent);
}

.day-mode .hero-description-tagline {
  color: var(--accent);
}

/* Section styles */
.day-mode .section-tag {
  color: var(--accent);
  border-color: rgba(var(--accent-rgb), 0.4);
  background: rgba(255, 255, 255, 0.8);
}

.day-mode .section-title {
  color: var(--accent);
}

.day-mode .section-subtitle {
  color: var(--text-secondary);
}

/* Branching section */
.day-mode .branching-section {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 1) 100%);
}

.day-mode .step-card {
  background: rgba(255, 255, 255, 0.9);
  border-color: var(--border-subtle);
}

.day-mode .step-number {
  color: var(--accent);
}

.day-mode .step-header,
.day-mode .step-title {
  color: var(--accent);
}

.day-mode .step-description {
  color: var(--text-secondary);
}

.day-mode .step-of {
  color: var(--accent);
}

.day-mode .viz-sidebar {
  background: rgba(255, 255, 255, 0.95);
  border-color: var(--border-subtle);
}

.day-mode .sidebar-title {
  color: var(--accent);
}

.day-mode .sidebar-description {
  color: var(--accent);
}

.day-mode .step-indicator {
  color: var(--accent);
}

/* Branch navigation */
.day-mode .branch-nav-item {
  background: rgba(255, 255, 255, 0.95);
  border-color: var(--border-subtle);
  color: var(--text-secondary);
}

.day-mode .branch-nav-item:hover {
  border-color: var(--accent);
}

.day-mode .branch-nav-item.sub-branch::before,
.day-mode .branch-nav-item.sub-branch::after {
  background: var(--accent);
}

.day-mode .branch-nav-item.active {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.08);
}

.day-mode .branch-title {
  color: var(--accent);
}

.day-mode .branch-subtitle {
  color: var(--text-secondary);
}

/* Chat messages */
.day-mode .chat-container {
  background: rgba(255, 255, 255, 0.9);
  border-color: var(--border-subtle);
}

.day-mode .chat-message {
  background: rgba(255, 255, 255, 0.95);
  border-color: #C0D4E8;
}

.day-mode .chat-message.user {
  background: rgba(var(--accent-rgb), 0.1);
}

.day-mode .chat-message.from-main {
  background: rgba(200, 215, 235, 0.3);
}

.day-mode .chat-message.out-of-context {
  background: rgba(255, 255, 255, 0.7);
}

.day-mode .message-role {
  color: var(--accent);
}

.day-mode .message-content {
  color: var(--accent);
}

.day-mode .chat-message.out-of-context .message-content {
  color: var(--text-secondary);
}

.day-mode .message-content p {
  color: var(--accent);
}

.day-mode .chat-message.out-of-context .message-content p {
  color: var(--text-secondary);
}

/* Branch point indicator */
.day-mode .branch-point-line {
  background: linear-gradient(90deg, transparent, rgba(var(--accent-rgb), 0.5), transparent);
}

.day-mode .branch-point-label {
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.1);
  border-color: rgba(var(--accent-rgb), 0.3);
}

/* Context toggle */
.day-mode .context-toggle {
  border: none;
  background: transparent;
  color: var(--text-secondary);
}

.day-mode .context-toggle.active {
  background: transparent;
  border: none;
  color: #22c55e;
}

.day-mode .context-toggle-all {
  color: var(--text-secondary);
}

.day-mode .context-toggle-all:hover {
  color: var(--accent);
}

/* Flip section / Branching diagram */
.day-mode .branching-diagram {
  background: rgba(255, 255, 255, 0.9);
  border-color: var(--border-subtle);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.1),
    inset 0 0 0 1px rgba(var(--accent-rgb), 0.1);
}

.day-mode .chat-demo {
  background: rgba(255, 255, 255, 0.98);
  border-color: var(--border-subtle);
}

.day-mode .chat-sidebar {
  background: white;
  border-color: var(--border-subtle);
}

.day-mode .chat-sidebar-header {
  color: var(--text-secondary);
  border-color: var(--border-subtle);
}

.day-mode .flip-back-btn {
  background: rgba(var(--accent-rgb), 0.1);
  border-color: var(--accent);
  color: var(--accent);
}

.day-mode .flip-back-btn:hover {
  background: rgba(var(--accent-rgb), 0.2);
  border-color: var(--accent);
}

.day-mode .branch-nav-title {
  color: var(--accent);
}

.day-mode .branch-nav-subtitle {
  color: var(--text-secondary);
}

.day-mode .chat-main {
  background: rgba(255, 255, 255, 0.95);
}

.day-mode .chat-header {
  background: rgba(245, 248, 255, 0.9);
  border-color: var(--border-subtle);
  color: var(--accent);
}

.day-mode .chat-header-title {
  color: var(--accent);
}

.day-mode .chat-messages {
  background: rgba(255, 255, 255, 0.95);
}

.day-mode .chat-messages::-webkit-scrollbar-track {
  background: rgba(var(--accent-rgb), 0.1);
}

.day-mode .chat-messages::-webkit-scrollbar-thumb {
  background: rgba(var(--accent-rgb), 0.4);
}

.day-mode .chat-messages::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--accent-rgb), 0.6);
}

/* Viz indicators */
.day-mode .viz-indicator {
  background: rgba(255, 255, 255, 0.95);
  border-color: var(--border-subtle);
}

.day-mode .viz-dot {
  background: var(--border-subtle);
}

.day-mode .viz-dot.active {
  background: var(--accent);
}

/* Feature cards */
.day-mode .feature-card {
  background: rgba(255, 255, 255, 0.5);
  border-color: var(--border-subtle);
}

.day-mode .feature-card:hover {
  border-color: var(--accent);
  background: rgba(255, 255, 255, 1);
}

.day-mode .feature-number {
  color: var(--accent);
}

.day-mode .feature-icon {
  color: var(--accent);
}

.day-mode .feature-title {
  color: var(--accent);
}

.day-mode .feature-description {
  color: var(--text-secondary);
}

/* FAQ section */
.day-mode .faq-item {
  border-color: var(--border-subtle);
}

.day-mode .faq-question {
  color: var(--accent);
  background: rgba(255, 255, 255, 0.8);
}

.day-mode .faq-question:hover {
  background: rgba(255, 255, 255, 1);
  color: var(--accent);
}

.day-mode .faq-num {
  color: var(--accent);
}

.day-mode .faq-chevron {
  color: var(--accent);
}

.day-mode .faq-icon {
  color: var(--accent);
}

.day-mode .faq-answer {
  color: var(--accent);
  background: rgba(255, 255, 255, 0.95);
}

.day-mode .faq-answer p {
  color: var(--accent);
}

/* Footer */
.day-mode .footer {
  background: rgba(200, 215, 235, 0.3);
  border-color: var(--border-subtle);
}

.day-mode .footer-text {
  color: var(--text-secondary);
}

.day-mode .footer-link {
  color: var(--accent);
}

.day-mode .footer-section {
  border-color: var(--border-subtle);
}

/* Mobile tabs */
.day-mode .mobile-chat-tabs {
  background: rgba(245, 248, 255, 0.9);
  border-color: var(--border-subtle);
}

.day-mode .mobile-tab {
  color: var(--accent);
  border-color: var(--border-subtle);
  background: rgba(255, 255, 255, 0.9);
}

.day-mode .mobile-tab.active {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.1);
}

/* Step dots */
.day-mode .step-dot {
  background: rgba(var(--accent-rgb), 0.2);
  border-color: rgba(var(--accent-rgb), 0.3);
}

.day-mode .step-dot.active {
  background: var(--accent);
  border-color: var(--accent);
}

/* Continue button */
.day-mode .continue-btn {
  background: rgba(255, 255, 255, 0.98);
  border-color: var(--accent);
  color: var(--accent);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.day-mode .continue-btn:hover {
  background: rgba(var(--accent-rgb), 0.1);
  border-color: var(--accent);
  box-shadow: 0 0 20px rgba(var(--accent-rgb), 0.4);
}

/* Branch labels */
.day-mode .branch-label-main {
  background: rgba(var(--accent-rgb), 0.1);
  border: 1px solid rgba(var(--accent-rgb), 0.3);
  color: var(--accent);
}

/* Main branch path in diagram SVG */
.day-mode .main-path {
  stroke: var(--accent) !important;
}

/* Start and end nodes on main branch */
.day-mode .start-node {
  fill: var(--accent) !important;
}

.day-mode .end-node {
  fill: var(--accent) !important;
}

/* Traveling dot on main branch */
.day-mode .traveling-dot-main {
  fill: var(--accent) !important;
}

/* Label dot for main branch */
.day-mode .label-dot.main {
  background: var(--accent);
}

/* Branch nodes - override inline SVG colors */
.day-mode .branch-node circle {
  stroke: var(--accent);
  fill: var(--accent);
}

.day-mode .branch-node circle[fill="transparent"] {
  fill: transparent;
}

/* Branch button styling */
.day-mode .branch-button {
  color: var(--accent);
}

.section-container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 2rem;
  position: relative;
  z-index: 1;
}

.section-header {
  text-align: center;
  margin-bottom: 3rem;
}

.section-tag {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--accent);
  padding: 0.4rem 0.8rem;
  border: 2px solid var(--accent);
  margin-bottom: 1rem;
}

.section-title {
  font-size: clamp(2rem, 4.5vw, 2.75rem);
  font-weight: 500;
  margin-bottom: 0.75rem;
  color: var(--text-primary);
}

.section-subtitle {
  color: var(--text-description);
  font-size: 1.125rem;
  font-weight: 300;
}

/* ============================================================================= */
/* HERO SECTION — Scroll-Driven Cinematic Reveal */
/* ============================================================================= */
.hero-section {
  height: 300svh;
  position: relative;
  z-index: 1;
  overflow: visible;
}

/* Fixed layer: title + description + trust tags */
.hero-fixed-layer {
  position: fixed;
  inset: 0;
  top: 60px;
  z-index: 2;
  pointer-events: none;
  transition: opacity 0.3s ease, visibility 0.3s ease;
  overflow: hidden;
}

.hero-fixed-layer--done {
  opacity: 0;
  visibility: hidden;
}

/* --- Stamp Logo + Horizontal Title --- */
.hero-title-container {
  position: absolute;
  top: 48%;
  left: 4rem;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 2;
  overflow: visible;
}

.hero-stamp-wrapper {
  position: relative;
  width: 200px;
  height: 200px;
}

.hero-stamp-img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

/* Tile grid overlay — sits on top of stamp, same size/position */
.tile-grid-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-template-rows: repeat(6, 1fr);
  z-index: 1;
  perspective: 800px;
  pointer-events: none;
}

.reveal-tile {
  background: var(--bg-primary);
  transform-origin: center center;
  transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease 0.2s;
  backface-visibility: hidden;
  opacity: 1;
  margin: -0.5px;
}

.reveal-tile.flipped {
  transform: rotateY(90deg);
  opacity: 0;
}

.hero-title-letters {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin: 1rem 0 0;
  padding: 0;
  white-space: nowrap;
}

.title-letter-img {
  height: 3.2rem;
  width: auto;
  pointer-events: none;
  user-select: none;
  will-change: opacity, transform;
}


/* --- Subtitle Reveal (right side, near top) --- */
.hero-subtitle-reveal {
  position: absolute;
  top: 2rem;
  right: 6rem;
  z-index: 2;
  text-align: right;
  will-change: opacity, transform;
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
  max-width: 50vw;
}

/* --- Tagline Reveal (right side, centered) --- */
.hero-tagline-reveal {
  position: absolute;
  top: 50%;
  right: 6rem;
  transform: translateY(-50%);
  z-index: 2;
  text-align: right;
  will-change: opacity, transform;
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
  max-width: 50vw;
}

.hero-description-line {
  font-size: clamp(1.5rem, 3vw, 2.5rem);
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
  margin: 0;
}

.hero-description-tagline {
  font-size: clamp(1.2rem, 2vw, 1.8rem);
  font-weight: 300;
  color: var(--accent);
  margin-top: 1.5rem;
  font-family: var(--font-mono);
  letter-spacing: 0.1em;
}

/* --- Trust Tags (positioned below description) --- */
.hero-section .trust-tags {
  position: absolute;
  bottom: 8rem;
  right: 6rem;
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
  z-index: 2;
  will-change: opacity;
  transition: opacity 0.6s ease-out;
  margin-top: 0;
}

/* --- CTAs at bottom of viewport --- */
.hero-ctas {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  align-items: center;
  justify-content: center;
  z-index: 3;
  pointer-events: auto;
  transition: opacity 0.3s ease, visibility 0.3s ease;
}

.hero-ctas--done {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

/* On small screens: arrow goes last */
.hero-ctas .scroll-indicator {
  order: 3;
}

.hero-ctas .cta-secondary {
  order: 2;
}

@media (min-width: 640px) {
  .hero-ctas {
    bottom: 3rem;
  }
}

@media (min-width: 768px) {
  .hero-ctas {
    gap: 3rem;
  }
}

/* Responsive hero */
@media (max-width: 1024px) {
  .hero-title-container {
    left: 2rem;
  }

  .hero-stamp-wrapper {
    width: 160px;
    height: 160px;
  }

  .title-letter-img {
    height: 2.6rem;
  }

  .hero-subtitle-reveal,
  .hero-tagline-reveal {
    right: 3rem;
  }

  .hero-section .trust-tags {
    right: 3rem;
  }
}

@media (max-width: 768px) {
  .hero-section {
    height: 250svh;
  }

  /* Title container: centered near top with stamp + letters side by side */
  .hero-title-container {
    left: 0;
    right: 0;
    top: 0.5rem;
    transform: none;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }

  .hero-stamp-wrapper {
    width: 120px;
    height: 120px;
  }

  .hero-title-letters {
    margin-top: 0;
  }

  .title-letter-img {
    height: 2.8rem;
  }

  /* Trust tags below the parallax */
  .hero-section .trust-tags {
    position: absolute;
    top: 72svh;
    bottom: auto;
    right: 1rem;
    left: 1rem;
    justify-content: center;
  }

  /* Subtitle ("Branch your conversation") below the parallax */
  .hero-subtitle-reveal {
    top: 78svh;
    bottom: auto;
    right: 1rem;
    left: 1rem;
    text-align: center;
    max-width: none;
  }

  /* Tagline below subtitle */
  .hero-tagline-reveal {
    top: 84svh;
    bottom: auto;
    right: 1rem;
    left: 1rem;
    text-align: center;
    max-width: none;
  }

  .hero-description-line {
    font-size: 1.3rem;
  }

  .hero-description-tagline {
    font-size: 1rem;
    margin-top: 0.5rem;
  }

  .hero-ctas {
    /* Right edge — vertical position driven by scrollIndicatorStyle */
    left: auto;
    bottom: auto;
    right: 0.5rem;
    gap: 0;
  }

  .hero-ctas .cta-primary {
    display: none;
  }

  .hero-ctas .scroll-indicator {
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .hero-ctas .scroll-indicator-text {
    writing-mode: vertical-rl;
    font-size: 0.6rem;
    letter-spacing: 0.15em;
  }

  .hero-ctas .scroll-arrow {
    width: 24px;
    height: 24px;
  }

  /* Scale down parallax frame for small screens but keep it square */
  .parallax-frame {
    width: min(70vw, 70svh);
    height: min(70vw, 70svh);
  }
}

@media (max-width: 480px) {
  .hero-stamp-wrapper {
    width: 90px;
    height: 90px;
  }

  .title-letter-img {
    height: 2rem;
  }

  .hero-section .trust-tags {
    top: 68svh;
  }

  .parallax-frame {
    width: min(82vw, 80svh);
    height: min(82vw, 80svh);
  }
}

.cta-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem 2.25rem;
  min-width: 200px;
  white-space: nowrap;
  font-family: var(--font-sans);
  font-size: 1rem;
  font-weight: 700;
  line-height: 19px;
  color: #FFFFFF;
  border-radius: 11px;
  cursor: pointer;
  position: relative;

  /* Default: dark gold/amber */
  --grd-pos-x: 11.14%;
  --grd-pos-y: 140%;
  --grd-spread-x: 150%;
  --grd-spread-y: 180.06%;
  --grd-c1: #000000;
  --grd-c2: #1a0e00;
  --grd-c3: #4a2e0a;
  --grd-c4: #6b4a1a;
  --grd-c5: #8b6914;
  --grd-s1: 37.35%;
  --grd-s2: 61.36%;
  --grd-s3: 78.42%;
  --grd-s4: 89.52%;
  --grd-s5: 100%;
  background: radial-gradient(
    var(--grd-spread-x) var(--grd-spread-y) at var(--grd-pos-x) var(--grd-pos-y),
    var(--grd-c1) var(--grd-s1),
    var(--grd-c2) var(--grd-s2),
    var(--grd-c3) var(--grd-s3),
    var(--grd-c4) var(--grd-s4),
    var(--grd-c5) var(--grd-s5)
  );

  border: none;

  transition:
    --grd-pos-x 0.5s, --grd-pos-y 0.5s,
    --grd-spread-x 0.5s, --grd-spread-y 0.5s,
    --grd-c1 0.5s, --grd-c2 0.5s, --grd-c3 0.5s, --grd-c4 0.5s, --grd-c5 0.5s,
    --grd-s1 0.5s, --grd-s2 0.5s, --grd-s3 0.5s, --grd-s4 0.5s, --grd-s5 0.5s,
    transform 0.3s ease, box-shadow 0.3s ease;

  box-shadow:
    0 4px 15px rgba(139, 105, 20, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.cta-primary::before {
  content: "";
  position: absolute;
  inset: 8px 8px -8px;
  background: radial-gradient(
    var(--grd-spread-x) var(--grd-spread-y) at var(--grd-pos-x) var(--grd-pos-y),
    var(--grd-c1), var(--grd-c3), var(--grd-c5)
  );
  filter: blur(16px);
  border-radius: inherit;
  z-index: -1;
  opacity: 0.3;
  transition: opacity 0.5s ease, filter 0.5s ease;
}

.cta-primary:hover {
  /* Hover: vivid gold/orange glow from bottom-left */
  --grd-pos-x: 0%;
  --grd-pos-y: 91.51%;
  --grd-spread-x: 120.24%;
  --grd-spread-y: 103.18%;
  --grd-c1: #e7a832;
  --grd-c2: #d4871a;
  --grd-c3: #c06a10;
  --grd-c4: #3a1e05;
  --grd-c5: #000000;
  --grd-s1: 0%;
  --grd-s2: 8.8%;
  --grd-s3: 21.44%;
  --grd-s4: 71.34%;
  --grd-s5: 85.76%;
  transform: translateY(-2px);
  box-shadow:
    0 8px 25px rgba(231, 168, 50, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.cta-primary:hover::before {
  opacity: 0.8;
  filter: blur(20px);
}

.cta-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.875rem 2rem;
  min-width: 200px;
  white-space: nowrap;
  font-family: var(--font-sans);
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--accent);
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.1) 0%, rgba(var(--accent-rgb), 0.05) 100%);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: all var(--transition-normal);
  backdrop-filter: var(--blur-md);
  -webkit-backdrop-filter: var(--blur-md);
  box-shadow: var(--shadow-sm);
}

.cta-secondary:hover {
  border-color: rgba(var(--accent-rgb), 0.7);
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.2) 0%, rgba(var(--accent-rgb), 0.1) 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(var(--accent-rgb), 0.15);
}

.cta-icon {
  width: 1.25rem;
  height: 1.25rem;
  transition: transform var(--transition-fast);
}

.cta-primary:hover .cta-icon {
  transform: translateX(4px);
}

.trust-tags {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.trust-tag {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  color: var(--text-primary);
  letter-spacing: 0.05em;
}

.tag-dot {
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: var(--radius-full);
}

/* Scroll indicator */
.scroll-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: opacity 0.6s ease;
}

.scroll-indicator-text {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent);
  transition: opacity 0.4s ease;
}

.scroll-indicator--hidden {
  opacity: 0;
  pointer-events: none;
}

.scroll-indicator-text--hidden {
  opacity: 0;
  pointer-events: none;
}

.scroll-arrow {
  width: 32px;
  height: 32px;
  color: var(--accent);
  animation: bounce 2s infinite;
}

.scroll-arrow svg {
  width: 100%;
  height: 100%;
}

@keyframes bounce {
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(10px);
  }
  60% {
    transform: translateY(5px);
  }
}

/* ============================================================================= */
/* BRANCHING VISUALIZATION (HOW IT WORKS) */
/* ============================================================================= */
.branching-section {
  min-height: 100svh;
  padding: 4rem 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  z-index: 1;
  background: var(--bg-primary);
}

.branching-layout {
  display: flex;
  gap: 2rem;
  align-items: stretch;
}

/* Sidebar */
.viz-sidebar {
  flex-shrink: 0;
  width: 280px;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: var(--blur-lg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
}

.step-indicator {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.step-number {
  font-family: var(--font-mono);
  font-size: 3rem;
  font-weight: 600;
  color: var(--accent);
  line-height: 1;
}

.step-of {
  font-family: var(--font-mono);
  font-size: 1rem;
  color: var(--text-secondary);
}

.sidebar-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.sidebar-description {
  font-size: 1rem;
  color: var(--text-description);
  line-height: 1.6;
  flex: 1;
}

/* Text reveal animation */
.animate-text {
  animation: textReveal 0.6s ease-out forwards;
  opacity: 0;
}

.animate-text.delay-1 {
  animation-delay: 0.15s;
}

.animate-text.delay-2 {
  animation-delay: 0.3s;
}

@keyframes textReveal {
  0% {
    opacity: 0;
    transform: translateX(-20px);
  }
  100% {
    opacity: 1;
    transform: translateX(0);
  }
}

.step-dots {
  display: flex;
  gap: 0.75rem;
  margin-top: 2rem;
}

.step-dot {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
  background: rgba(var(--accent-rgb), 0.2);
  border: 2px solid rgba(var(--accent-rgb), 0.3);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.step-dot.active {
  background: var(--accent);
  border-color: var(--accent);
}

.step-dot.current {
  box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.2);
}

/* Flip Container */
.flip-container {
  flex: 1;
  perspective: 2000px;
  min-height: 500px;
}

.flip-inner {
  position: relative;
  width: 100%;
  height: 500px;
  transition: transform 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  transform-style: preserve-3d;
}

.flip-container.flipped .flip-inner {
  transform: rotateY(180deg);
}

.flip-front,
.flip-back {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.flip-back {
  transform: rotateY(180deg);
}

/* Diagram container */
.branching-diagram {
  position: relative;
  color: var(--accent);
  background: rgba(10, 10, 10, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-xl);
  overflow: hidden;
  backdrop-filter: var(--blur-sm);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}

/* Chat Demo (Back of flip) */
.chat-demo {
  display: flex;
  background: rgba(10, 10, 10, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

/* Hide mobile tabs on larger screens */
.mobile-chat-tabs {
  display: none;
}

.chat-sidebar {
  width: 220px;
  background: rgba(0, 0, 0, 0.4);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  padding: 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.chat-sidebar-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem 1rem;
  color: var(--text-description);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 0.5rem;
}

.flip-back-btn {
  margin-left: auto;
  width: 24px;
  height: 24px;
  padding: 4px;
  background: rgba(var(--accent-rgb), 0.1);
  border: 1px solid rgba(var(--accent-rgb), 0.3);
  border-radius: var(--radius-sm);
  color: var(--accent);
  cursor: pointer;
  transition: all 0.2s ease;
}

.flip-back-btn:hover {
  background: rgba(var(--accent-rgb), 0.2);
  border-color: rgba(var(--accent-rgb), 0.5);
}

.flip-back-btn svg {
  width: 100%;
  height: 100%;
}

.sidebar-icon {
  width: 16px;
  height: 16px;
}

.branch-nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background 0.2s ease;
  position: relative;
}

.branch-nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.branch-nav-item.active {
  background: rgba(var(--accent-rgb), 0.1);
}

.branch-nav-item.sub-branch {
  padding-left: 2rem;
}

/* Tree lines for sub-branches */
.branch-nav-item.sub-branch::before {
  content: '';
  position: absolute;
  left: 1.25rem;
  top: 0;
  bottom: 50%;
  width: 1px;
  background: rgba(var(--accent-rgb), 0.3);
}

.branch-nav-item.sub-branch::after {
  content: '';
  position: absolute;
  left: 1.25rem;
  top: 50%;
  width: 0.5rem;
  height: 1px;
  background: rgba(var(--accent-rgb), 0.3);
}

/* Extend vertical line for non-last items */
.branch-nav-item.sub-branch:not(:last-child)::before {
  bottom: 0;
}

.branch-nav-indicator {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.branch-nav-indicator.main {
  background: var(--accent);
}

.branch-nav-indicator.legal {
  background: #93C5FD;
}

.branch-nav-indicator.copy {
  background: #F9A8D4;
}

.branch-nav-indicator.ux {
  background: #FDBA74;
}

.branch-nav-content {
  flex: 1;
  min-width: 0;
}

.branch-nav-title {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.branch-nav-subtitle {
  display: block;
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.context-toggle-all {
  width: 20px;
  height: 20px;
  padding: 2px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.branch-nav-item:hover .context-toggle-all {
  opacity: 1;
}

.context-toggle-all:hover {
  color: var(--accent);
}

.context-toggle-all.all-active {
  color: #22c55e;
  opacity: 1;
}

.context-toggle-all.just-toggled {
  animation: togglePulse 0.4s ease-out;
}

/* Branch context status indicators */
.branch-nav-item.context-all {
  border-left: 3px solid #22c55e;
}

.branch-nav-item.context-some {
  border-left: 3px solid #eab308;
}

.branch-nav-item.context-none {
  border-left: 3px solid #929ca9;
}

.branch-nav-item.context-added {
  animation: flashGreen 0.5s ease-out;
}

.branch-nav-item.context-removed {
  animation: flashRed 0.5s ease-out;
}

/* Chat Messages */
.chat-messages {
  flex: 1;
  overflow-y: scroll;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
}

/* Custom scrollbar styling */
.chat-messages::-webkit-scrollbar {
  width: 8px;
}

.chat-messages::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-sm);
}

.chat-messages::-webkit-scrollbar-thumb {
  background: rgba(var(--accent-rgb), 0.3);
  border-radius: var(--radius-sm);
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--accent-rgb), 0.5);
}

.chat-messages-inner {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.chat-message {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
  padding-left: 1rem;
  border-radius: var(--radius-lg);
  transition: opacity 0.3s ease, background 0.2s ease, border-color 0.3s ease;
  position: relative;
  border-left: 3px solid #22c55e;
}

.chat-message:hover {
  background: rgba(255, 255, 255, 0.03);
}

.chat-message.out-of-context {
  opacity: 0.5;
  border-left-color: var(--text-secondary);
}

.chat-message.from-main {
  border-left-color: rgba(var(--accent-rgb), 0.5);
}

.chat-message.from-main.out-of-context {
  border-left-color: rgba(100, 116, 139, 0.5);
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.chat-message.user .message-avatar {
  background: rgba(147, 197, 253, 0.2);
  color: #93C5FD;
}

.chat-message.assistant .message-avatar {
  background: rgba(var(--accent-rgb), 0.2);
  color: var(--accent);
}

.message-avatar svg {
  width: 18px;
  height: 18px;
}

.message-content {
  flex: 1;
  min-width: 0;
}

.message-content p {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--text-primary);
}

.context-toggle {
  width: 24px;
  height: 24px;
  padding: 4px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 1;
  transition: all 0.2s ease;
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 4px;
}

.context-toggle.active {
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.1);
}

.context-toggle:not(.active) {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}

.context-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
}

.context-toggle svg {
  width: 100%;
  height: 100%;
}

/* Context toggle animation */
.context-toggle.just-toggled {
  animation: togglePulse 0.4s ease-out;
}

@keyframes togglePulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.3);
  }
  100% {
    transform: scale(1);
  }
}

/* Message flash when context changes */
.chat-message.context-added {
  animation: flashGreen 0.5s ease-out;
}

.chat-message.context-removed {
  animation: flashRed 0.5s ease-out;
}

@keyframes flashGreen {
  0% {
    background: rgba(34, 197, 94, 0.3);
  }
  100% {
    background: transparent;
  }
}

@keyframes flashRed {
  0% {
    background: rgba(239, 68, 68, 0.3);
  }
  100% {
    background: transparent;
  }
}

/* Branch point indicator */
.branch-point-indicator {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1rem 0;
  padding: 0 0.5rem;
}

.branch-point-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(var(--accent-rgb), 0.3), transparent);
}

.branch-point-label {
  font-size: 0.75rem;
  color: var(--accent);
  white-space: nowrap;
  padding: 0.25rem 0.75rem;
  background: rgba(var(--accent-rgb), 0.1);
  border-radius: 0;
  border: 1px solid rgba(var(--accent-rgb), 0.2);
}

.diagram-svg {
  width: 100%;
  height: auto;
  min-height: 400px;
}

.grid-line {
  stroke: rgba(var(--accent-rgb), 0.06);
}

/* Branch paths with hover effect */
.branch-path {
  transition: stroke-width 0.3s ease, filter 0.3s ease;
}

.main-path {
  transition: stroke-width 0.3s ease;
}

/* Highlight glow effect */
.highlight-glow {
  filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.8)) drop-shadow(0 0 16px rgba(255, 255, 255, 0.5));
  opacity: 0.95;
  pointer-events: none;
}

/* Traveling highlight animation for main branch */
.highlight-travel {
  stroke-dasharray: var(--path-length);
  stroke-dashoffset: var(--path-length);
  animation: travelHighlight 0.4s ease-out forwards;
}

/* Traveling highlight animation for side branches (delayed) */
.highlight-travel-branch {
  stroke-dasharray: var(--path-length);
  stroke-dashoffset: var(--path-length);
  animation: travelHighlight 0.5s ease-out 0.3s forwards;
  opacity: 0;
}

@keyframes travelHighlight {
  0% {
    stroke-dashoffset: var(--path-length);
    opacity: 0.95;
  }
  100% {
    stroke-dashoffset: 0;
    opacity: 0.95;
  }
}

/* Highlighted branch group */
.branch-group.highlighted .branch-path {
  stroke-width: 4;
}

/* Branch group visibility and animation */
.branch-group {
  opacity: 0;
  transition: opacity 0.6s ease;
}

.branch-group.visible {
  opacity: 1;
}

.branch-group.animating .branch-path {
  stroke-dasharray: 1000;
  stroke-dashoffset: 1000;
  animation: drawPath 0.8s ease forwards;
}

@keyframes drawPath {
  to {
    stroke-dashoffset: 0;
  }
}

/* Branch node styling */
.branch-node {
  cursor: default;
}

/* Interactive branch button */
.branch-button {
  cursor: pointer;
}

/* Animated button group - moves entire group using transform */
.animated-button-group {
  transition: transform 0.6s ease-in-out;
}

.animated-button-group.step-1 {
  transform: translate(300px, 280px);
}

/* Continue button wrapper */
.continue-btn-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

/* Continue button */
.continue-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  background: rgba(10, 10, 10, 0.95);
  border: 2px solid var(--accent);
  border-radius: 0;
  color: var(--accent);
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s ease;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.continue-btn:hover {
  background: rgba(var(--accent-rgb), 0.15);
  border-color: var(--accent);
  box-shadow: 0 0 20px rgba(var(--accent-rgb), 0.4);
}

.continue-btn svg {
  width: 18px;
  height: 18px;
  transition: transform 0.25s ease;
}

.continue-btn:hover svg {
  transform: translateX(3px);
}

/* Traveling dots animation */
.traveling-dot {
  opacity: 0.9;
}

/* Branch labels */
.branch-label {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 0;
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 500;
  backdrop-filter: var(--blur-lg);
  width: fit-content;
  opacity: 1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.branch-label.fade-in {
  animation: fadeInLabel 0.6s ease-out forwards;
}

@keyframes fadeInLabel {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.branch-label-main {
  background: rgba(var(--accent-rgb), 0.1);
  border: 1px solid rgba(var(--accent-rgb), 0.3);
  color: var(--accent);
}

.branch-label-legal {
  background: rgba(147, 197, 253, 0.15);
  border: 1px solid rgba(147, 197, 253, 0.4);
  color: #93C5FD;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.branch-label-legal:hover {
  transform: translateX(4px);
  box-shadow: 0 6px 20px rgba(147, 197, 253, 0.3);
}

.branch-label-copy {
  background: rgba(249, 168, 212, 0.15);
  border: 1px solid rgba(249, 168, 212, 0.4);
  color: #F9A8D4;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.branch-label-copy:hover {
  transform: translateX(4px);
  box-shadow: 0 6px 20px rgba(249, 168, 212, 0.3);
}

.branch-label-ux {
  background: rgba(253, 186, 116, 0.15);
  border: 1px solid rgba(253, 186, 116, 0.4);
  color: #FDBA74;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.branch-label-ux:hover {
  transform: translateX(4px);
  box-shadow: 0 6px 20px rgba(253, 186, 116, 0.3);
}

.label-dot {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.label-dot.main {
  background: var(--accent);
}

.label-dot.legal {
  background: #93C5FD;
}

.label-dot.copy {
  background: #F9A8D4;
}

.label-dot.ux {
  background: #FDBA74;
}

/* Responsive adjustments for branching section */
@media (max-width: 1024px) {
  .branching-section {
    padding: 1.5rem 0;
    min-height: 100svh;
    max-height: 100svh;
    overflow: hidden;
    box-sizing: border-box;
  }

  .branching-section .section-container {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .branching-section .section-header {
    margin-bottom: 1rem;
    flex-shrink: 0;
  }

  .branching-section .section-title {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
  }

  .branching-section .section-subtitle {
    font-size: 0.9rem;
  }

  .branching-layout {
    flex-direction: column;
    gap: 0.75rem;
    flex: 1;
    min-height: 0;
  }

  .viz-sidebar {
    width: 100%;
    order: 1;
    padding: 0.75rem 1rem;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    flex-shrink: 0;
  }

  .step-indicator {
    margin-bottom: 0;
  }

  .sidebar-title {
    margin-bottom: 0;
    font-size: 1.1rem;
  }

  .sidebar-description {
    flex: 1 1 100%;
    margin-bottom: 0;
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .step-dots {
    margin-top: 0;
  }

  .flip-container {
    order: 2;
    min-height: 0;
    flex: 1;
  }

  .flip-inner {
    height: 100%;
  }

  .branching-diagram {
    order: 2;
  }
}

@media (max-width: 768px) {
  .branching-section {
    padding: 1.5rem 0;
    min-height: auto;
  }

  .branching-section .section-header {
    margin-bottom: 1rem;
  }


  .branching-section .section-title {
    font-size: 1.4rem;
    margin-bottom: 0.5rem;
  }

  .branching-section .section-subtitle {
    font-size: 0.875rem;
    display: none;
  }

  .branching-layout {
    gap: 0.75rem;
  }

  .viz-sidebar {
    padding: 0.75rem 1rem;
    border-radius: var(--radius-lg);
    gap: 0.5rem;
  }

  .step-indicator {
    gap: 0.25rem;
  }

  .step-number {
    font-size: 1.5rem;
  }

  .step-of {
    font-size: 0.7rem;
  }

  .sidebar-title {
    font-size: 1rem;
  }

  .sidebar-description {
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .step-dots {
    gap: 0.4rem;
  }

  .step-dot {
    width: 8px;
    height: 8px;
  }

  .flip-container {
    min-height: 250px;
    flex: 1;
  }

  .flip-inner {
    height: 100%;
    min-height: 250px;
  }

  .diagram-svg {
    min-height: 200px;
  }

  /* Step 3 Chat Demo - Mobile Tab Layout */
  .chat-demo {
    flex-direction: column;
  }

  .mobile-chat-tabs {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.4);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .mobile-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.5rem 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-md);
    color: var(--text-description);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .mobile-tab svg {
    width: 14px;
    height: 14px;
  }

  .mobile-tab.active {
    background: rgba(var(--accent-rgb), 0.15);
    border-color: rgba(var(--accent-rgb), 0.4);
    color: var(--accent);
  }

  .mobile-tab.flip-btn {
    flex: 0;
    padding: 0.5rem;
  }

  .mobile-tab.flip-btn svg {
    width: 16px;
    height: 16px;
  }

  .chat-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: none;
    flex: 1;
    max-height: none;
    overflow-y: auto;
  }

  .chat-sidebar .chat-sidebar-header {
    display: none;
  }

  .chat-sidebar.mobile-hidden {
    display: none;
  }

  .chat-messages {
    flex: 1;
    max-height: none;
  }

  .chat-messages.mobile-hidden {
    display: none;
  }

  .branch-label {
    font-size: 0.7rem;
    padding: 0.25rem 0.5rem;
  }
}

@media (max-width: 480px) {
  .branching-section {
    padding: 1rem 0;
  }

  .branching-section .section-container {
    padding: 0 1rem;
  }

  .branching-section .section-title {
    font-size: 1.2rem;
  }

  .viz-sidebar {
    padding: 0.5rem 0.75rem;
  }

  .sidebar-description {
    font-size: 0.75rem;
  }

  .flip-container {
    min-height: 200px;
  }

  .flip-inner {
    min-height: 200px;
  }
}

/* ============================================================================= */
/* FEATURES SECTION */
/* ============================================================================= */
.features-section {
  padding: 6rem 0;
  position: relative;
  z-index: 1;
  background: var(--bg-primary);
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}

.feature-card {
  background: rgba(20, 20, 20, 0.5);
  border: 1px solid rgba(var(--accent-rgb), 0.15);
  padding: 1.5rem;
  position: relative;
  transition: all var(--transition-normal);
}

.feature-card:hover {
  border-color: rgba(var(--accent-rgb), 0.4);
  background: rgba(20, 20, 20, 0.8);
}

.feature-number {
  position: absolute;
  top: 1rem;
  right: 1rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: rgba(var(--accent-rgb), 0.4);
}

.feature-icon {
  width: 40px;
  height: 40px;
  color: var(--accent);
  margin-bottom: 1rem;
}

.feature-icon svg {
  width: 100%;
  height: 100%;
}

.feature-title {
  font-size: 1.25rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

.feature-description {
  font-size: 1rem;
  color: var(--text-description);
  line-height: 1.6;
}

/* ============================================================================= */
/* FAQ SECTION */
/* ============================================================================= */
.faq-section {
  padding: 6rem 0;
  position: relative;
  z-index: 1;
  background: var(--bg-primary);
}

.faq-list {
  max-width: 700px;
  margin: 0 auto;
}

.faq-item {
  border-bottom: 1px solid rgba(var(--accent-rgb), 0.15);
}

.faq-question {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 0;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 1.1rem;
  text-align: left;
  cursor: pointer;
  transition: color 0.2s ease;
}

.faq-question:hover {
  color: var(--accent);
}

.faq-num {
  font-family: var(--font-mono);
  font-size: 0.9rem;
  color: var(--text-secondary);
  padding-left: 0.5rem;
}

.faq-text {
  flex: 1;
}

.faq-chevron {
  width: 20px;
  height: 20px;
  color: var(--text-secondary);
  transition: transform 0.2s ease;
  padding-right: 0.5rem;
}

.faq-item.open .faq-chevron {
  transform: rotate(180deg);
}

.faq-answer {
  padding-bottom: 1.25rem;
  padding-left: 3rem;
}

.faq-answer p {
  color: var(--text-description);
  font-size: 1.05rem;
  line-height: 1.7;
}

/* ============================================================================= */
/* FOOTER SECTION */
/* ============================================================================= */
.footer-section {
  padding: 4rem 0;
  text-align: center;
  border-top: 1px solid rgba(var(--accent-rgb), 0.15);
  position: relative;
  z-index: 1;
  background: var(--bg-primary);
}

.footer-cta-spacing {
  margin-bottom: 1.5rem;
}

.footer-tagline {
  font-size: 1.1rem;
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
}

.footer-links {
  display: flex;
  gap: 1rem;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}

.footer-link {
  font-size: 0.95rem;
  color: var(--text-secondary);
  text-decoration: none;
  transition: color 0.2s ease;
}

a.footer-link:hover {
  color: var(--accent);
}

.footer-sep {
  color: #334155;
}

.footer-version {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: #475569;
}

/* ============================================================================= */
/* RESPONSIVE */
/* ============================================================================= */

/* ============================================================================= */
/* REDUCED MOTION */
/* ============================================================================= */
@media (prefers-reduced-motion: reduce) {
  .traveling-dot animateMotion {
    display: none;
  }

  .glow-pulse {
    animation: none;
  }

  .branch-group.animating .branch-path {
    animation: none;
    stroke-dasharray: none;
    stroke-dashoffset: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-page * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>

<!-- @property must be in non-scoped style for smooth gradient transitions -->
<style>
@property --grd-pos-x { syntax: '<percentage>'; initial-value: 11.14%; inherits: false; }
@property --grd-pos-y { syntax: '<percentage>'; initial-value: 140%; inherits: false; }
@property --grd-spread-x { syntax: '<percentage>'; initial-value: 150%; inherits: false; }
@property --grd-spread-y { syntax: '<percentage>'; initial-value: 180.06%; inherits: false; }
@property --grd-c1 { syntax: '<color>'; initial-value: #000000; inherits: false; }
@property --grd-c2 { syntax: '<color>'; initial-value: #08012c; inherits: false; }
@property --grd-c3 { syntax: '<color>'; initial-value: #4e1e40; inherits: false; }
@property --grd-c4 { syntax: '<color>'; initial-value: #70464e; inherits: false; }
@property --grd-c5 { syntax: '<color>'; initial-value: #88394c; inherits: false; }
@property --grd-s1 { syntax: '<percentage>'; initial-value: 37.35%; inherits: false; }
@property --grd-s2 { syntax: '<percentage>'; initial-value: 61.36%; inherits: false; }
@property --grd-s3 { syntax: '<percentage>'; initial-value: 78.42%; inherits: false; }
@property --grd-s4 { syntax: '<percentage>'; initial-value: 89.52%; inherits: false; }
@property --grd-s5 { syntax: '<percentage>'; initial-value: 100%; inherits: false; }
</style>
