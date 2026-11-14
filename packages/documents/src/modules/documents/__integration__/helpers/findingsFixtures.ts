import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export type FindingBody = {
  id: string
  documentId: string
  reviewId: string
  source: string
  severity: 'blocking' | 'warning' | 'info'
  title: string
  quote: string
  suggestedText: string | null
  anchor: { version: number; relativeFrom: string; relativeTo: string } | null
  anchorStatus: 'located' | 'unlocated'
  status: 'open' | 'applied' | 'kept' | 'superseded'
  appliedText: string | null
  decisionNote: string | null
  decidedByUserId: string | null
  decidedAt: string | null
  updatedAt: string
}

export type FindingListBody = {
  items: FindingBody[]
  total: number
  reviewId: string | null
}

export type FindingSummaryBody = {
  reviewId: string | null
  reviewedAt: string | null
  open: { blocking: number; warning: number; info: number }
  decided: { applied: number; kept: number }
  unlocated: number
}

export type IngestResultBody = {
  reviewId: string
  created: number
  superseded: number
  unlocated: number
}

export type FindingInput = {
  severity: 'blocking' | 'warning' | 'info'
  title: string
  explanation: string
  quote: string
  ruleCode?: string
  sectionLabel?: string
  occurrence?: number
  suggestedText?: string
}

export type FindingsTestUser = {
  id: string
  roleId: string
  token: string
}

export const AGREEMENT_HTML = [
  '<h1>Mutual Non-Disclosure Agreement</h1>',
  '<h2>1. Definitions</h2>',
  '<p>"Confidential Information" means any non-public information disclosed by either party.</p>',
  '<h2>2. Obligations</h2>',
  '<p>The Recipient shall keep the Confidential Information secret for five years.</p>',
  '<h2>3. Governing Law</h2>',
  '<p>This Agreement is governed by the laws of the disclosing party.</p>',
].join('')

export const AGREEMENT_TEXT = [
  'Mutual Non-Disclosure Agreement',
  '1. Definitions',
  '"Confidential Information" means any non-public information disclosed by either party.',
  '2. Obligations',
  'The Recipient shall keep the Confidential Information secret for five years.',
  '3. Governing Law',
  'This Agreement is governed by the laws of the disclosing party.',
].join(' ')

const PASSWORD = 'Valid1!Pass'

export function findingsPath(documentId: string, suffix = ''): string {
  return `/api/documents/${encodeURIComponent(documentId)}/findings${suffix}`
}

export async function createAgreementDocument(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const createResponse = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const created = await readJsonSafe<{ id?: string }>(createResponse)
  expect(createResponse.status(), 'POST /api/documents should return 201').toBe(201)
  const documentId = expectId(created?.id, 'document create response should include id')
  const contentResponse = await apiRequest(request, 'PUT', `/api/documents/${encodeURIComponent(documentId)}/content`, {
    token,
    data: { contentHtml: AGREEMENT_HTML, contentText: AGREEMENT_TEXT },
  })
  expect(contentResponse.status(), 'PUT document content should return 200').toBe(200)
  return documentId
}

export async function deleteDocumentIfExists(
  request: APIRequestContext,
  token: string | null,
  documentId: string | null,
): Promise<void> {
  if (!token || !documentId) return
  await apiRequest(request, 'DELETE', `/api/documents/${encodeURIComponent(documentId)}`, { token })
    .catch(() => undefined)
}

export async function ingestFindings(
  request: APIRequestContext,
  token: string,
  documentId: string,
  data: Record<string, unknown>,
): Promise<{ response: APIResponse; body: IngestResultBody | null }> {
  const response = await apiRequest(request, 'POST', findingsPath(documentId), { token, data })
  return { response, body: await readJsonSafe<IngestResultBody>(response) }
}

export async function listFindings(
  request: APIRequestContext,
  token: string,
  documentId: string,
  query = '',
): Promise<FindingListBody> {
  const response = await apiRequest(request, 'GET', findingsPath(documentId, query), { token })
  expect(response.status(), 'GET findings should return 200').toBe(200)
  const body = await readJsonSafe<FindingListBody>(response)
  expect(body).not.toBeNull()
  return body as FindingListBody
}

export async function readSummary(
  request: APIRequestContext,
  token: string,
  documentId: string,
): Promise<FindingSummaryBody> {
  const response = await apiRequest(request, 'GET', findingsPath(documentId, '/summary'), { token })
  expect(response.status(), 'GET findings summary should return 200').toBe(200)
  return (await readJsonSafe<FindingSummaryBody>(response)) as FindingSummaryBody
}

export async function decideFinding(
  request: APIRequestContext,
  token: string,
  documentId: string,
  finding: { id: string; updatedAt: string },
  action: 'apply' | 'keep' | 'reopen',
  data: Record<string, unknown> = {},
): Promise<{ response: APIResponse; body: FindingBody | null }> {
  const response = await apiRequest(
    request,
    'POST',
    findingsPath(documentId, `/${encodeURIComponent(finding.id)}/${action}`),
    { token, data: { expectedUpdatedAt: finding.updatedAt, ...data } },
  )
  return { response, body: await readJsonSafe<FindingBody>(response) }
}

export function findingByTitle(list: FindingListBody, title: string): FindingBody {
  const finding = list.items.find((item) => item.title === title)
  expect(finding, `finding "${title}" should be listed`).toBeTruthy()
  return finding as FindingBody
}

export async function createDocumentsUser(
  request: APIRequestContext,
  adminToken: string,
  input: { label: string; features: string[]; organizationId?: string; organizations?: string[] | null },
): Promise<FindingsTestUser> {
  const scope = getTokenContext(adminToken)
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOC-FIND ${input.label} ${stamp}`,
    tenantId: scope.tenantId,
  })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features: input.features,
    ...(input.organizations !== undefined ? { organizations: input.organizations } : {}),
  })
  const email = `tc-doc-find-${input.label}-${stamp}@example.com`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId: input.organizationId ?? scope.organizationId,
    roles: [roleId],
    name: `TC Doc Find ${input.label}`,
  })
  return { id, roleId, token: await getAuthToken(request, email, PASSWORD) }
}

export async function deleteDocumentsUser(
  request: APIRequestContext,
  adminToken: string | null,
  user: FindingsTestUser | null,
): Promise<void> {
  if (!user) return
  await deleteUserIfExists(request, adminToken, user.id)
  await deleteRoleIfExists(request, adminToken, user.roleId)
}

export async function shareDocument(
  request: APIRequestContext,
  token: string,
  documentId: string,
  userId: string,
  permission: 'viewer' | 'commenter' | 'editor',
): Promise<void> {
  const response = await apiRequest(request, 'POST', `/api/documents/${encodeURIComponent(documentId)}/shares`, {
    token,
    data: { principalType: 'user', principalId: userId, permission },
  })
  expect(response.status(), `share ${permission} should return 201`).toBe(201)
}
