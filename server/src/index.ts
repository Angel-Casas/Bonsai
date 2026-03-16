import { serve } from '@hono/node-server'
import app from './app.js'
import { runMigrations } from './db/connection.js'

const port = Number(process.env.PORT) || 3000

async function start() {
  await runMigrations()
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Bonsai Sync Server running on port ${port}`)
  })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})

export default app
export type { AppType } from './app.js'
