import { z } from 'zod'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

/**
 * Tenant-level APNs credentials persisted on `IntegrationCredentials` for provider
 * `channel_apns`. Token-based auth (Apple's `.p8` key) — `p8Key` is the PEM
 * contents (stored encrypted at rest), `keyId`/`teamId` identify the key, and
 * `bundleId` is the app's APNs `topic`. `production` selects the APNs host
 * (sandbox by default).
 */
export const apnsCredentialsSchema = z
  .object({
    p8Key: z.string().min(1, 'APNs .p8 key required'),
    keyId: z.string().min(1, 'APNs Key ID required'),
    teamId: z.string().min(1, 'Apple Team ID required'),
    bundleId: z.string().min(1, 'App Bundle ID required'),
    production: z.union([z.boolean(), z.string()]).optional(),
  })
  .passthrough()

export type ApnsCredentials = z.infer<typeof apnsCredentialsSchema>

export interface ApnsResolvedCredentials {
  p8Key: string
  keyId: string
  teamId: string
  bundleId: string
  production: boolean
}

/** Resolve validated credentials into the strongly-typed send config (parsing the production flag). */
export function resolveApnsCredentials(credentials: ApnsCredentials): ApnsResolvedCredentials {
  const production =
    typeof credentials.production === 'boolean'
      ? credentials.production
      : parseBooleanWithDefault(credentials.production, false)
  return {
    p8Key: credentials.p8Key,
    keyId: credentials.keyId,
    teamId: credentials.teamId,
    bundleId: credentials.bundleId,
    production,
  }
}
