<script setup lang="ts">
/**
 * Hero: Unified Sacred Geometry
 * Combines fractal branching, rose window symmetry, and seed of life circles
 * Interactive: hover to highlight paths from leaf to center
 * Auto-highlights random paths when not hovering
 */
import { ref, onMounted, onUnmounted, computed } from 'vue'

const isVisible = ref(false)
const time = ref(0)
const hoveredPath = ref<number[] | null>(null)
const hoveredArm = ref<number | null>(null)
const autoPath = ref<number[] | null>(null)
const lastAutoPathId = ref<number | null>(null)
const isUserHovering = ref(false)
const transitionProgress = ref(1)
const isInViewport = ref(true)
const isMobile = ref(false)
let animationId: number | null = null
let autoHighlightInterval: number | null = null
let transitionAnimationId: number | null = null
let lastFrameTime = 0
let heroObserver: IntersectionObserver | null = null
const heroRef = ref<HTMLElement | null>(null)

const cx = 200
const cy = 200
const symmetry = 6
// Reduce depth on mobile for better performance
const maxDepth = computed(() => isMobile.value ? 3 : 4)
const initialLength = 60
const lengthRatio = 0.62
const branchAngle = Math.PI / 5

// Throttle frame rate on mobile (target ~15fps instead of 60fps)
const MOBILE_FRAME_INTERVAL = 66 // ~15fps
const DESKTOP_FRAME_INTERVAL = 0 // No throttling

interface Branch {
  id: number
  x1: number
  y1: number
  x2: number
  y2: number
  depth: number
  arm: number
  parentId: number | null
  pathToRoot: number[]
}

interface Circle {
  id: number
  x: number
  y: number
  r: number
  depth: number
  arm: number
  branchId: number | null
  pathToRoot: number[]
}

// The currently active path (user hover takes priority over auto)
const activePath = computed(() => {
  if (isUserHovering.value && hoveredPath.value) {
    return hoveredPath.value
  }
  return autoPath.value
})

// Animate the transition progress from 0 to 1
function animateTransition() {
  if (transitionAnimationId) {
    cancelAnimationFrame(transitionAnimationId)
  }

  transitionProgress.value = 0
  const duration = 1200 // ms
  const startTime = performance.now()

  function step(currentTime: number) {
    const elapsed = currentTime - startTime
    const progress = Math.min(elapsed / duration, 1)
    // Ease-in-out quad for smoother start and end
    transitionProgress.value = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2

    if (progress < 1) {
      transitionAnimationId = requestAnimationFrame(step)
    } else {
      transitionProgress.value = 1
      transitionAnimationId = null
    }
  }

  transitionAnimationId = requestAnimationFrame(step)
}

function selectRandomPath() {
  const branches = geometry.value.branches
  // Get leaf branches (those at max depth)
  const leafBranches = branches.filter(b => b.depth === maxDepth.value)
  if (leafBranches.length === 0) return

  // Filter out the last selected path to avoid repetition
  const availableBranches = leafBranches.filter(b => b.id !== lastAutoPathId.value)
  const branchesToChooseFrom = availableBranches.length > 0 ? availableBranches : leafBranches

  const randomLeaf = branchesToChooseFrom[Math.floor(Math.random() * branchesToChooseFrom.length)]
  if (!randomLeaf) return
  lastAutoPathId.value = randomLeaf.id
  autoPath.value = randomLeaf.pathToRoot
  animateTransition()
}

function startAutoHighlight() {
  if (autoHighlightInterval) return
  selectRandomPath()
  // Slower interval on mobile to reduce processing
  const interval = isMobile.value ? 5000 : 3000
  autoHighlightInterval = window.setInterval(() => {
    if (!isUserHovering.value && isInViewport.value) {
      selectRandomPath()
    }
  }, interval)
}

function stopAutoHighlight() {
  if (autoHighlightInterval) {
    clearInterval(autoHighlightInterval)
    autoHighlightInterval = null
  }
}

