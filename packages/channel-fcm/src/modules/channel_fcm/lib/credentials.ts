import { z } from 'zod'

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
    serviceAccountJson: z.string().min(1, 'FCM service account JSON required'),
    appName: z.string().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    try {
      const parsed = JSON.parse(value.serviceAccountJson) as Record<string, unknown>
      normalizeServiceAccount(parsed)
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceAccountJson'],
        message:
          err instanceof Error && err.message.length > 0
            ? `Invalid FCM service account JSON: ${err.message}`
            : 'Invalid FCM service account JSON',
      })
    }
  })

export type FcmCredentials = z.infer<typeof fcmCredentialsSchema>

/** Parse and normalize the service account out of validated credentials. Throws on malformed JSON. */
export function parseFcmServiceAccount(credentials: FcmCredentials): FcmServiceAccount {
  const parsed = JSON.parse(credentials.serviceAccountJson) as Record<string, unknown>
  return normalizeServiceAccount(parsed)
}
