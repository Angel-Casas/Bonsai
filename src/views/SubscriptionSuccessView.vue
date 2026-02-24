<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSubscriptionStore } from '@/stores/subscriptionStore'

const router = useRouter()
const subscriptionStore = useSubscriptionStore()

onMounted(async () => {
  await subscriptionStore.fetchStatus()
  setTimeout(() => router.push({ name: 'home' }), 2000)
})
</script>

<template>
  <div class="subscription-success">
    <h2>Payment received!</h2>
    <p>Your subscription is being activated. Redirecting...</p>
  </div>
</template>
