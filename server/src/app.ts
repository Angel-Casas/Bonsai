import { Hono } from 'hono'
import { cors } from 'hono/cors'
import auth from './routes/auth'
import subs from './routes/subscriptions'
import webhooks from './routes/webhooks'

const app = new Hono()

app.use('/*', cors({
  origin: ['http://localhost:5173', 'https://angel-casas.github.io'],
  credentials: true,
}))

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.route('/auth', auth)
app.route('/subscriptions', subs)
app.route('/webhooks', webhooks)

export default app
export type AppType = typeof app
