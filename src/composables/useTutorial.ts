import { ref, computed, readonly, watchEffect, nextTick, type WatchStopHandle } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsPanel } from './useSettingsPanel'
import { getApiKey } from '@/api/settings'

// ============================================================
// Types
// ============================================================

type PopoverPosition = 'top' | 'bottom' | 'left' | 'right' | 'auto'
type TutorialId = 'quick-setup' | 'full-tour'

interface TutorialStep {
  id: string
  target: string | null
  title: string
  description: string
  position: PopoverPosition
  requiresAction?: boolean
  actionHint?: string
  waitFor?: () => boolean
  autoAdvance?: boolean
  skipToId?: string          // When autoAdvance triggers, jump to this step instead of next
  onEnter?: () => void | Promise<void>
  onExit?: () => void
  highlightPadding?: number
}

// ============================================================
// Module-level shared state
// ============================================================

const isActive = ref(false)
const currentTutorialId = ref<TutorialId | null>(null)
const currentStepIndex = ref(0)
const steps = ref<TutorialStep[]>([])
const targetRect = ref<DOMRect | null>(null)
const isTransitioning = ref(false)
const canAdvance = ref(true)
const showCompletionModal = ref(false)
const completedTutorialId = ref<TutorialId | null>(null)
let completionTimeoutId: number | null = null

// Polling tick — incremented on an interval to force watchEffect re-evaluation
// for waitFor conditions that read non-reactive sources (localStorage, DOM, etc.)
const pollTick = ref(0)
let pollIntervalId: number | null = null

function startPolling(): void {
  if (pollIntervalId !== null) return
  pollIntervalId = window.setInterval(() => { pollTick.value++ }, 500)
}

function stopPolling(): void {
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId)
    pollIntervalId = null
  }
}

// Snapshot of message count for detecting new messages during a step
let _initialMessageCount = 0

// Generic flag for detecting a click on the current step's target element
let _targetClicked = false
let _targetClickCleanup: (() => void) | null = null

function listenForTargetClick(selector: string): void {
  _targetClicked = false
  _targetClickCleanup?.()
  const el = document.querySelector(selector)
  if (!el) return
  const handler = () => { _targetClicked = true }
  el.addEventListener('click', handler, { once: true })
  _targetClickCleanup = () => el.removeEventListener('click', handler)
}

let cleanupElevation: (() => void) | null = null
let cleanupWatcher: WatchStopHandle | null = null
let resizeObserver: ResizeObserver | null = null
let scrollRafId: number | null = null
let resizeTimeoutId: number | null = null
let removeRouterGuard: (() => void) | null = null
let routerInstance: ReturnType<typeof useRouter> | null = null

// ============================================================
// localStorage persistence
// ============================================================

const STORAGE_PREFIX = 'bonsai:tutorial:'

function isTutorialCompleted(id: TutorialId): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${id}Completed`) === 'true'
  } catch {
    return false
  }
}

function markTutorialCompleted(id: TutorialId): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${id}Completed`, 'true')
  } catch { /* ignore */ }
}

function shouldAutoTriggerQuickSetup(): boolean {
  return (
    !isTutorialCompleted('quick-setup') &&
    localStorage.getItem(`${STORAGE_PREFIX}quickSetupDismissed`) !== 'true' &&
    !getApiKey()
  )
}

