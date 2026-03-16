<script setup lang="ts">
/**
 * Hero: Living Tree with fluid Bleeding Ripple
 * Auto-highlights random paths with grow → hold → fade animation
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'

const CX = 200, CY = 200, SYMMETRY = 6, COLOR = '#a5b4fc'
const GLOW_COLOR = '#a5b4fc'
const GLOW_CORE_COLOR = '#c4b5fd'
const BRANCH_HIGHLIGHT_COLOR = '#c8c0ff'
const MAX_DEPTH = 4

const isVisible = ref(false)
const time = ref(0)
const frameTime = ref(performance.now())
const isMobile = ref(window.innerWidth < 768)
let animationId: number | null = null

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// ============================================================
// Living Tree geometry
// ============================================================

interface AnimBranch {
  id: number; path: string; depth: number; arm: number
  x1: number; y1: number; x2: number; y2: number
  parentId: number | null; pathToRoot: number[]
}

interface AnimBlossom {
  id: number; x: number; y: number; r: number; seed: number
  branchId: number; depth: number
}

const tree = computed(() => {
  const angleOffset = isMobile.value ? 0 : Math.sin(time.value * 1.1) * 0.045
  const branches: AnimBranch[] = []
  const blossoms: AnimBlossom[] = []
  let bid = 0, blid = 0

  function gen(
    x: number, y: number, angle: number, length: number,
    depth: number, arm: number, parentId: number | null, pathToRoot: number[]
  ) {
    if (depth > MAX_DEPTH) return
    const id = bid++
    const currentPath = [...pathToRoot, id]
    const x2 = x + Math.cos(angle) * length
    const y2 = y + Math.sin(angle) * length
    const perpAngle = angle + Math.PI / 2
    const sway = isMobile.value ? 0 : Math.sin(time.value * 1.5 + depth * 0.8 + arm * 1.1) * length * 0.06
    const wobble = (seededRandom(id * 7 + arm) - 0.5) * length * 0.15 + sway
    const cpx = (x + x2) / 2 + Math.cos(perpAngle) * wobble
    const cpy = (y + y2) / 2 + Math.sin(perpAngle) * wobble
    branches.push({
      id, path: `M ${x} ${y} Q ${cpx} ${cpy} ${x2} ${y2}`,
      depth, arm, x1: x, y1: y, x2, y2, parentId, pathToRoot: currentPath
    })

    if (depth >= 3) {
      const count = depth === MAX_DEPTH ? 6 : 2
      for (let p = 0; p < count; p++) {
        const a = seededRandom(id * 6 + p) * Math.PI * 2
        const dist = 1.5 + seededRandom(id * 6 + p + 50) * 6
        blossoms.push({
          id: blid++,
          x: x2 + Math.cos(a) * dist, y: y2 + Math.sin(a) * dist,
          r: 0.8 + seededRandom(id * 6 + p + 100) * 1.5,
          seed: id * 6 + p, branchId: id, depth
        })
      }
    }

    const newLen = length * 0.62
    const spread = Math.PI / 5 + angleOffset
    gen(x2, y2, angle - spread, newLen, depth + 1, arm, id, currentPath)
    gen(x2, y2, angle + spread, newLen, depth + 1, arm, id, currentPath)
  }

  for (let i = 0; i < SYMMETRY; i++) {
    gen(CX, CY, (i / SYMMETRY) * Math.PI * 2 - Math.PI / 2, 62, 0, i, null, [])
  }

  return { branches, blossoms, guides: [62, 100, 130, 158, 185] }
})

// ============================================================
// Animation queue — each path plays grow → hold → fade
// ============================================================

interface PathAnim {
  path: number[]
  leafId: number
  startTime: number
  growDur: number
  holdDur: number
  fadeDur: number
}

const anims = ref<PathAnim[]>([])

const AUTO_GROW = 505, AUTO_HOLD = 505, AUTO_FADE = 295

function animTotalDur(a: PathAnim): number {
  return a.growDur + a.holdDur + a.fadeDur
}

// ============================================================
// Highlight for a single animation
// ============================================================

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

function pathHighlight(path: number[], progress: number, b: AnimBranch): number {
  if (progress <= 0) return 0

  const waveFront = progress * (MAX_DEPTH + 2.5)
  const distFromFront = waveFront - b.depth
  if (distFromFront < 0) return 0

  const fade = smoothstep(distFromFront / 2.0)

  if (path.includes(b.id)) return fade

  const pathSet = new Set(path)
  if (b.parentId !== null && pathSet.has(b.parentId)) {
    return fade * (0.5 + (b.depth / MAX_DEPTH) * 0.35)
  }
  for (const anc of b.pathToRoot) {
    if (anc !== b.id && pathSet.has(anc)) {
      const idx = b.pathToRoot.indexOf(anc)
      const steps = b.pathToRoot.length - idx - 1
      return fade * Math.max(0, 0.45 - steps * 0.1)
    }
  }
  const pathBranches = tree.value.branches.filter(br => pathSet.has(br.id))
  if (pathBranches.length > 0 && pathBranches[0]!.arm === b.arm) {
    return fade * 0.12
  }
  return 0
}

function animHighlight(anim: PathAnim, now: number, b: AnimBranch): number {
  const elapsed = now - anim.startTime
  if (elapsed < 0) return 0

  if (elapsed < anim.growDur) {
    const t = elapsed / anim.growDur
    const progress = 1 - Math.pow(1 - t, 2.5)
    return pathHighlight(anim.path, progress, b)
  }

  if (elapsed < anim.growDur + anim.holdDur) {
    return pathHighlight(anim.path, 1, b)
  }

  if (elapsed < animTotalDur(anim)) {
    const t = (elapsed - anim.growDur - anim.holdDur) / anim.fadeDur
    const fadeAmount = 1 - t * t * t
    return pathHighlight(anim.path, 1, b) * fadeAmount
  }

  return 0
}

function bleedHighlight(b: AnimBranch): number {
  const now = frameTime.value
  let max = 0
  for (const anim of anims.value) {
    const hl = animHighlight(anim, now, b)
    if (hl > max) max = hl
  }
  return Math.min(1, max)
}

// ============================================================
// Rendering helpers
// ============================================================

function branchOpacity(b: AnimBranch): number {
  const hl = bleedHighlight(b)
  return 0.5 + hl * 0.4
}

function branchWidth(b: AnimBranch): number {
  return Math.max(0.5, 3.8 - b.depth * 0.8) + bleedHighlight(b) * 1.4
}

function lerpColor(a: string, b: string, t: number): string {
  const parse = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
  const ca = parse(a), cb = parse(b)
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t)
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t)
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t)
  return `rgb(${r},${g},${bl})`
}

function branchColor(b: AnimBranch): string {
  const hl = bleedHighlight(b)
  if (hl < 0.01) return COLOR
  return lerpColor(COLOR, BRANCH_HIGHLIGHT_COLOR, hl)
}

function glowOuterOpacity(b: AnimBranch): number {
  const hl = bleedHighlight(b)
  if (hl < 0.05) return 0
  const pulse = 1 + Math.sin(time.value * 4.5 + b.arm * 1.2 + b.depth * 0.7) * 0.15
  return hl * 0.4 * pulse
}

function glowOuterWidth(b: AnimBranch): number {
  const base = Math.max(0.5, 3.8 - b.depth * 0.8)
  return base + 6 + bleedHighlight(b) * 5
}

function glowInnerOpacity(b: AnimBranch): number {
  const hl = bleedHighlight(b)
  if (hl < 0.05) return 0
  const pulse = 1 + Math.sin(time.value * 6 + b.arm * 0.9 + b.depth) * 0.1
  return hl * 0.55 * pulse
}

function glowInnerWidth(b: AnimBranch): number {
  const base = Math.max(0.5, 3.8 - b.depth * 0.8)
  return base + 3 + bleedHighlight(b) * 3
}

function blossomOpacity(bl: AnimBlossom): number {
  const branch = tree.value.branches.find(b => b.id === bl.branchId)
  if (!branch) return 0.05
  const hl = bleedHighlight(branch)
  return hl > 0.1 ? 0.15 + hl * 0.55 : 0.04
}

function blossomRadius(bl: AnimBlossom): number {
  const base = bl.r * (1 + Math.sin(time.value * 2.5 + bl.seed * 1.3) * 0.2)
  const branch = tree.value.branches.find(b => b.id === bl.branchId)
  if (!branch) return bl.r * 0.8
  return base * (0.8 + bleedHighlight(branch) * 0.8)
}

function guideOpacity(index: number): number {
  return 0.4 + Math.sin(time.value * 1.8 + index * 0.9) * 0.1
}

// ============================================================
// Auto-cycle
// ============================================================

const autoVisited = ref<Set<number>>(new Set())
const autoLastLeaf = ref<number | null>(null)
let cycleIntervalId: number | null = null

function pickNextLeaf(): number[] | null {
  const leaves = tree.value.branches.filter(b => b.depth === MAX_DEPTH)
  if (leaves.length === 0) return null
  let available = leaves.filter(b => !autoVisited.value.has(b.id))
  if (available.length === 0) {
    autoVisited.value = new Set()
    available = leaves.filter(b => b.id !== autoLastLeaf.value)
    if (available.length === 0) available = leaves
  }
  const leaf = available[Math.floor(Math.random() * available.length)]
  if (!leaf) return null
  autoVisited.value.add(leaf.id)
  autoLastLeaf.value = leaf.id
  return leaf.pathToRoot
}

function addAutoAnim() {
  const path = pickNextLeaf()
  if (!path) return
  anims.value.push({
    path,
    leafId: path[path.length - 1]!,
    startTime: performance.now(),
    growDur: AUTO_GROW, holdDur: AUTO_HOLD, fadeDur: AUTO_FADE
  })
}

function startAutoCycle() {
  addAutoAnim()
  cycleIntervalId = window.setInterval(addAutoAnim, 1510)
}

// ============================================================
// Lifecycle
// ============================================================

onMounted(() => {
  setTimeout(() => { isVisible.value = true }, 100)

  function animate() {
    time.value += 0.002
    frameTime.value = performance.now()

    const now = frameTime.value
    anims.value = anims.value.filter(a => now - a.startTime < animTotalDur(a))

    animationId = requestAnimationFrame(animate)
  }
  animationId = requestAnimationFrame(animate)

  setTimeout(() => startAutoCycle(), 300)
})

onUnmounted(() => {
  if (animationId) cancelAnimationFrame(animationId)
  if (cycleIntervalId) clearInterval(cycleIntervalId)
})
</script>

<template>
  <div class="hero-container" :class="{ visible: isVisible }">
    <svg viewBox="0 0 400 400" class="unified-svg">
      <defs>
        <filter id="glow-soft" filterUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" />
        </filter>
        <filter id="glow-tight" filterUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" />
        </filter>
        <radialGradient id="center-glow-gradient">
          <stop offset="0%" stop-color="#c4b5fd" stop-opacity="0.5" />
          <stop offset="60%" stop-color="#a5b4fc" stop-opacity="0.15" />
          <stop offset="100%" stop-color="#a5b4fc" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle v-for="(r, i) in tree.guides" :key="'g-'+r" :cx="CX" :cy="CY" :r="r"
        fill="none" :stroke="COLOR" stroke-width="1" :opacity="guideOpacity(i)" />
      <!-- Glow outer bloom (group-level blur) -->
      <g filter="url(#glow-soft)">
        <path v-for="b in tree.branches" :key="'go-'+b.id" :d="b.path" fill="none"
          :stroke="GLOW_COLOR" :stroke-width="glowOuterWidth(b)" stroke-linecap="round"
          :opacity="glowOuterOpacity(b)" />
      </g>
      <!-- Glow inner halo (group-level blur) -->
      <g filter="url(#glow-tight)">
        <path v-for="b in tree.branches" :key="'gi-'+b.id" :d="b.path" fill="none"
          :stroke="GLOW_CORE_COLOR" :stroke-width="glowInnerWidth(b)" stroke-linecap="round"
          :opacity="glowInnerOpacity(b)" />
      </g>
      <!-- Main branches -->
      <path v-for="b in tree.branches" :key="'b-'+b.id" :d="b.path" fill="none" :stroke="branchColor(b)"
        :stroke-width="branchWidth(b)" stroke-linecap="round"
        :opacity="branchOpacity(b)" />
      <!-- Blossom glow -->
      <g filter="url(#glow-soft)">
        <circle v-for="bl in tree.blossoms" :key="'blg-'+bl.id" :cx="bl.x" :cy="bl.y"
          :r="blossomRadius(bl) * 2" :fill="GLOW_COLOR"
          :opacity="blossomOpacity(bl) * 0.35" />
      </g>
      <!-- Blossoms -->
      <circle v-for="bl in tree.blossoms" :key="'bl-'+bl.id" :cx="bl.x" :cy="bl.y"
        :r="blossomRadius(bl)" :fill="COLOR" :opacity="blossomOpacity(bl)" />
      <!-- Center node glow -->
      <circle :cx="CX" :cy="CY" r="20" fill="url(#center-glow-gradient)" stroke="none" class="center-glow" />
      <circle :cx="CX" :cy="CY" r="6" :fill="COLOR" :opacity="0.9" stroke="none" class="center-dot" />
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
}
</style>
