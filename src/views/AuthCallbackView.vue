<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const error = ref('')

onMounted(() => {
  const accessToken = route.query.accessToken as string
  const refreshToken = route.query.refreshToken as string

  if (!accessToken || !refreshToken) {
    error.value = 'Authentication failed'
    return
  }

  try {
    const parts = accessToken.split('.')
    const payload = JSON.parse(atob(parts[1]!))
    authStore.setAuth({
      accessToken,
      refreshToken,
      user: { id: payload.userId, email: payload.email },
    })
    router.push({ name: 'home' })
  } catch {
    error.value = 'Failed to process authentication'
  }
})
</script>

<template>
  <div class="auth-callback">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else>Signing you in...</p>
  </div>
</template>
