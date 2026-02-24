<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const error = ref('')

onMounted(async () => {
  const token = route.query.token as string
  if (!token) {
    error.value = 'Invalid verification link'
    return
  }
  try {
    await authStore.verifyMagicLink(token)
    router.push({ name: 'home' })
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Verification failed'
  }
})
</script>

<template>
  <div class="auth-verify">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else>Verifying your sign-in link...</p>
  </div>
</template>
