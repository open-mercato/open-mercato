import { createPrivateKey } from 'node:crypto'
import { z } from 'zod'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  PUSH_CREDENTIAL_ERROR_INVALID_BUNDLE_ID,
  PUSH_CREDENTIAL_ERROR_INVALID_KEY_ID,
  PUSH_CREDENTIAL_ERROR_INVALID_P8,
  PUSH_CREDENTIAL_ERROR_INVALID_TEAM_ID,
  PUSH_CREDENTIAL_ERROR_REQUIRED,
} from '@open-mercato/core/modules/communication_channels/lib/push-credential-errors'

/** Apple issues both Key IDs and Team IDs as exactly 10 alphanumeric characters. */
const APPLE_TEN_CHAR_ID = /^[A-Za-z0-9]{10}$/
/** Reverse-DNS app identifier, e.g. `com.example.app`; also the APNs `topic`. */
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/

/**
 * Structurally verify Apple's `.p8` signing key without contacting APNs.
 * `createPrivateKey` parses the PEM and rejects anything that is not a readable
 * private key, which is what makes a pasted-by-mistake string fail at connect
 * time instead of silently producing a channel that can never deliver.
 *
 * This proves the key is well-formed, NOT that Apple accepts it — a
 * syntactically valid key from the wrong developer account still connects. Live
 * verification is tracked separately.
 */
function isParseablePrivateKey(value: string): boolean {
  try {
    createPrivateKey(value)
    return true
  } catch {
    return false
  }
}

/**
 * Tenant-level APNs credentials persisted on `IntegrationCredentials` for provider
 * `channel_apns`. Token-based auth (Apple's `.p8` key) — `p8Key` is the PEM
 * contents (stored encrypted at rest), `keyId`/`teamId` identify the key, and
 * `bundleId` is the app's APNs `topic`. `production` selects the APNs host
 * (sandbox by default).
 */
export const apnsCredentialsSchema = z
  .object({
    p8Key: z
      .string()
      .min(1, PUSH_CREDENTIAL_ERROR_REQUIRED)
      .refine(isParseablePrivateKey, PUSH_CREDENTIAL_ERROR_INVALID_P8),
    keyId: z
      .string()
      .min(1, PUSH_CREDENTIAL_ERROR_REQUIRED)
      .regex(APPLE_TEN_CHAR_ID, PUSH_CREDENTIAL_ERROR_INVALID_KEY_ID),
    teamId: z
      .string()
      .min(1, PUSH_CREDENTIAL_ERROR_REQUIRED)
      .regex(APPLE_TEN_CHAR_ID, PUSH_CREDENTIAL_ERROR_INVALID_TEAM_ID),
    bundleId: z
      .string()
      .min(1, PUSH_CREDENTIAL_ERROR_REQUIRED)
      .regex(BUNDLE_ID, PUSH_CREDENTIAL_ERROR_INVALID_BUNDLE_ID),
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
