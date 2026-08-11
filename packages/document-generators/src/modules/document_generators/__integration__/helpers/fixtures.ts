import type { APIRequestContext, APIResponse } from '@playwright/test'
import { apiRequest } from './api'

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
}

export interface TemplatesResponse {
  internal: TemplateMeta[]
  external: TemplateMeta[]
}

export async function listTemplates(
  request: APIRequestContext,
  token: string,
): Promise<TemplatesResponse> {
  const response = await apiRequest(request, 'GET', '/api/document-generators/templates', { token })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to list templates: ${response.status()} ${body}`)
  }
  return response.json()
}

/**
 * Calls POST /api/document-generators/preview and returns the raw response so the
 * caller can assert on status, headers, and body — the endpoint streams a PDF
 * on success and returns JSON on error, so it must not be pre-parsed here.
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
 * preview it streams a PDF on success and JSON on error; unlike preview it is
 * the production path (side effects land here in Phase 5) and drives the
 * download filename via Content-Disposition.
 */
export async function generateDocument(
  request: APIRequestContext,
  token: string,
  body: { template_id?: string; data?: unknown; resource_kind?: string; resource_id?: string },
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/document-generators/generate', { token, data: body })
}

export interface HistoryItem {
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

export async function listDocuments(
  request: APIRequestContext,
  token: string,
  query: { resource_kind?: string; resource_id?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: HistoryItem[]; total: number; page: number; pageSize: number }> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const response = await apiRequest(request, 'GET', `/api/document-generators/documents${suffix}`, { token })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to list documents: ${response.status()} ${body}`)
  }
  return response.json()
}
