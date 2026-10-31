import { randomBytes } from 'node:crypto'

export function resolveEphemeralSuperadminPassword(env: NodeJS.ProcessEnv = process.env): string {
  const configuredPassword = env.OM_INIT_SUPERADMIN_PASSWORD
  return configuredPassword?.trim() ? configuredPassword : `Aa1!${randomBytes(32).toString('hex')}`
}
