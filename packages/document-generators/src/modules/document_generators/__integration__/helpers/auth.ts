import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadEnvFileContent(): string | null {
  const candidatePaths = [
    resolve(process.cwd(), 'apps/sandbox/.env'),
    resolve(process.cwd(), '.env'),
  ]

  for (const envPath of candidatePaths) {
    try {
      const content = readFileSync(envPath, 'utf-8')
      if (content.trim().length > 0) {
        return content
      }
    } catch {
      continue
    }
  }

  return null
}

function loadEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key]
  const content = loadEnvFileContent()
  if (!content) return undefined
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return match?.[1]?.trim()
}

export const DEFAULT_CREDENTIALS: Record<string, { email: string; password: string }> = {
  superadmin: {
    email: loadEnvValue('OM_INIT_SUPERADMIN_EMAIL') || 'superadmin@acme.com',
    password: loadEnvValue('OM_INIT_SUPERADMIN_PASSWORD') || 'secret',
  },
  admin: { email: 'admin@acme.com', password: 'secret' },
  employee: { email: 'employee@acme.com', password: 'secret' },
}

export type Role = 'superadmin' | 'admin' | 'employee'
