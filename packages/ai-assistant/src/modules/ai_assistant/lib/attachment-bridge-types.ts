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
  features: string[]
  isSuperAdmin: boolean
}
