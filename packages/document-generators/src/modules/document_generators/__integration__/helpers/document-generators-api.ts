import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

export const ORDER_PDF_TEMPLATE = 'sales.order-invoice'
export const ORDER_MARKDOWN_TEMPLATE = 'sales.order-invoice-markdown'
export const QUOTE_PDF_TEMPLATE = 'sales.offer'
export const ORDER_KIND = 'sales.order'
export const QUOTE_KIND = 'sales.quote'
export const DOCUMENTS_VIEW_FEATURE = 'document_generators.documents.view'
export const DOCUMENTS_GENERATE_FEATURE = 'document_generators.documents.generate'

export type TemplateDto = {
  id: string
  label: string
  resourceKind: string
  documentType: string
  format: string
  tags: string[]
  requiredFeatures?: string[]
}

export type HistoryRowDto = {
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

export type HistoryPageDto = { items: HistoryRowDto[]; total: number; page: number; pageSize: number }
export type ErrorEnvelope = { error?: string; message?: string; requiredFeatures?: string[]; issues?: unknown }

const BASE = '/api/document-generators'

function toQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function listTemplates(request: APIRequestContext, token: string, query?: Record<string, string | undefined>) {
  return apiRequest(request, 'GET', `${BASE}/templates${toQueryString(query)}`, { token })
}

export function listTemplateOptions(request: APIRequestContext, token: string) {
  return apiRequest(request, 'GET', `${BASE}/templates/options`, { token })
}

export function previewDocument(request: APIRequestContext, token: string, body: unknown) {
  return apiRequest(request, 'POST', `${BASE}/preview`, { token, data: body })
}

export function generateDocument(request: APIRequestContext, token: string, body: unknown) {
  return apiRequest(request, 'POST', `${BASE}/generate`, { token, data: body })
}

export function listDocuments(request: APIRequestContext, token: string, query?: Record<string, string | number | undefined>) {
  return apiRequest(request, 'GET', `${BASE}/documents${toQueryString(query)}`, { token })
}

export async function readTemplates(response: APIResponse): Promise<TemplateDto[]> {
  expect(response.status(), 'GET /templates should return 200').toBe(200)
  const body = await readJsonSafe<TemplateDto[]>(response)
  expect(Array.isArray(body), 'GET /templates should return an array').toBe(true)
  return body as TemplateDto[]
}

export async function readHistoryPage(response: APIResponse): Promise<HistoryPageDto> {
  expect(response.status(), 'GET /documents should return 200').toBe(200)
  const body = await readJsonSafe<HistoryPageDto>(response)
  expect(body && Array.isArray(body.items), 'GET /documents should return an items array').toBe(true)
  return body as HistoryPageDto
}

export async function readErrorEnvelope(response: APIResponse, status: number, code: string): Promise<ErrorEnvelope> {
  const raw = await response.text()
  expect(response.status(), `Expected ${status} ${code}, got ${response.status()}: ${raw.slice(0, 300)}`).toBe(status)
  const body = (raw ? JSON.parse(raw) : null) as ErrorEnvelope | null
  expect(body?.error).toBe(code)
  expect(typeof body?.message === 'string' && body.message.length > 0, 'error envelope carries a translated message').toBe(true)
  return body as ErrorEnvelope
}

export function expectDocumentHeaders(response: APIResponse, input: { contentType: RegExp; extension: string }): void {
  const headers = response.headers()
  expect(headers['content-type']).toMatch(input.contentType)
  expect(headers['cache-control']).toContain('no-store')
  expect(headers['x-content-type-options']).toBe('nosniff')
  const disposition = headers['content-disposition'] ?? ''
  expect(disposition).toMatch(/^attachment;/)
  expect(disposition).toContain("filename*=UTF-8''")
  expect(disposition).toContain(`.${input.extension}`)
}

export async function expectPdfBody(response: APIResponse): Promise<void> {
  const buffer = await response.body()
  expect(buffer.length).toBeGreaterThan(100)
  expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF')
}

export function randomUuid(): string {
  return crypto.randomUUID()
}

export async function createOrderWithLine(request: APIRequestContext, token: string): Promise<string> {
  const orderId = await createSalesOrderFixture(request, token, 'USD')
  await createOrderLineFixture(request, token, orderId, { name: `QA TC-DOCUMENT line ${Date.now()}` })
  return orderId
}

export async function createQuote(request: APIRequestContext, token: string): Promise<string> {
  return createSalesQuoteFixture(request, token, 'USD')
}

export async function deleteOrder(request: APIRequestContext, token: string | null, orderId: string | null): Promise<void> {
  await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
}

export async function deleteQuote(request: APIRequestContext, token: string | null, quoteId: string | null): Promise<void> {
  await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
}

export async function fetchResourceHistory(
  request: APIRequestContext,
  token: string,
  resourceKind: string,
  resourceId: string,
): Promise<HistoryPageDto> {
  return readHistoryPage(await listDocuments(request, token, { resource_kind: resourceKind, resource_id: resourceId, pageSize: 100 }))
}

export async function pollResourceHistory(
  request: APIRequestContext,
  token: string,
  resourceKind: string,
  resourceId: string,
  minimumRows: number,
): Promise<HistoryPageDto> {
  let page = await fetchResourceHistory(request, token, resourceKind, resourceId)
  for (let attempt = 0; attempt < 10 && page.items.length < minimumRows; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    page = await fetchResourceHistory(request, token, resourceKind, resourceId)
  }
  return page
}

export async function expectUnauthenticated(
  method: 'GET' | 'POST',
  path: string,
  data?: unknown,
): Promise<void> {
  await withCredentialIsolatedRequest(async (isolated) => {
    const response = await isolated.fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      data,
    })
    expect(response.status()).toBe(401)
  })
}

export function getOrganizationId(token: string): string {
  return getTokenContext(token).organizationId
}