onMounted(() => {
  // Detect mobile devices
  isMobile.value = window.innerWidth < 768 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

  setTimeout(() => {
    isVisible.value = true
  }, 100)

  function animate(currentTime: number) {
    // Skip animation if not in viewport (performance optimization)
    if (!isInViewport.value) {
      animationId = requestAnimationFrame(animate)
      return
    }

    // Throttle frame rate on mobile
    const frameInterval = isMobile.value ? MOBILE_FRAME_INTERVAL : DESKTOP_FRAME_INTERVAL
    if (frameInterval > 0 && currentTime - lastFrameTime < frameInterval) {
      animationId = requestAnimationFrame(animate)
      return
    }
    lastFrameTime = currentTime

    time.value += 0.002
    animationId = requestAnimationFrame(animate)
  }
  animationId = requestAnimationFrame(animate)

  // Set up Intersection Observer to pause animations when not visible
  if (heroRef.value) {
    heroObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry) isInViewport.value = entry.isIntersecting
      },
      { threshold: 0.1 }
    )
    heroObserver.observe(heroRef.value)
  }

  // Start auto-highlighting after a short delay
  setTimeout(() => {
    startAutoHighlight()
  }, 1500)
})

onUnmounted(() => {
  if (animationId) cancelAnimationFrame(animationId)
  if (transitionAnimationId) cancelAnimationFrame(transitionAnimationId)
  if (heroObserver) heroObserver.disconnect()
  stopAutoHighlight()
})

const geometry = computed(() => {
  const branches: Branch[] = []
  const circles: Circle[] = []
  const angleOffset = Math.sin(time.value) * 0.03
  let branchId = 0
  let circleId = 0

  // Add center circle
  circles.push({ id: circleId++, x: cx, y: cy, r: 10, depth: -1, arm: -1, branchId: null, pathToRoot: [] })

  function generateBranch(
    x: number,
    y: number,
    angle: number,
    length: number,
    depth: number,
    arm: number,
    parentId: number | null,
    pathToRoot: number[]
  ) {
    if (depth > maxDepth.value) return

    const currentId = branchId++
    const currentPath = [...pathToRoot, currentId]

    const x2 = x + Math.cos(angle) * length
    const y2 = y + Math.sin(angle) * length

    branches.push({ id: currentId, x1: x, y1: y, x2, y2, depth, arm, parentId, pathToRoot: currentPath })

    // Add circle at branch endpoint
    const circleRadius = Math.max(3, 8 - depth * 1.5)
    circles.push({ id: circleId++, x: x2, y: y2, r: circleRadius, depth, arm, branchId: currentId, pathToRoot: currentPath })

    // Recursive branching
    const newLength = length * lengthRatio
    const spread = branchAngle + angleOffset

    generateBranch(x2, y2, angle - spread, newLength, depth + 1, arm, currentId, currentPath)
    generateBranch(x2, y2, angle + spread, newLength, depth + 1, arm, currentId, currentPath)
  }

  // Generate fractal branches in radial symmetry
  for (let i = 0; i < symmetry; i++) {
    const baseAngle = (i / symmetry) * Math.PI * 2 - Math.PI / 2
    generateBranch(cx, cy, baseAngle, initialLength, 0, i, null, [])
  }

  return { branches, circles }
})

function handleBranchHover(branch: Branch) {
  const wasHovering = isUserHovering.value
  const pathChanged = JSON.stringify(hoveredPath.value) !== JSON.stringify(branch.pathToRoot)

  isUserHovering.value = true
  hoveredPath.value = branch.pathToRoot
  hoveredArm.value = branch.arm

  if (!wasHovering || pathChanged) {
    animateTransition()
  }
}

function handleCircleHover(circle: Circle) {
  const wasHovering = isUserHovering.value
  const pathChanged = JSON.stringify(hoveredPath.value) !== JSON.stringify(circle.pathToRoot)

  isUserHovering.value = true
  hoveredPath.value = circle.pathToRoot
  hoveredArm.value = circle.arm

  if (!wasHovering || pathChanged) {
    animateTransition()
  }
}

function handleMouseLeave() {
  isUserHovering.value = false
  hoveredPath.value = null
  hoveredArm.value = null
  // Select a new random path when user stops hovering
  selectRandomPath()
}

// Check if branch is in the main highlighted path (kept for potential future use)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _isBranchInMainPath(branch: Branch): boolean {
  if (!activePath.value) return false
  return activePath.value.includes(branch.id)
}

