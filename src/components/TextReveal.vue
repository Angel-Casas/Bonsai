<script setup lang="ts">
/**
 * TextReveal - Letter-by-letter text reveal animation
 *
 * Splits text into individual characters and reveals them
 * progressively with a smooth fade-in effect.
 * Preserves whitespace and line breaks (pre-wrap compatible).
 * No v-html — uses safe text interpolation.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  text: string
  animate: boolean
}>()

const emit = defineEmits<{
  complete: []
}>()

const INTERVAL_MS = 30
const MAX_DURATION_TICKS = 60 // ~1.8 second max reveal time

// Split text into individual characters
const characters = computed(() => {
  return [...props.text]
})

// Auto-scale chars per tick so animation finishes in a consistent time
const charsPerTick = computed(() => {
  return Math.max(1, Math.ceil(characters.value.length / MAX_DURATION_TICKS))
})

const visibleCount = ref(props.animate ? 0 : characters.value.length)
let timerId: ReturnType<typeof setInterval> | null = null

const isComplete = computed(() => visibleCount.value >= characters.value.length)

function startReveal() {
  if (!props.animate) {
    visibleCount.value = characters.value.length
    return
  }
  visibleCount.value = 0
  timerId = setInterval(() => {
    visibleCount.value += charsPerTick.value
    if (visibleCount.value >= characters.value.length) {
      visibleCount.value = characters.value.length
      if (timerId) {
        clearInterval(timerId)
        timerId = null
      }
      emit('complete')
    }
  }, INTERVAL_MS)
}

onMounted(() => {
  startReveal()
})

onUnmounted(() => {
  if (timerId) {
    clearInterval(timerId)
    timerId = null
  }
})
</script>

<template>
  <span class="text-reveal">
    <template v-if="isComplete">{{ text }}</template>
    <template v-else>
      <template v-for="(char, i) in characters" :key="i">
        <span
          v-if="i < visibleCount"
          :class="{ 'char-entering': i >= visibleCount - charsPerTick }"
        >{{ char }}</span>
      </template>
    </template>
  </span>
</template>

<style scoped>
.text-reveal {
  white-space: pre-wrap;
}

.char-entering {
  animation: charFadeIn 0.3s ease-out forwards;
}

@keyframes charFadeIn {
  from {
    opacity: 0.15;
  }
  to {
    opacity: 1;
  }
}
</style>
