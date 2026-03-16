<script setup lang="ts">
/**
 * App Shell
 *
 * Root component that provides the router view for page navigation.
 * Also renders the settings overlay panel on top of any page.
 */
import { onMounted, onUnmounted } from 'vue'
import SettingsView from '@/views/SettingsView.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import TutorialOverlay from '@/components/TutorialOverlay.vue'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import { useTutorial } from '@/composables/useTutorial'

const { isSettingsOpen, closeSettings } = useSettingsPanel()
const tutorial = useTutorial()

function handleKeydown(e: KeyboardEvent) {
  // Tutorial captures its own Escape via capture phase listener
  if (tutorial.isActive.value) return
  if (e.key === 'Escape' && isSettingsOpen.value) {
    closeSettings()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <RouterView />

  <!-- Settings overlay panel -->
  <Transition name="settings-fade">
    <div
      v-if="isSettingsOpen"
      class="settings-overlay"
      @click.self="closeSettings"
    >
      <div class="settings-panel">
        <SettingsView @close="closeSettings" />
      </div>
    </div>
  </Transition>

  <ToastContainer />
  <TutorialOverlay />
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  top: 60px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  overflow-y: auto;
}

.settings-panel {
  max-width: 42rem;
  margin: 2rem auto;
  padding: 0 1rem 2rem;
}

/* Fade + slide-up transition */
.settings-fade-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.settings-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.settings-fade-enter-from {
  opacity: 0;
}
.settings-fade-enter-from .settings-panel {
  transform: translateY(12px);
}
.settings-fade-leave-to {
  opacity: 0;
}
</style>
