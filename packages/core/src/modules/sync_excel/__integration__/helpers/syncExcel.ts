import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'

export type JsonRecord = Record<string, unknown>

export const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
export const ENTITY_TYPE = 'customers.person'
export const INTEGRATION_ID = 'sync_excel'

export const SAMPLE_CSV = 'Record Id,Lead Name,Email\nsx-fixture,Sample Lead,sample@example.com\n'

type MultipartFilePart = { name: string; mimeType: string; buffer: Buffer }
type MultipartValue = string | MultipartFilePart
export type MultipartPayload = Record<string, MultipartValue>

export async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

export function decodeTokenScope(token: string): { tenantId: string; orgId: string } {
  const [, payload] = token.split('.')
  if (!payload) throw new Error('Auth token is missing a JWT payload')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JsonRecord
  const tenantId = typeof claims.tenantId === 'string' ? claims.tenantId : ''
  const orgId = typeof claims.orgId === 'string' ? claims.orgId : ''
  if (!tenantId || !orgId) throw new Error('Auth token is missing tenantId/orgId claims')
  return { tenantId, orgId }
}

export function syncExcelHeaders(token: string, selectedOrgId?: string): Record<string, string> {
  const scope = decodeTokenScope(token)
  return {
    Authorization: `Bearer ${token}`,
    Cookie: `om_selected_tenant=${scope.tenantId}; om_selected_org=${selectedOrgId ?? scope.orgId}`,
  }
}

export function csvFilePart(input?: { name?: string; mimeType?: string; content?: string | Buffer }): MultipartFilePart {
  const content = input?.content ?? SAMPLE_CSV
  return {
    name: input?.name ?? 'leads.csv',
    mimeType: input?.mimeType ?? 'text/csv',
    buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
  }
}

export function buildValidMapping(): JsonRecord {
  return {
    entityType: ENTITY_TYPE,
    matchStrategy: 'externalId',
    matchField: 'person.externalId',
    fields: [],
    unmappedColumns: [],
  }
}

export async function uploadMultipart(
  request: APIRequestContext,
  token: string,
  multipart: MultipartPayload,
  selectedOrgId?: string,
): Promise<APIResponse> {
  return request.fetch(`${BASE_URL}/api/sync_excel/upload`, {
    method: 'POST',
    headers: syncExcelHeaders(token, selectedOrgId),
    multipart,
  })
}

export async function uploadSampleCsv(
  request: APIRequestContext,
  token: string,
  fileNamePrefix = 'sx',
): Promise<JsonRecord> {
  const response = await uploadMultipart(request, token, {
    entityType: ENTITY_TYPE,
    file: csvFilePart({ name: `${fileNamePrefix}-${uniqueSuffix()}.csv`, content: SAMPLE_CSV }),
  })
  expect(response.status()).toBe(200)
  return readJson(response)
}

export async function previewUpload(
  request: APIRequestContext,
  token: string,
  query: { uploadId?: string; entityType?: string },
  selectedOrgId?: string,
): Promise<APIResponse> {
  const params = new URLSearchParams()
  if (query.uploadId !== undefined) params.set('uploadId', query.uploadId)
  if (query.entityType !== undefined) params.set('entityType', query.entityType)
  const suffix = params.toString()
  return request.get(`${BASE_URL}/api/sync_excel/preview${suffix ? `?${suffix}` : ''}`, {
    headers: syncExcelHeaders(token, selectedOrgId),
  })
}

export async function startImport(
  request: APIRequestContext,
  token: string,
  data: JsonRecord,
  selectedOrgId?: string,
): Promise<APIResponse> {
  return request.fetch(`${BASE_URL}/api/sync_excel/import`, {
    method: 'POST',
    headers: {
      ...syncExcelHeaders(token, selectedOrgId),
      'Content-Type': 'application/json',
    },
    data,
  })
}
