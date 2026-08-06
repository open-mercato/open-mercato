import { z } from 'zod'
import {
  PUSH_CREDENTIAL_ERROR_INVALID_JSON,
  PUSH_CREDENTIAL_ERROR_MISSING_FIELDS,
  PUSH_CREDENTIAL_ERROR_REQUIRED,
} from '@open-mercato/core/modules/communication_channels/lib/push-credential-errors'

/**
 * Firebase service account shape (camelCase) used to mint FCM credentials.
 * Source JSON from the Firebase console uses snake_case keys, normalized by
 * {@link parseFcmServiceAccount}.
 */
export const fcmServiceAccountSchema = z
  .object({
    projectId: z.string().min(1, 'project_id missing'),
    clientEmail: z.string().min(1, 'client_email missing'),
    privateKey: z.string().min(1, 'private_key missing'),
  })
  .passthrough()

export type FcmServiceAccount = z.infer<typeof fcmServiceAccountSchema>

function normalizeServiceAccount(raw: Record<string, unknown>): FcmServiceAccount {
  return fcmServiceAccountSchema.parse({
    projectId: raw.projectId ?? raw.project_id,
    clientEmail: raw.clientEmail ?? raw.client_email,
    privateKey: raw.privateKey ?? raw.private_key,
  })
}

/**
 * Tenant-level FCM credentials persisted on `IntegrationCredentials` for provider
 * `channel_fcm`. `serviceAccountJson` is the full Firebase service-account JSON
 * (stored encrypted at rest); `appName` is an optional label for the cached
 * firebase-admin app.
 */
export const fcmCredentialsSchema = z
  .object({
    serviceAccountJson: z.string().min(1, PUSH_CREDENTIAL_ERROR_REQUIRED),
    appName: z.string().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    // Two distinct failures, two distinct codes. Never interpolate the caught
    // error: a `normalizeServiceAccount` rejection is a ZodError whose
    // `.message` is a JSON dump of the issue array, which used to reach the
    // operator verbatim through `fieldErrors`.
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(value.serviceAccountJson) as Record<string, unknown>
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceAccountJson'],
        message: PUSH_CREDENTIAL_ERROR_INVALID_JSON,
      })
      return
    }
    const account = fcmServiceAccountSchema.safeParse({
      projectId: parsed.projectId ?? parsed.project_id,
      clientEmail: parsed.clientEmail ?? parsed.client_email,
      privateKey: parsed.privateKey ?? parsed.private_key,
    })
    if (!account.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceAccountJson'],
        message: PUSH_CREDENTIAL_ERROR_MISSING_FIELDS,
      })
    }
  })

export type FcmCredentials = z.infer<typeof fcmCredentialsSchema>

/** Parse and normalize the service account out of validated credentials. Throws on malformed JSON. */
export function parseFcmServiceAccount(credentials: FcmCredentials): FcmServiceAccount {
  const parsed = JSON.parse(credentials.serviceAccountJson) as Record<string, unknown>
  return normalizeServiceAccount(parsed)
}
