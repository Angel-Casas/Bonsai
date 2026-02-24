import type { MiddlewareHandler } from 'hono'
import { verifyAccessToken } from '../services/jwt'

declare module 'hono' {
  interface ContextVariableMap {
    userId: string
    email: string
  }
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization token' }, 401)
  }

  const token = header.slice(7)
  try {
    const payload = await verifyAccessToken(token)
    c.set('userId', payload.userId)
    c.set('email', payload.email)
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}
