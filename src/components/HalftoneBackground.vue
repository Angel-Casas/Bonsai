<script setup lang="ts">
/**
 * HalftoneBackground - Decorative background component
 *
 * Renders either the Lines background (animated blobs) or Blueprint background (simple grid).
 * Supports day/night modes and color palettes automatically via theme store.
 */

import { useThemeStore } from '@/stores/themeStore'
import LinesBackground from './LinesBackground.vue'
import BlueprintBackground from './BlueprintBackground.vue'

const themeStore = useThemeStore()
</script>

<template>
  <BlueprintBackground v-if="themeStore.isBlueprint" />
  <LinesBackground v-else />
</template>