function markQuickSetupDismissed(): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}quickSetupDismissed`, 'true')
  } catch { /* ignore */ }
}

// ============================================================
// Element helpers
// ============================================================

async function waitForElement(selector: string, maxRetries = 10, intervalMs = 200): Promise<HTMLElement | null> {
  for (let i = 0; i < maxRetries; i++) {
    const el = document.querySelector(selector) as HTMLElement | null
    if (el) return el
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return null
}

function elevateTarget(selector: string): () => void {
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return () => {}

  const modified: Array<{ el: HTMLElement; origZ: string; origPos: string }> = []

  // Elevate the target itself
  modified.push({ el, origZ: el.style.zIndex, origPos: el.style.position })
  el.style.zIndex = '9001'
  if (getComputedStyle(el).position === 'static') {
    el.style.position = 'relative'
  }

  // Walk ancestors and neutralize stacking contexts that would trap the
  // target's z-index.  Pure z-index contexts are dissolved (set to 'auto')
  // so the target participates in the root stacking context.  Contexts
  // created by backdrop-filter/transform/opacity/etc. can't be dissolved
  // without visual side-effects, so those ancestors are elevated to 9001.
  let current = el.parentElement
  while (current && current !== document.body) {
    const style = getComputedStyle(current)
    const hasZIndex = style.zIndex !== 'auto' && style.position !== 'static'

    // Check for non-z-index stacking context triggers (these can't be
    // removed without visual side-effects)
    const createsContextOther = (
      style.opacity !== '1' ||
      style.transform !== 'none' ||
      style.filter !== 'none' ||
      style.backdropFilter !== 'none' ||
      style.isolation === 'isolate'
    )

    if (hasZIndex && !createsContextOther) {
      // Safe to dissolve — removing z-index removes the stacking context
      modified.push({ el: current, origZ: current.style.zIndex, origPos: current.style.position })
      current.style.zIndex = 'auto'
    } else if (createsContextOther) {
      // Can't dissolve: backdrop-filter/transform/etc. keep the stacking
      // context even without z-index.  Elevate so the child participates
      // above the tutorial backdrop.
      modified.push({ el: current, origZ: current.style.zIndex, origPos: current.style.position })
      current.style.zIndex = '9001'
      if (style.position === 'static') {
        current.style.position = 'relative'
      }
    }

    current = current.parentElement
  }

  return () => {
    for (const item of modified) {
      item.el.style.zIndex = item.origZ
      item.el.style.position = item.origPos
    }
  }
}

function updateTargetRect(): void {
  const step = steps.value[currentStepIndex.value]
  if (!step?.target) {
    targetRect.value = null
    return
  }

  const el = document.querySelector(step.target)
  if (!el) {
    targetRect.value = null
    return
  }

  const rect = el.getBoundingClientRect()
  const padding = step.highlightPadding ?? 8

  targetRect.value = new DOMRect(
    rect.x - padding,
    rect.y - padding,
    rect.width + padding * 2,
    rect.height + padding * 2,
  )
}

// ============================================================
// Event listeners for tracking
// ============================================================

function handleScroll(): void {
  if (scrollRafId !== null) return
  scrollRafId = requestAnimationFrame(() => {
    updateTargetRect()
    scrollRafId = null
  })
}

function handleResize(): void {
  if (resizeTimeoutId !== null) clearTimeout(resizeTimeoutId)
  resizeTimeoutId = window.setTimeout(() => {
    updateTargetRect()
    resizeTimeoutId = null
  }, 100)
}

function startListeners(): void {
  window.addEventListener('scroll', handleScroll, { passive: true, capture: true })
  window.addEventListener('resize', handleResize)
}

function stopListeners(): void {
  window.removeEventListener('scroll', handleScroll, true)
  window.removeEventListener('resize', handleResize)
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
  if (resizeTimeoutId !== null) {
    clearTimeout(resizeTimeoutId)
    resizeTimeoutId = null
  }
}

function startObservingTarget(selector: string): void {
  stopObservingTarget()
  const el = document.querySelector(selector)
  if (!el) return

  resizeObserver = new ResizeObserver(() => {
    updateTargetRect()
  })
  resizeObserver.observe(el)
}

function stopObservingTarget(): void {
  resizeObserver?.disconnect()
  resizeObserver = null
}

// ============================================================
// Step definitions
// ============================================================

function isMobileViewport(): boolean {
  return window.innerWidth <= 640
}

function getQuickSetupSteps(): TutorialStep[] {
  const { isSettingsOpen, openSettings, closeSettings } = useSettingsPanel()
  const mobile = isMobileViewport()

  const settingsSteps: TutorialStep[] = mobile
    ? [
        {
          id: 'qs-open-menu',
          target: '[data-testid="mobile-menu-btn"]',
          title: 'Step 1: Open Menu',
          description: 'Tap the menu button to access settings.',
          position: 'bottom',
          requiresAction: true,
          actionHint: 'Tap the menu button',
          waitFor: () => { pollTick.value; return !!document.querySelector('.mobile-menu-dropdown') },
          autoAdvance: true,
        },
        {
          id: 'qs-open-settings',
          target: '[data-testid="mobile-settings-btn"]',
          title: 'Step 1: Open Settings',
          description: 'Now tap **Settings** to configure your API key.',
          position: 'bottom',
          requiresAction: true,
          actionHint: 'Tap Settings',
          waitFor: () => isSettingsOpen.value,
          autoAdvance: true,
        },
      ]
    : [
        {
          id: 'qs-open-settings',
          target: '[data-testid="settings-btn"]',
          title: 'Step 1: Open Settings',
          description: 'Click the settings button to configure your API key.',
          position: 'bottom',
          requiresAction: true,
          actionHint: 'Click the settings button to continue',
          waitFor: () => isSettingsOpen.value,
          autoAdvance: true,
        },
      ]

  return [
    {
      id: 'qs-welcome',
      target: null,
      title: 'Welcome to Bonsai!',
      description: "Let's get you set up in 3 quick steps: **add your API key**, **create a conversation**, and **send your first message**.",
      position: 'auto',
    },
    ...settingsSteps,
    {
      id: 'qs-api-key',
      target: '[data-testid="api-key-section"]',
      title: 'Add Your API Key',
      description: 'Enter your NanoGPT API key and click **Save**. You can get one from **nano-gpt.com** if you don\'t have one yet.',
      position: mobile ? 'bottom' : 'left',
      requiresAction: true,
      actionHint: 'Enter your API key and click Save',
      waitFor: () => { pollTick.value; return !!getApiKey() },
      onEnter: () => {
        if (!isSettingsOpen.value) openSettings()
        nextTick(() => {
          const section = document.querySelector('[data-testid="api-key-section"]')
          section?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
      },
    },
    {
      id: 'qs-create-conv',
      target: '[data-testid="new-conversation-btn"]',
      title: 'Step 2: Create a Conversation',
      description: 'Click **New Conversation** to start your first chat.',
      position: 'bottom',
      requiresAction: true,
      actionHint: 'Click "New Conversation"',
      waitFor: () => routerInstance?.currentRoute.value.name === 'conversation',
      autoAdvance: true,
      onEnter: async () => {
        closeSettings()
        await new Promise(r => setTimeout(r, 300))
        if (routerInstance) {
          await routerInstance.push({ name: 'home' })
          await new Promise(r => setTimeout(r, 300))
        }
      },
    },
    {
      id: 'qs-send-message',
      target: '[data-testid="message-composer"]',
      title: 'Step 3: Send a Message!',
      description: "You're all set! Type a message and press **Send** to get your first AI response. Enjoy Bonsai!",
      position: 'top',
      highlightPadding: 4,
      requiresAction: true,
      actionHint: 'Type a message and send it',
      waitFor: () => { pollTick.value; return document.querySelectorAll('[data-testid^="timeline-message-"]').length > 0 },
      autoAdvance: true,
    },
  ]
}

function getFullTourSteps(): TutorialStep[] {
  const { isSettingsOpen, openSettings, closeSettings } = useSettingsPanel()
  const mobile = isMobileViewport()

  // Steps for logo, theme toggle, and settings differ on mobile vs desktop
  const navSteps: TutorialStep[] = mobile
    ? [
        // Mobile: logo is still visible directly
        {
          id: 'ft-logo',
          target: '.logo-btn',
          title: 'Home Button',
          description: 'Tap the **Bonsai logo** to return to your conversation list from anywhere in the app.',
          position: 'bottom',
          onEnter: () => listenForTargetClick('.logo-btn'),
          waitFor: () => { pollTick.value; return _targetClicked },
          autoAdvance: true,
        },
        // Mobile: open hamburger for theme
        {
          id: 'ft-open-menu-theme',
          target: '[data-testid="mobile-menu-btn"]',
          title: 'Open Menu',
          description: 'Tap the menu button to access theme and settings controls.',
          position: 'bottom',
          waitFor: () => { pollTick.value; return !!document.querySelector('.mobile-menu-dropdown') },
          autoAdvance: true,
        },
        // Mobile: click theme in dropdown
        {
          id: 'ft-theme',
          target: '[data-testid="mobile-theme-btn"]',
          title: 'Theme Toggle',
          description: 'Switch between **night mode** and **day mode**. Tap it to try!',
          position: 'bottom',
          onEnter: () => listenForTargetClick('[data-testid="mobile-theme-btn"]'),
          waitFor: () => { pollTick.value; return _targetClicked },
          autoAdvance: true,
        },
        // Mobile: open hamburger for settings
        {
          id: 'ft-open-menu-settings',
          target: '[data-testid="mobile-menu-btn"]',
          title: 'Open Menu',
          description: 'Open the menu again to access **Settings**.',
          position: 'bottom',
          waitFor: () => { pollTick.value; return !!document.querySelector('.mobile-menu-dropdown') },
          autoAdvance: true,
        },
        // Mobile: click settings in dropdown
        {
          id: 'ft-settings-btn',
          target: '[data-testid="mobile-settings-btn"]',
          title: 'Settings',
          description: 'Open the **settings panel** to configure your API key, change themes, manage encryption, and export/import data.',
          position: 'bottom',
          waitFor: () => isSettingsOpen.value,
          autoAdvance: true,
        },
      ]
    : [
        {
          id: 'ft-logo',
          target: '.logo-btn',
          title: 'Home Button',
          description: 'Click the **Bonsai logo** to return to your conversation list from anywhere in the app.',
          position: 'bottom',
          onEnter: () => listenForTargetClick('.logo-btn'),
          waitFor: () => { pollTick.value; return _targetClicked },
          autoAdvance: true,
        },
        {
          id: 'ft-theme',
          target: '.theme-toggle',
          title: 'Theme Toggle',
          description: 'Switch between **night mode** and **day mode**. Click it to try!',
          position: 'bottom',
          onEnter: () => listenForTargetClick('.theme-toggle'),
          waitFor: () => { pollTick.value; return _targetClicked },
          autoAdvance: true,
        },
        {
          id: 'ft-settings-btn',
          target: '[data-testid="settings-btn"]',
          title: 'Settings',
          description: 'Open the **settings panel** to configure your API key, change themes, manage encryption, and export/import data.',
          position: 'bottom',
          waitFor: () => isSettingsOpen.value,
          autoAdvance: true,
        },
      ]

  return [
    {
      id: 'ft-welcome',
      target: null,
      title: 'Welcome to the Bonsai Tour',
      description: "This tour will walk you through all of Bonsai's features. You can skip at any time using the **X** button. Let's start with the navigation bar.",
      position: 'auto',
      onEnter: async () => {
        if (isSettingsOpen.value) closeSettings()
        if (routerInstance && routerInstance.currentRoute.value.name !== 'home') {
          await routerInstance.push({ name: 'home' })
          await new Promise(r => setTimeout(r, 300))
        }
      },
    },
    ...navSteps,
    {
      id: 'ft-settings-panel',
      target: '.settings-panel',
      title: 'Settings Panel',
      description: "Here you'll find your **API key**, **color themes**, **encryption**, **data management**, and **tutorials**. Scroll to explore all sections.",
      position: mobile ? 'bottom' : 'left',
      highlightPadding: 0,
      onEnter: async () => {
        openSettings()
        await new Promise(r => setTimeout(r, 300))
      },
      onExit: () => {
        closeSettings()
      },
    },
    {
      id: 'ft-conv-list',
      target: '.content-container',
      title: 'Conversation List',
      description: 'This is your **home page**. All your conversations are listed here. Click any conversation to open it, or press **Next** to continue the tour.',
      position: 'right',
      onEnter: async () => {
        if (routerInstance && routerInstance.currentRoute.value.name !== 'home') {
          await routerInstance.push({ name: 'home' })
          await new Promise(r => setTimeout(r, 300))
        }
      },
      // If user clicks into a conversation, skip ahead to the composer step
      waitFor: () => routerInstance?.currentRoute.value.name === 'conversation',
      autoAdvance: true,
      skipToId: 'ft-composer',
    },
    {
      id: 'ft-new-conv',
      target: '[data-testid="new-conversation-btn"]',
      title: 'Create Conversations',
      description: "Click here to start a **new conversation**. You'll name it and be taken to the conversation view.",
      position: 'bottom',
      // If user creates a conversation, skip the auto-navigate step
      waitFor: () => routerInstance?.currentRoute.value.name === 'conversation',
      autoAdvance: true,
      skipToId: 'ft-composer',
    },
    {
      id: 'ft-enter-conv',
      target: null,
      title: 'Conversation View',
      description: "Now let's look at the **conversation view** where all the action happens. We'll navigate into a conversation.",
      position: 'auto',
      onEnter: async () => {
        if (!routerInstance) return
        // Already in a conversation — skip navigation
        if (routerInstance.currentRoute.value.name === 'conversation') return
        const { useConversationStore } = await import('@/stores/conversationStore')
        const store = useConversationStore()
        await store.loadConversations()
        if (store.conversations.length > 0) {
          await routerInstance.push({ name: 'conversation', params: { id: store.conversations[0]!.id } })
        } else {
          const conv = await store.createNewConversation('Tutorial Conversation')
          await routerInstance.push({ name: 'conversation', params: { id: conv.id } })
        }
        await new Promise(r => setTimeout(r, 500))
      },
    },
    {
      id: 'ft-composer',
      target: '[data-testid="message-composer"]',
      title: 'Message Composer',
      description: mobile
        ? 'Type your messages here and tap **Send**. Try sending a message now, or press **Next** to continue.'
        : 'Type your messages here and press **Cmd+Enter** to send. Try it now, or press **Next** to continue.',
      position: 'top',
      highlightPadding: 4,
      onEnter: () => {
        _initialMessageCount = document.querySelectorAll('[data-testid^="timeline-message-"]').length
      },
      waitFor: () => { pollTick.value; return document.querySelectorAll('[data-testid^="timeline-message-"]').length > _initialMessageCount },
      autoAdvance: true,
    },
    {
      id: 'ft-model',
      target: '[data-testid="model-selector-btn"]',
      title: 'Model Selector',
      description: 'Choose which **AI model** to use. You can switch models per-message and the selection persists as the conversation default.',
      position: 'top',
    },
    {
      id: 'ft-search',
      target: '[data-testid="web-search-toggle"]',
      title: 'Web Search',
      description: 'Enable **web search** to let the AI access the internet. Choose between **standard** and **deep** search presets.',
      position: 'top',
    },
    {
      id: 'ft-timeline',
      target: '[data-testid="message-timeline"]',
      title: 'Message Timeline',
      description: mobile
        ? 'Messages appear here along your current path. **Tap and hold** a message to see action buttons.'
        : 'Messages appear here along your current path. **Hover** over any message to see action buttons.',
      position: 'right',
      highlightPadding: 0,
    },
    {
      id: 'ft-actions',
      target: '.message-card .message-actions',
      title: 'Message Actions',
      description: '**Edit** — Modify message content\n**Delete** — Remove a message and its subtree\n**Branch** — Create a new conversation branch\n**Exclude** — Toggle whether a message is sent as context\n**Resend** — Re-send to get a different response',
      position: mobile ? 'bottom' : 'right',
      highlightPadding: 4,
      onEnter: () => {
        // Force the first message's action buttons visible
        const actions = document.querySelector('.message-card .message-actions') as HTMLElement | null
        if (actions) {
          actions.style.opacity = '1'
          actions.dataset.tutorialForced = 'true'
        }
      },
      onExit: () => {
        document.querySelectorAll('.message-actions[data-tutorial-forced]').forEach(el => {
          ;(el as HTMLElement).style.opacity = ''
          delete (el as HTMLElement).dataset.tutorialForced
        })
      },
    },
    ...(() => {
      // Sidebar steps: on mobile, need to open the sidebar toggle first
      const sidebarSteps: TutorialStep[] = mobile
        ? [
            {
              id: 'ft-open-sidebar',
              target: '[data-testid="toggle-sidebar-btn"]',
              title: 'Open Sidebar',
              description: 'Tap the sidebar button to view the **conversation tree**.',
              position: 'bottom',
              requiresAction: true,
              actionHint: 'Tap the sidebar button',
              waitFor: () => { pollTick.value; return !!document.querySelector('[data-testid="tree-sidebar"]') },
              autoAdvance: true,
            },
            {
              id: 'ft-sidebar',
              target: '[data-testid="tree-sidebar"]',
              title: 'Conversation Tree',
              description: 'The sidebar shows your conversation as a **tree of branches**. Tap any branch to navigate to it.',
              position: 'right',
              highlightPadding: 0,
              onExit: async () => {
                // Close sidebar on mobile when leaving this step
                const { useConversationStore } = await import('@/stores/conversationStore')
                const store = useConversationStore()
                if (store.isSidebarOpen) store.toggleSidebar()
              },
            },
          ]
        : [
            {
              id: 'ft-sidebar',
              target: '[data-testid="tree-sidebar"]',
              title: 'Conversation Tree',
              description: 'The sidebar shows your conversation as a **tree of branches**. Click any branch to navigate to it. Branches are created when you edit, branch, or resend messages.',
              position: 'right',
              highlightPadding: 0,
            },
          ]
      return sidebarSteps
    })(),
    {
      id: 'ft-view-modes',
      target: '[data-testid="view-mode-toggle"]',
      title: 'View Modes',
      description: 'Switch between three views:\n\n**Tree** — Standard sidebar + timeline\n**Split** — Compare two branches side-by-side\n**Graph** — Canvas visualization of your entire conversation tree',
      position: 'bottom',
    },
    {
      id: 'ft-context',
      target: '[data-testid="context-builder"]',
      title: 'Context Builder',
      description: 'Fine-tune which messages the AI sees. Open this panel to **exclude** specific messages, **pin** messages from other branches, or set an **anchor point** to limit context.',
      position: 'top',
      highlightPadding: 2,
    },
    {
      id: 'ft-breadcrumbs',
      target: '[data-testid="path-breadcrumbs"]',
      title: 'Path Breadcrumbs',
      description: 'The breadcrumb trail shows your **current position** in the conversation tree. Click any node to quickly scroll to that message.',
      position: 'bottom',
      highlightPadding: 2,
    },
    {
      id: 'ft-complete',
      target: null,
      title: 'Tour Complete!',
      description: "You now know all of Bonsai's features. You can access this tour again anytime from the **Settings** panel. Happy branching!",
      position: 'auto',
    },
  ]
}

// ============================================================
// Confetti
// ============================================================

function fireConfetti(): void {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none'
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d')!
  const colors = ['#E7D27C', '#93C5FD', '#F9A8D4', '#FDBA74', '#4ade80', '#c084fc']
  const particles: Array<{
    x: number; y: number; vx: number; vy: number
    size: number; color: string; rotation: number; spin: number
    shape: number; alpha: number
  }> = []

  for (let i = 0; i < 120; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8
    const speed = 8 + Math.random() * 12
    particles.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 200,
      y: canvas.height * 0.5,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 4,
      vy: Math.sin(angle) * speed - Math.random() * 4,
      size: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.3,
      shape: Math.floor(Math.random() * 3),
      alpha: 1,
    })
  }

  const start = performance.now()
  const duration = 2500

  function frame(now: number) {
    const elapsed = now - start
    if (elapsed > duration) {
      canvas.remove()
      return
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const fade = elapsed > duration * 0.6 ? 1 - (elapsed - duration * 0.6) / (duration * 0.4) : 1

    for (const p of particles) {
      p.x += p.vx
      p.vy += 0.25
      p.y += p.vy
      p.vx *= 0.99
      p.rotation += p.spin

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)
      ctx.globalAlpha = fade * p.alpha
      ctx.fillStyle = p.color

      if (p.shape === 0) {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      } else if (p.shape === 1) {
        ctx.beginPath()
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.moveTo(0, -p.size / 2)
        ctx.lineTo(p.size / 2, p.size / 2)
        ctx.lineTo(-p.size / 2, p.size / 2)
        ctx.closePath()
        ctx.fill()
      }

      ctx.restore()
    }

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}

// ============================================================
// Completion modal
// ============================================================

function showCompletionPopup(tutorialId: TutorialId): void {
  completedTutorialId.value = tutorialId
  showCompletionModal.value = true
  completionTimeoutId = window.setTimeout(() => {
    dismissCompletion()
  }, 5000)
}

function dismissCompletion(): void {
  showCompletionModal.value = false
  completedTutorialId.value = null
  if (completionTimeoutId !== null) {
    clearTimeout(completionTimeoutId)
    completionTimeoutId = null
  }
}

// ============================================================
// Core navigation
// ============================================================

async function goToStep(index: number): Promise<void> {
  const prevStep = steps.value[currentStepIndex.value]
  const newStep = steps.value[index]
  if (!newStep) return

  isTransitioning.value = true

  // Cleanup previous step
  cleanupWatcher?.()
  cleanupWatcher = null
  cleanupElevation?.()
  cleanupElevation = null
  stopObservingTarget()
  prevStep?.onExit?.()

  // Update index
  currentStepIndex.value = index

  // Run onEnter
  if (newStep.onEnter) {
    await newStep.onEnter()
  }

  await nextTick()

  // Wait for target element if needed
  if (newStep.target) {
    const el = await waitForElement(newStep.target)
    if (el) {
      // Scroll into view
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      await new Promise(r => setTimeout(r, 300))

      // Only elevate target when interaction is needed; informational steps
      // stay behind the backdrop so accidental clicks don't open dropdowns
      if (newStep.requiresAction || newStep.waitFor) {
        cleanupElevation = elevateTarget(newStep.target)
      }

      // Start observing
      startObservingTarget(newStep.target)
    }
  }

  // Update rect
  updateTargetRect()

  // Handle waitFor / canAdvance
  if (newStep.waitFor) {
    const initialResult = newStep.waitFor()
    canAdvance.value = newStep.requiresAction ? initialResult : true

    cleanupWatcher = watchEffect(() => {
      if (!newStep.waitFor) return
      const result = newStep.waitFor()

      // Only gate the Next button when requiresAction is set
      if (newStep.requiresAction) {
        canAdvance.value = result
      }

      if (result && newStep.autoAdvance && isActive.value && !isTransitioning.value) {
        // Delay slightly so user can see the condition was met
        setTimeout(() => {
          if (isActive.value && currentStepIndex.value === index) {
            if (newStep.skipToId) {
              const targetIdx = steps.value.findIndex(s => s.id === newStep.skipToId)
              if (targetIdx >= 0) goToStep(targetIdx)
            } else {
              doNextStep()
            }
          }
        }, 400)
      }
    })
  } else {
    canAdvance.value = true
  }

  isTransitioning.value = false
}

function doNextStep(): void {
  if (isTransitioning.value) return

  if (currentStepIndex.value >= steps.value.length - 1) {
    // Last step — finish
    const finishedId = currentTutorialId.value
    stopTutorial()
    if (finishedId) {
      markTutorialCompleted(finishedId)
      fireConfetti()
      showCompletionPopup(finishedId)
    }
    return
  }

  goToStep(currentStepIndex.value + 1)
}

function doPrevStep(): void {
  if (isTransitioning.value || currentStepIndex.value <= 0) return
  goToStep(currentStepIndex.value - 1)
}

function startTutorial(id: TutorialId): void {
  if (isActive.value) stopTutorial()

  const router = routerInstance
  currentTutorialId.value = id

  if (id === 'quick-setup') {
    steps.value = getQuickSetupSteps()
  } else {
    steps.value = getFullTourSteps()
  }

  isActive.value = true
  currentStepIndex.value = 0

  startListeners()
  startPolling()

  // Router guard to handle unexpected navigation
  if (router) {
    removeRouterGuard = router.afterEach(() => {
      // Re-check target position after navigation
      setTimeout(() => updateTargetRect(), 300)
    })
  }

  goToStep(0)
}

function stopTutorial(): void {
  const prevStep = steps.value[currentStepIndex.value]
  prevStep?.onExit?.()

  cleanupWatcher?.()
  cleanupWatcher = null
  cleanupElevation?.()
  cleanupElevation = null
  stopObservingTarget()
  stopListeners()
  stopPolling()
  _targetClickCleanup?.()
  _targetClickCleanup = null
  _targetClicked = false
  removeRouterGuard?.()
  removeRouterGuard = null

  // Mark as dismissed if it's quick setup and not completed
  if (currentTutorialId.value === 'quick-setup' && currentStepIndex.value < steps.value.length - 1) {
    markQuickSetupDismissed()
  }

  isActive.value = false
  currentTutorialId.value = null
  currentStepIndex.value = 0
  steps.value = []
  targetRect.value = null
  canAdvance.value = true
  isTransitioning.value = false
}

// ============================================================
// Composable export
// ============================================================

export function useTutorial() {
  // Capture router instance from the calling component's setup context
  try {
    routerInstance = useRouter()
  } catch {
    // May be called outside setup — that's ok, router may have been set by a prior call
  }

  const currentStep = computed(() => steps.value[currentStepIndex.value] ?? null)
  const totalSteps = computed(() => steps.value.length)
  const isFirstStep = computed(() => currentStepIndex.value === 0)
  const isLastStep = computed(() => currentStepIndex.value === steps.value.length - 1)
  const progress = computed(() =>
    totalSteps.value > 0 ? ((currentStepIndex.value + 1) / totalSteps.value) * 100 : 0
  )

  return {
    // State
    isActive: readonly(isActive),
    currentTutorialId: readonly(currentTutorialId),
    currentStepIndex: readonly(currentStepIndex),
    currentStep,
    totalSteps,
    isFirstStep,
    isLastStep,
    progress,
    targetRect: readonly(targetRect),
    isTransitioning: readonly(isTransitioning),
    canAdvance: readonly(canAdvance),

    // Actions
    startTutorial,
    stopTutorial,
    nextStep: doNextStep,
    prevStep: doPrevStep,

    // Completion modal
    showCompletionModal: readonly(showCompletionModal),
    completedTutorialId: readonly(completedTutorialId),
    dismissCompletion,

    // Persistence
    isTutorialCompleted,
    shouldAutoTriggerQuickSetup,
    markQuickSetupDismissed,
    updateTargetRect,
  }
}
