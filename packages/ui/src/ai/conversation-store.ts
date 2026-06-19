"use client"

import type { AiChatMessage, AiChatMessageUiPart } from './useAiChat'

const CONVERSATIONS_ENDPOINT = '/api/ai_assistant/ai/conversations'

export interface AiServerConversation {
  conversationId: string
  agentId: string
  title: string | null
  status: 'open' | 'closed'
  visibility: 'private' | 'shared' | 'organization'
  pageContext: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
  importedFromLocalAt: string | null
  /** `true` when the authenticated caller created the conversation; `false` for shared participants; `null` when unknown. */
  isOwner: boolean | null
}

export interface AiServerMessage {
  id: string
  clientMessageId: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  uiParts: unknown[]
  attachmentIds: string[]
  files: Array<Record<string, unknown>>
  model: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  senderUserId: string | null
}

export interface AiServerConversationListResponse {
  items: AiServerConversation[]
  nextCursor: string | null
}

export interface AiServerTranscriptResponse {
  conversation: AiServerConversation
  messages: AiServerMessage[]
  nextCursor: string | null
}

export interface AiServerImportResponse {
  conversation: AiServerConversation
  importedMessageCount: number
  skippedMessageCount: number
}

/**
 * Discriminated result of {@link loadAiServerTranscript}. Callers must
 * distinguish 404 (the conversation does not exist for the current scope —
 * e.g. it belonged to a previous tenant/org) from other failures (network
 * down, server error) because the recovery strategies are opposite:
 *  - `notFound: true`  → drop the local cache, optionally surface a
 *                         not-found callback. NEVER import local messages
 *                         onto the new scope.
 *  - `notFound: false` → preserve local state and retry later.
 */
export type LoadTranscriptResult =
  | { ok: true; data: AiServerTranscriptResponse }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false }

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function buildAttachmentImagePreviewUrl(attachmentId: string): string {
  const params = new URLSearchParams({
    width: '320',
    height: '320',
    cropType: 'contain',
  })
  return `/api/attachments/image/${encodeURIComponent(attachmentId)}?${params.toString()}`
}

function getFetch(): typeof fetch | null {
  const fetchImpl = (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch
  return typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null
}

async function requestJson<T>(
  input: string,
  init?: RequestInit,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; data: null }> {
  const fetchImpl = getFetch()
  if (!fetchImpl) return { ok: false, status: 0, data: null }
  try {
    const response = await fetchImpl(input, {
      credentials: 'include',
      ...init,
      headers: {
        Accept: 'application/json',
        'x-om-forbidden-redirect': '0',
        'x-om-unauthorized-redirect': '0',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) return { ok: false, status: response.status, data: null }
    return { ok: true, status: response.status, data: (await response.json()) as T }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}

export async function listAiServerConversations(options: {
  agentId?: string | null
  status?: 'open' | 'closed' | null
  limit?: number
} = {}): Promise<AiServerConversation[] | null> {
  const params = new URLSearchParams()
  if (options.agentId) params.set('agent', options.agentId)
  if (options.status) params.set('status', options.status)
  params.set('limit', String(options.limit ?? 100))
  const result = await requestJson<AiServerConversationListResponse>(
    `${CONVERSATIONS_ENDPOINT}?${params.toString()}`,
  )
  return result.ok ? result.data.items : null
}

export async function createAiServerConversation(input: {
  agentId: string
  conversationId: string
  title?: string | null
  pageContext?: Record<string, unknown> | null
}): Promise<AiServerConversation | null> {
  const result = await requestJson<AiServerConversation>(CONVERSATIONS_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({
      agentId: input.agentId,
      conversationId: input.conversationId,
      title: input.title ?? undefined,
      pageContext: input.pageContext ?? undefined,
    }),
  })
  return result.ok ? result.data : null
}

export async function updateAiServerConversation(
  conversationId: string,
  patch: {
    title?: string | null
    status?: 'open' | 'closed'
    pageContext?: Record<string, unknown> | null
  },
): Promise<AiServerConversation | null> {
  const result = await requestJson<AiServerConversation>(
    `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(conversationId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  )
  return result.ok ? result.data : null
}

export async function loadAiServerTranscript(
  conversationId: string,
  options: { limit?: number } = {},
): Promise<LoadTranscriptResult> {
  const params = new URLSearchParams()
  params.set('limit', String(options.limit ?? 100))
  const result = await requestJson<AiServerTranscriptResponse>(
    `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(conversationId)}?${params.toString()}`,
  )
  if (result.ok) return { ok: true, data: result.data }
  return { ok: false, notFound: result.status === 404 }
}

export async function importAiLocalConversation(input: {
  agentId: string
  conversationId: string
  title?: string | null
  status?: 'open' | 'closed'
  pageContext?: Record<string, unknown> | null
  messages: AiChatMessage[]
}): Promise<AiServerImportResponse | null> {
  const result = await requestJson<AiServerImportResponse>(`${CONVERSATIONS_ENDPOINT}/import`, {
    method: 'POST',
    body: JSON.stringify({
      conversation: {
        conversationId: input.conversationId,
        agentId: input.agentId,
        title: input.title ?? undefined,
        status: input.status ?? 'open',
        pageContext: input.pageContext ?? undefined,
      },
      messages: input.messages.slice(-100).map((message) => ({
        clientMessageId: message.id,
        role: message.role,
        content: message.content,
        uiParts: message.uiParts ?? [],
        files: (message.files ?? []).map((file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.type,
        })),
      })),
    }),
  })
  return result.ok ? result.data : null
}

export function serverMessageToChatMessage(message: AiServerMessage): AiChatMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const uiParts: AiChatMessageUiPart[] = []
  message.uiParts.forEach((part, index) => {
    if (!part || typeof part !== 'object') return
    const value = part as Record<string, unknown>
    const componentId =
      typeof value.componentId === 'string'
        ? value.componentId
        : typeof value.type === 'string'
          ? value.type
          : null
    if (!componentId) return
    uiParts.push({
      componentId,
      payload: value.payload ?? value.props,
      pendingActionId:
        typeof value.pendingActionId === 'string' ? value.pendingActionId : undefined,
      key:
        typeof value.key === 'string'
          ? value.key
          : `${message.id}:${index}:${componentId}`,
    })
  })
  return {
    id: message.clientMessageId ?? message.id,
    role: message.role,
    content: message.content,
    files: message.files
      .map((file, index) => {
        const name = readString(file.name)
        if (!name) return null
        const type =
          typeof file.mimeType === 'string'
            ? file.mimeType
            : typeof file.type === 'string'
              ? file.type
              : 'application/octet-stream'
        const id = readString(file.id) ?? readString(message.attachmentIds[index])
        const rawPreviewUrl =
          readString(file.previewUrl) ??
          readString(file.thumbnailUrl) ??
          readString(file.url)
        const previewUrl = type.startsWith('image/')
          ? rawPreviewUrl ?? (id ? buildAttachmentImagePreviewUrl(id) : undefined)
          : undefined
        return {
          ...(id ? { id } : {}),
          name,
          type,
          ...(previewUrl ? { previewUrl } : {}),
        }
      })
      .filter((file): file is NonNullable<AiChatMessage['files']>[number] => file !== null),
    uiParts,
    senderUserId: message.senderUserId ?? null,
  }
}
