import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from './authStore'

describe('authStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('starts logged out', () => {
    const store = useAuthStore()
    expect(store.isLoggedIn).toBe(false)
    expect(store.user).toBeNull()
  })

  it('sets user on login', () => {
    const store = useAuthStore()
    store.setAuth({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      user: { id: 'u1', email: 'test@test.com' },
    })
    expect(store.isLoggedIn).toBe(true)
    expect(store.user?.email).toBe('test@test.com')
  })

  it('clears state on logout', () => {
    const store = useAuthStore()
    store.setAuth({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      user: { id: 'u1', email: 'test@test.com' },
    })
    store.logout()
    expect(store.isLoggedIn).toBe(false)
    expect(store.user).toBeNull()
  })

  it('persists tokens to localStorage', () => {
    const store = useAuthStore()
    store.setAuth({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      user: { id: 'u1', email: 'test@test.com' },
    })
    expect(localStorage.getItem('bonsai:auth:accessToken')).toBe('test-access')
    expect(localStorage.getItem('bonsai:auth:refreshToken')).toBe('test-refresh')
  })
})
