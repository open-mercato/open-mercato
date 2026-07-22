import { expect, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(requestPath: string): string {
  return BASE_URL ? `${BASE_URL}${requestPath}` : requestPath
}

export function uniqueToggleIdentifier(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now()}_${random}`.toLowerCase()
}

export function tenantScopeCookie(tenantId: string, organizationId: string | null = '__all__'): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`,
  ].join('; ')
}

export async function rawApiRequest(
  request: APIRequestContext,
  method: string,
  requestPath: string,
  options: { token?: string | null; data?: unknown; cookie?: string | null } = {},
) {
  const headers: Record<string, string> = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.data !== undefined) headers['Content-Type'] = 'application/json'
  if (options.cookie) headers.Cookie = options.cookie
  return request.fetch(resolveUrl(requestPath), { method, headers, data: options.data })
}

export async function createTenantFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  })
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Tenant creation response should include id')
}

export async function deleteTenantIfExists(
  request: APIRequestContext,
  token: string | null,
  tenantId: string | null,
): Promise<void> {
  if (!token || !tenantId) return
  await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${encodeURIComponent(tenantId)}`, {
    token,
  }).catch(() => undefined)
}

export async function changeOverrideState(
  request: APIRequestContext,
  token: string,
  input: { toggleId: string; isOverride: boolean; overrideValue?: unknown; cookie?: string },
) {
  return rawApiRequest(request, 'PUT', '/api/feature_toggles/overrides', {
    token,
    cookie: input.cookie,
    data: {
      toggleId: input.toggleId,
      isOverride: input.isOverride,
      ...(input.isOverride ? { overrideValue: input.overrideValue } : {}),
    },
  })
}

function resolveAppRoot(): string {
  const fromEnv = process.env.OM_TEST_APP_ROOT?.trim()
  return fromEnv ? path.resolve(fromEnv) : path.resolve(process.cwd(), 'apps/mercato')
}

function readEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key]
  if (key === 'DATABASE_URL') {
    try {
      const content = readFileSync(path.resolve(process.cwd(), '.ai/qa/ephemeral-env.json'), 'utf-8')
      const parsed = JSON.parse(content) as { databaseUrl?: string; status?: string }
      if (parsed.status === 'running' && parsed.databaseUrl) return parsed.databaseUrl
    } catch {
      // Fall through to app env files.
    }
  }
  const candidatePaths = [
    path.resolve(resolveAppRoot(), '.env'),
    path.resolve(process.cwd(), 'apps/mercato/.env'),
    path.resolve(process.cwd(), '.env'),
  ]
  for (const envPath of candidatePaths) {
    try {
      const content = readFileSync(envPath, 'utf-8')
      const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
      if (match?.[1]) return match[1].trim()
    } catch {
      continue
    }
  }
  return undefined
}

async function withDbClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const databaseUrl = readEnvValue('DATABASE_URL')
  if (!databaseUrl) throw new Error('[feature_toggles] DATABASE_URL is not configured for DB assertions')
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

export async function countOverridesForToggleInDb(toggleId: string): Promise<number> {
  return withDbClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from feature_toggle_overrides where toggle_id = $1',
      [toggleId],
    )
    return Number(result.rows[0]?.count ?? '0')
  })
}
