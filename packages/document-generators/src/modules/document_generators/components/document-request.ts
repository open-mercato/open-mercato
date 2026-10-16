import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENT_GENERATORS_API_BASE } from '../hooks/document-queries'
import { getFilenameFromResponse, resolveErrorMessage } from '../utils'

export type DocumentRequestAction = 'preview' | 'generate'

export type DocumentRequestInput = {
  action: DocumentRequestAction
  templateId: string
  recordId: string
  templateVersion?: string
  translate: TranslateFn
  signal?: AbortSignal
}

export type DocumentRequestResult = { blob: Blob; filename: string }

export class DocumentRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentRequestError'
  }
}

async function readErrorPayload(blob: Blob | null): Promise<unknown> {
  if (!blob) return null
  try {
    return JSON.parse(await blob.text())
  } catch {
    return null
  }
}

export async function requestDocument(input: DocumentRequestInput): Promise<DocumentRequestResult> {
  const call = await apiCall<Blob>(
    `${DOCUMENT_GENERATORS_API_BASE}/${input.action}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: input.templateId,
        ...(input.templateVersion ? { template_version: input.templateVersion } : {}),
        data: { id: input.recordId },
      }),
      signal: input.signal,
    },
    { parse: (response) => response.blob() },
  )
  if (!call.ok || !call.result) {
    const payload = await readErrorPayload(call.result)
    const fallback = call.status === 403 ? { error: 'forbidden' } : payload
    throw new DocumentRequestError(resolveErrorMessage(fallback, input.translate))
  }
  return { blob: call.result, filename: getFilenameFromResponse(call.response) }
}

export async function requestStoredDocument(input: { historyId: string; translate: TranslateFn }): Promise<DocumentRequestResult> {
  const call = await apiCall<Blob>(
    `${DOCUMENT_GENERATORS_API_BASE}/documents/${encodeURIComponent(input.historyId)}/file`,
    { method: 'GET' },
    { parse: (response) => response.blob() },
  )
  if (!call.ok || !call.result) {
    const payload = await readErrorPayload(call.result)
    const fallback = call.status === 403 ? { error: 'forbidden' } : payload
    throw new DocumentRequestError(resolveErrorMessage(fallback, input.translate))
  }
  return { blob: call.result, filename: getFilenameFromResponse(call.response) }
}
