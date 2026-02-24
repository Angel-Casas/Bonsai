import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface AuthUser {
  id: string
  email: string
}

interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: AuthUser
}

const SYNC_SERVER_URL = import.meta.env.VITE_SYNC_SERVER_URL || 'http://localhost:3000'

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(localStorage.getItem('bonsai:auth:accessToken'))
  const refreshToken = ref<string | null>(localStorage.getItem('bonsai:auth:refreshToken'))
  const user = ref<AuthUser | null>(
    (() => {
      const saved = localStorage.getItem('bonsai:auth:user')
      return saved ? JSON.parse(saved) : null
    })()
  )

  const isLoggedIn = computed(() => !!accessToken.value && !!user.value)

  function setAuth(auth: AuthResponse) {
    accessToken.value = auth.accessToken
    refreshToken.value = auth.refreshToken
    user.value = auth.user
    localStorage.setItem('bonsai:auth:accessToken', auth.accessToken)
    localStorage.setItem('bonsai:auth:refreshToken', auth.refreshToken)
    localStorage.setItem('bonsai:auth:user', JSON.stringify(auth.user))
  }

  function logout() {
    accessToken.value = null
    refreshToken.value = null
    user.value = null
    localStorage.removeItem('bonsai:auth:accessToken')
    localStorage.removeItem('bonsai:auth:refreshToken')
    localStorage.removeItem('bonsai:auth:user')
  }

  async function requestMagicLink(email: string): Promise<void> {
    const res = await fetch(`${SYNC_SERVER_URL}/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.error || 'Failed to send magic link')
    }
  }

  async function verifyMagicLink(token: string): Promise<void> {
    const res = await fetch(`${SYNC_SERVER_URL}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.error || 'Verification failed')
    }
    const data: AuthResponse = await res.json()
    setAuth(data)
  }

  async function refreshAccessToken(): Promise<string | null> {
    if (!refreshToken.value) return null
    const res = await fetch(`${SYNC_SERVER_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshToken.value }),
    })
    if (!res.ok) {
      logout()
      return null
    }
    const data = await res.json()
    accessToken.value = data.accessToken
    localStorage.setItem('bonsai:auth:accessToken', data.accessToken)
    return data.accessToken
  }

  async function getValidToken(): Promise<string | null> {
    if (!accessToken.value) return null
    return accessToken.value
  }

  function getGoogleOAuthUrl(): string {
    return `${SYNC_SERVER_URL}/auth/google`
  }

  return {
    accessToken,
    refreshToken,
    user,
    isLoggedIn,
    setAuth,
    logout,
    requestMagicLink,
    verifyMagicLink,
    refreshAccessToken,
    getValidToken,
    getGoogleOAuthUrl,
  }
})
