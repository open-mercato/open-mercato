import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
const APP_ROOT = TEST_APP_ROOT ? path.resolve(TEST_APP_ROOT) : path.resolve(process.cwd(), 'apps/mercato')

if (!TEST_APP_ROOT) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
}

let dbClient: any | null = null
let dbClientPromise: Promise<any> | null = null

export type ChampionScope = {
  tenantId: string
  organizationId: string
}

export type ChampionLeadItem = {
  id: string
  source: string | null
  sourceExternalId?: string | null
  emailNormalized: string | null
  phoneE164: string | null
  nameRaw: string | null
  techStatus: string
  qualificationStatus: string
  disqualificationReason: string | null
  contactId: string | null
  dealId?: string | null
  nextFollowupAt?: string | null
  createdAt?: string | null
}

export type ChampionListResponse<T> = {
  items?: T[]
  data?: T[]
  total?: number
}

export function createRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`
}

export function scopeFromToken(token: string): ChampionScope {
  return getTokenContext(token)
}

export async function closeChampionCrmDb(): Promise<void> {
  const client = dbClient
  dbClient = null
  dbClientPromise = null
  if (client) await client.end()
}

export async function getChampionCrmDb(): Promise<any> {
  if (dbClient) return dbClient
  if (dbClientPromise) return dbClientPromise
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for Champion CRM DB fixtures')
  dbClientPromise = (async () => {
    const client = new Client({ connectionString })
    await client.connect()
    dbClient = client
    return client
  })()
  return dbClientPromise
}

export async function intakeLead(
  request: APIRequestContext,
  token: string,
  runId: string,
  input: Record<string, unknown>,
): Promise<{ response: APIResponse; body: Record<string, unknown> | null }> {
  const response = await apiRequest(request, 'POST', '/api/champion-crm/intake', {
    token,
    data: {
      sourceExternalId: `${runId}-${randomUUID()}`,
      payload: { runId },
      ...input,
    },
  })
  return { response, body: await readJsonSafe<Record<string, unknown>>(response) }
}

export async function listLeads(
  request: APIRequestContext,
  token: string,
  query = '',
): Promise<ChampionLeadItem[]> {
  const separator = query ? `?${query}` : ''
  const response = await apiRequest(request, 'GET', `/api/champion-crm/leads${separator}`, { token })
  const body = await readJsonSafe<ChampionListResponse<ChampionLeadItem>>(response)
  return body?.items ?? body?.data ?? []
}

export async function getLeadById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<ChampionLeadItem | null> {
  const items = await listLeads(request, token, `id=${encodeURIComponent(id)}&pageSize=1`)
  return items[0] ?? null
}

export async function updateLead(
  request: APIRequestContext,
  token: string,
  id: string,
  input: Record<string, unknown>,
): Promise<APIResponse> {
  return apiRequest(request, 'PUT', '/api/champion-crm/leads', {
    token,
    data: { id, ...input },
  })
}

export async function cleanupChampionCrmRun(runId: string): Promise<void> {
  const client = await getChampionCrmDb()
  const leadIds = await client.query(
    "select id from champion_crm_leads where source_payload->>'runId' = $1 or source_external_id like $2",
    [runId, `${runId}%`],
  ) as { rows: Array<{ id: string }> }
  const ids = leadIds.rows.map((row: { id: string }) => row.id)
  await client.query('delete from champion_crm_consent_events where evidence->>$1 = $2 or lead_id = any($3::uuid[])', ['runId', runId, ids])
  await client.query('delete from champion_crm_audit_events where metadata->>$1 = $2 or entity_id = any($3::uuid[])', ['runId', runId, ids])
  await client.query('delete from champion_crm_activities where metadata->>$1 = $2 or lead_id = any($3::uuid[])', ['runId', runId, ids])
  await client.query('delete from champion_crm_apartments where metadata->>$1 = $2', ['runId', runId])
  await client.query('delete from champion_crm_deals where metadata->>$1 = $2 or lead_id = any($3::uuid[])', ['runId', runId, ids])
  await client.query('delete from champion_crm_investments where metadata->>$1 = $2', ['runId', runId])
  await client.query('delete from champion_crm_contacts where consent_summary->>$1 = $2', ['runId', runId])
  await client.query('delete from champion_crm_contacts where first_lead_id = any($1::uuid[]) or last_lead_id = any($1::uuid[])', [ids])
  await client.query('delete from champion_crm_leads where id = any($1::uuid[])', [ids])
}

export async function createContactFixture(scope: ChampionScope, runId: string, input: {
  displayName: string
  email?: string | null
  phone?: string | null
}): Promise<string> {
  const client = await getChampionCrmDb()
  const id = randomUUID()
  await client.query(
    `insert into champion_crm_contacts (
      id, tenant_id, organization_id, display_name, primary_email, primary_phone_e164,
      emails, phones, lifecycle, consent_summary, score, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'lead',$9::jsonb,0,now(),now())`,
    [
      id,
      scope.tenantId,
      scope.organizationId,
      input.displayName,
      input.email ?? null,
      input.phone ?? null,
      JSON.stringify(input.email ? [input.email] : []),
      JSON.stringify(input.phone ? [input.phone] : []),
      JSON.stringify({ runId }),
    ],
  )
  return id
}

export async function createDealFixture(scope: ChampionScope, runId: string, input: {
  contactId: string
  leadId?: string | null
  investmentId?: string | null
  apartmentId?: string | null
  title: string
  status?: string
}): Promise<string> {
  const client = await getChampionCrmDb()
  const id = randomUUID()
  await client.query(
    `insert into champion_crm_deals (
      id, tenant_id, organization_id, contact_id, lead_id, investment_id, apartment_id,
      title, status, probability, metadata, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10::jsonb,now(),now())`,
    [id, scope.tenantId, scope.organizationId, input.contactId, input.leadId ?? null, input.investmentId ?? null, input.apartmentId ?? null, input.title, input.status ?? 'open', JSON.stringify({ runId })],
  )
  return id
}

export async function createInvestmentFixture(scope: ChampionScope, runId: string, input: { name: string }): Promise<string> {
  const client = await getChampionCrmDb()
  const id = randomUUID()
  await client.query(
    `insert into champion_crm_investments (
      id, tenant_id, organization_id, name, status, metadata, created_at, updated_at
    ) values ($1,$2,$3,$4,'selling',$5::jsonb,now(),now())`,
    [id, scope.tenantId, scope.organizationId, input.name, JSON.stringify({ runId })],
  )
  return id
}

export async function createApartmentFixture(scope: ChampionScope, runId: string, input: {
  investmentId: string
  unitNumber: string
  dealId?: string | null
  status?: string
}): Promise<string> {
  const client = await getChampionCrmDb()
  const id = randomUUID()
  await client.query(
    `insert into champion_crm_apartments (
      id, tenant_id, organization_id, investment_id, unit_number, status,
      reserved_by_deal_id, reserved_at, metadata, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,case when $7::uuid is null then null else now() end,$8::jsonb,now(),now())`,
    [id, scope.tenantId, scope.organizationId, input.investmentId, input.unitNumber, input.status ?? 'available', input.dealId ?? null, JSON.stringify({ runId })],
  )
  return id
}

export async function createActivityFixture(scope: ChampionScope, runId: string, input: {
  entityType: string
  entityId: string
  leadId?: string | null
  contactId?: string | null
  dealId?: string | null
  type: string
  title: string
  dueAt?: string | null
}): Promise<string> {
  const client = await getChampionCrmDb()
  const id = randomUUID()
  await client.query(
    `insert into champion_crm_activities (
      id, tenant_id, organization_id, entity_type, entity_id, contact_id, lead_id,
      deal_id, type, title, occurred_at, due_at, metadata, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,$12::jsonb,now(),now())`,
    [id, scope.tenantId, scope.organizationId, input.entityType, input.entityId, input.contactId ?? null, input.leadId ?? null, input.dealId ?? null, input.type, input.title, input.dueAt ?? null, JSON.stringify({ runId })],
  )
  return id
}

export async function createAuditEventFixture(scope: ChampionScope, runId: string, input: {
  entityType: string
  entityId: string
  action: string
  message?: string | null
}): Promise<string> {
  const client = await getChampionCrmDb()
  const id = randomUUID()
  await client.query(
    `insert into champion_crm_audit_events (
      id, tenant_id, organization_id, entity_type, entity_id, action, message, metadata, created_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())`,
    [id, scope.tenantId, scope.organizationId, input.entityType, input.entityId, input.action, input.message ?? null, JSON.stringify({ runId })],
  )
  return id
}

export async function readDbOne<T>(query: string, params: unknown[]): Promise<T | null> {
  const client = await getChampionCrmDb()
  const result = await client.query(query, params) as { rows: T[] }
  return result.rows[0] ?? null
}
