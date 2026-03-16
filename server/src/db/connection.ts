import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema.js'
import { fileURLToPath } from 'url'
import path from 'path'

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/bonsai'

const client = postgres(connectionString)
export const db = drizzle(client, { schema })

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function runMigrations() {
  const migrationsFolder = path.join(__dirname, 'migrations')
  await migrate(db, { migrationsFolder })
  console.log('Database migrations applied')
}