// Get the highlight level for a branch (0 = none, 1 = full, 0-1 = partial)
function getBranchHighlightLevel(branch: Branch): number {
  if (!activePath.value || activePath.value.length === 0) return 0

  // Calculate the depth threshold based on transition progress
  // Progress 0 = only depth 0, Progress 1 = all depths
  // Add extra range so animation completes smoothly
  const maxVisibleDepth = transitionProgress.value * (maxDepth.value + 2)

  // If this branch's depth is beyond the transition progress, don't highlight
  if (branch.depth > maxVisibleDepth) return 0

  // Calculate fade factor for branches near the transition edge
  // Use a wider fade range for smoother transitions
  const depthProgress = maxVisibleDepth - branch.depth
  const fadeFactor = Math.min(1, depthProgress / 1.5)

  // Main path: full highlight (modified by transition)
  if (activePath.value.includes(branch.id)) {
    return fadeFactor
  }

  // Check if this branch shares ancestry with the main path
  const mainPathSet = new Set(activePath.value)

  // Check if this branch's parent is in the main path
  // If so, it's a sibling of a main path branch
  if (branch.parentId !== null && mainPathSet.has(branch.parentId)) {
    // Sibling branches get highlighted based on depth
    // Deeper = more highlight (spreading effect)
    const depthFactor = branch.depth / maxDepth.value
    const baseLevel = 0.3 + depthFactor * 0.5
    return baseLevel * fadeFactor
  }

  // Check if any ancestor is in the main path (descendant of main path)
  for (const ancestorId of branch.pathToRoot) {
    if (ancestorId !== branch.id && mainPathSet.has(ancestorId)) {
      // This branch descends from the main path
      // Calculate how far removed it is
      const ancestorIndex = branch.pathToRoot.indexOf(ancestorId)
      const stepsFromMainPath = branch.pathToRoot.length - ancestorIndex - 1
      const depthFactor = branch.depth / maxDepth.value
      const baseLevel = Math.max(0, (0.4 + depthFactor * 0.4) - stepsFromMainPath * 0.15)
      return baseLevel * fadeFactor
    }
  }

  return 0
}

function isBranchHighlighted(branch: Branch): boolean {
  return getBranchHighlightLevel(branch) > 0.2
}

function isCircleHighlighted(circle: Circle): boolean {
  if (circle.depth === -1) return activePath.value !== null
  if (!activePath.value || circle.branchId === null) return false

  const branch = geometry.value.branches.find(b => b.id === circle.branchId)
  if (!branch) return false
  return getBranchHighlightLevel(branch) > 0.2
}

function getBranchOpacity(branch: Branch): number {
  const base = 0.7 - branch.depth * 0.08
  if (activePath.value) {
    const highlightLevel = getBranchHighlightLevel(branch)
    if (highlightLevel > 0) {
      return 0.5 + highlightLevel * 0.5
    }
    return 0.15
  }
  return base
}

function getBranchWidth(branch: Branch): number {
  const base = Math.max(1.2, 3 - branch.depth * 0.4)
  const highlightLevel = getBranchHighlightLevel(branch)
  if (highlightLevel > 0.5) {
    return base + highlightLevel * 1.2
  }
  return base
}

function getCircleOpacity(circle: Circle, index: number): number {
  if (circle.depth === -1) {
    return activePath.value ? 1 : 0.8
  }
  const base = 0.5 - circle.depth * 0.06
  const pulse = Math.sin(time.value * 2 + index * 0.2) * 0.08

  if (activePath.value) {
    if (circle.branchId === null) return 0.12
    const branch = geometry.value.branches.find(b => b.id === circle.branchId)
    if (!branch) return 0.12
    const highlightLevel = getBranchHighlightLevel(branch)
    if (highlightLevel > 0) {
      return 0.5 + highlightLevel * 0.5
    }
    return 0.12
  }
  return Math.max(0.25, base + pulse)
}

function getCircleRadius(circle: Circle): number {
  if (circle.branchId === null) return circle.r
  const branch = geometry.value.branches.find(b => b.id === circle.branchId)
  if (!branch) return circle.r
  const highlightLevel = getBranchHighlightLevel(branch)
  if (highlightLevel > 0.5) {
    return circle.r * (1 + highlightLevel * 0.3)
  }
  return circle.r
}

// Expose reserved function for potential future use
defineExpose({
  _isBranchInMainPath,
})
</script>

