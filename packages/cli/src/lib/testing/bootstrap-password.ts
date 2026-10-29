import { randomBytes } from 'node:crypto'

export function resolveEphemeralSuperadminPassword(env: NodeJS.ProcessEnv = process.env): string {
  return env.OM_INIT_SUPERADMIN_PASSWORD ?? `Aa1!${randomBytes(32).toString('hex')}`
}
