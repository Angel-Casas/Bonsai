import { Hono } from 'hono'
import { cors } from 'hono/cors'
import auth from './routes/auth'

const app = new Hono()

app.use('/*', cors({
  origin: ['http://localhost:5173', 'https://angel-casas.github.io'],
  credentials: true,
}))

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.route('/auth', auth)

export default app
export type AppType = typeof app