<template>
  <div ref="heroRef" class="hero-container" :class="{ visible: isVisible, 'is-mobile': isMobile }">
    <svg viewBox="0 0 400 400" class="unified-svg" @mouseleave="handleMouseLeave">
      <!-- Outer guide circle -->
      <circle
        :cx="cx"
        :cy="cy"
        r="185"
        fill="none"
        stroke="#a5b4fc"
        stroke-width="0.75"
        :opacity="activePath ? 0.3 : 0.15"
        class="guide-circle"
      />

      <!-- Inner guide circles -->
      <circle
        v-for="r in [60, 97, 127, 155]"
        :key="'guide-' + r"
        :cx="cx"
        :cy="cy"
        :r="r"
        fill="none"
        stroke="#a5b4fc"
        stroke-width="0.5"
        :opacity="activePath ? 0.2 : 0.1"
        class="guide-circle"
      />

      <!-- Branches -->
      <line
        v-for="b in geometry.branches"
        :key="'branch-' + b.id"
        :x1="b.x1"
        :y1="b.y1"
        :x2="b.x2"
        :y2="b.y2"
        stroke="#a5b4fc"
        :stroke-width="getBranchWidth(b)"
        stroke-linecap="round"
        :opacity="getBranchOpacity(b)"
        :class="['branch-line', { highlighted: isBranchHighlighted(b) }]"
        @mouseenter="handleBranchHover(b)"
      />

      <!-- Circles at nodes -->
      <circle
        v-for="(c, i) in geometry.circles"
        :key="'circle-' + c.id"
        :cx="c.x"
        :cy="c.y"
        :r="getCircleRadius(c)"
        fill="none"
        stroke="#a5b4fc"
        :stroke-width="c.depth === -1 ? 2.5 : 1.2"
        :opacity="getCircleOpacity(c, i)"
        :class="['node-circle', { highlighted: isCircleHighlighted(c) }]"
        @mouseenter="handleCircleHover(c)"
      />

      <!-- Center fill -->
      <circle
        :cx="cx"
        :cy="cy"
        r="6"
        fill="#a5b4fc"
        :opacity="activePath ? 1 : 0.7"
        class="center-dot"
      />

      <!-- Glow effect for highlighted path -->
      <template v-if="activePath">
        <line
          v-for="b in geometry.branches.filter(b => getBranchHighlightLevel(b) > 0.3)"
          :key="'glow-' + b.id"
          :x1="b.x1"
          :y1="b.y1"
          :x2="b.x2"
          :y2="b.y2"
          stroke="#a5b4fc"
          :stroke-width="getBranchWidth(b) + 5"
          stroke-linecap="round"
          :opacity="0.15 + getBranchHighlightLevel(b) * 0.2"
          class="branch-glow"
        />
      </template>
    </svg>
  </div>
</template>

<style scoped>
.hero-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 1s ease;
}

.hero-container.visible {
  opacity: 1;
}

.unified-svg {
  width: 100%;
  max-width: 600px;
  height: auto;
  cursor: default;
}

.guide-circle {
  transition: opacity 0.3s ease;
}

.is-mobile .guide-circle {
  transition: none;
}

.branch-line {
  transition: opacity 0.25s ease, stroke-width 0.25s ease;
  cursor: default;
  will-change: opacity, stroke-width;
}

/* Disable transitions on mobile for better scroll performance */
.is-mobile .branch-line {
  transition: none;
  will-change: auto;
}

.branch-line.highlighted {
  filter: drop-shadow(0 0 3px rgba(165, 180, 252, 0.6));
}

/* Disable expensive filters on mobile for better performance */
.is-mobile .branch-line.highlighted {
  filter: none;
}

.node-circle {
  transition: opacity 0.25s ease, r 0.25s ease;
  cursor: default;
  will-change: opacity;
}

.is-mobile .node-circle {
  transition: none;
  will-change: auto;
}

.node-circle.highlighted {
  filter: drop-shadow(0 0 4px rgba(165, 180, 252, 0.8));
}

.is-mobile .node-circle.highlighted {
  filter: none;
}

.center-dot {
  transition: opacity 0.3s ease;
}

.is-mobile .center-dot {
  transition: none;
}

.branch-glow {
  pointer-events: none;
}
</style>
