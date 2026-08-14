import type { APIRequestContext, APIResponse } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

/** UI-facing template metadata as returned by GET /api/document-generators/templates. */
export interface TemplateMeta {
  id: string
  label: string
  description: string
  module: string
  resourceKind: string
  documentType: string
  format?: 'pdf' | 'md'
  tags: string[]
  note?: string
  requiredFeatures?: string[]
}

export interface TemplateFilterOptions {
  resourceKinds: string[]
  formats: string[]
}

export interface GeneratedDocumentRow {
  id: string
  resourceKind: string
  resourceId: string
  resourceLabel: string
  templateId: string
  templateLabel: string
  format: string
  generatedBy: string
  generatedAt: string
}

export interface GeneratedDocumentPage {
  items: GeneratedDocumentRow[]
  total: number
  page: number
  pageSize: number
}

export interface DocumentHistoryQuery {
  resource_kind?: string
  resource_id?: string
  template_id?: string
  generated_by?: string
  generated_from?: string
  generated_to?: string
  sort?: 'resource_label' | 'template_label' | 'format' | 'generated_by' | 'generated_at'
  sort_direction?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export async function listTemplates(
  request: APIRequestContext,
  token: string,
): Promise<TemplateMeta[]> {
  const response = await apiRequest(request, 'GET', '/api/document-generators/templates', { token })
  if (!response.ok()) {
    throw new Error(`[internal] Failed to list templates: ${response.status()} ${await response.text()}`)
  }
  return response.json()
}

export async function listTemplateFilterOptions(
  request: APIRequestContext,
  token: string,
): Promise<TemplateFilterOptions> {
  const response = await apiRequest(request, 'GET', '/api/document-generators/templates/options', { token })
  if (!response.ok()) {
    throw new Error(`[internal] Failed to list template filter options: ${response.status()} ${await response.text()}`)
  }
  return response.json()
}

/**
 * Calls POST /api/document-generators/preview and returns the raw response, because
 * the endpoint streams a document on success and returns JSON on error — the caller
 * asserts on status, headers, and body, so nothing may be pre-parsed here.
 */
export async function previewDocument(
  request: APIRequestContext,
  token: string,
  body: { template_id?: string; data?: unknown },
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/document-generators/preview', { token, data: body })
}

/**
 * Calls POST /api/document-generators/generate and returns the raw response. Like
 * preview it streams a document on success and JSON on error; unlike preview it is
 * the production path that persists a history record and names the download through
 * Content-Disposition.
 */
export async function generateDocument(
  request: APIRequestContext,
  token: string,
  body: { template_id?: string; data?: unknown },
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/document-generators/generate', { token, data: body })
}

export async function listGeneratedDocuments(
  request: APIRequestContext,
  token: string,
  query: DocumentHistoryQuery = {},
): Promise<GeneratedDocumentPage> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const suffix = search.toString() ? `?${search.toString()}` : ''
  const response = await apiRequest(request, 'GET', `/api/document-generators/documents${suffix}`, { token })
  if (!response.ok()) {
    throw new Error(`[internal] Failed to list generated documents: ${response.status()} ${await response.text()}`)
  }
  return response.json()
}

export async function deleteGeneratedDocumentsForResource(resourceId: string | null): Promise<void> {
  if (!resourceId) return
  await withClient(async (client) => {
    await client.query(
      'delete from document_generators_generated_documents where resource_id = $1',
      [resourceId],
    )
  })
}

export async function readJsonBody(response: APIResponse): Promise<Record<string, unknown>> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function requiredFeaturesOf(body: Record<string, unknown>): string[] {
  return Array.isArray(body.requiredFeatures) ? (body.requiredFeatures as string[]) : []
}

export function isPdfStream(buffer: Buffer): boolean {
  return buffer.subarray(0, 4).toString('latin1') === '%PDF'
}
