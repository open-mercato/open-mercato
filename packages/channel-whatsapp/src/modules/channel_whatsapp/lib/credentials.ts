import { z } from 'zod'

export const WHATSAPP_PROVIDER_KEY = 'whatsapp'
export const WHATSAPP_CHANNEL_TYPE = 'whatsapp'
export const WHATSAPP_DEFAULT_API_VERSION = 'v20.0'

export const whatsappCredentialsSchema = z.object({
  accessToken: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  verifyToken: z.string().trim().min(1).optional(),
  appSecret: z.string().trim().min(1).optional(),
  apiVersion: z.string().trim().regex(/^v\d+\.\d+$/).optional(),
  defaultRecipient: z.string().trim().min(1).optional(),
})

export type WhatsappCredentials = z.infer<typeof whatsappCredentialsSchema>

export function parseWhatsappCredentialsOrThrow(raw: Record<string, unknown> | null | undefined): WhatsappCredentials {
  const parsed = whatsappCredentialsSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`[internal] Invalid WhatsApp credentials: ${issue?.message ?? 'unknown validation error'}`)
  }
  return parsed.data
}

export function resolveApiVersion(credentials: WhatsappCredentials): string {
  return credentials.apiVersion ?? WHATSAPP_DEFAULT_API_VERSION
}

export function resolveGraphUrl(credentials: WhatsappCredentials, path: string): string {
  return `https://graph.facebook.com/${resolveApiVersion(credentials)}/${path.replace(/^\/+/, '')}`
}
