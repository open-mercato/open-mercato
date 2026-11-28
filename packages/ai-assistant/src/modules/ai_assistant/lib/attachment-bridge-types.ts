export type AttachmentSource = 'bytes' | 'signed-url' | 'text' | 'metadata-only'

export interface AiResolvedAttachmentPart {
  attachmentId: string
  fileName: string
  mediaType: string
  source: AttachmentSource
  textContent?: string | null
  url?: string | null
  data?: Uint8Array | string | null
}

export interface AiUiPart {
  componentId: string
  props: Record<string, unknown>
}

export interface AiChatRequestContext {
  tenantId: string | null
  organizationId: string | null
  userId: string
  /** Set for key-authenticated calls. */
  principalApiKeyId?: string | null
  /** The verified user a session-bound `principalApiKeyId` acts for. */
  apiKeyUserId?: string | null
  features: string[]
  isSuperAdmin: boolean
}
