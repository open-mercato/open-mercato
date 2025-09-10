import 'dotenv/config'
import type { Config } from 'drizzle-kit'

export default {
  schema: ['./src/db/schema.ts', './src/modules/**/db/schema.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
  },
  verbose: true,
  strict: true,
} satisfies Config
