import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

export const PROGRESS_JOBS_PATH = '/api/progress/jobs'
export const PROGRESS_ACTIVE_PATH = '/api/progress/active'
export const progressJobPath = (id: string): string => `${PROGRESS_JOBS_PATH}/${id}`

/** Feature ids declared in the progress module's `acl.ts`. */
export const PROGRESS_FEATURES = {
  view: 'progress.view',
  create: 'progress.create',
  update: 'progress.update',
  cancel: 'progress.cancel',
} as const

/** Shape returned by `GET /api/progress/jobs` list items (`api/jobs/route.ts` → `toRow`). */
export type ProgressJobListItem = {
  id: string
  jobType: string
  name: string
  description: string | null
  status: string
  progressPercent: number
  processedCount: number
  totalCount: number | null
  etaSeconds: number | null
  cancellable: boolean
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  createdAt: string | null
  tenantId: string
  organizationId: string | null
}

export type ProgressListResponse = {
  items: ProgressJobListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type CreateProgressJobOverrides = {
  jobType?: string
  name?: string
  description?: string
  totalCount?: number
  cancellable?: boolean
  meta?: Record<string, unknown>
}

let sequence = 0

/** Unique-enough job type so a run's fixtures never collide with prior runs or other tests. */
export function uniqueJobType(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now()}-${sequence}`
}

/** Unique-enough job name token usable for search assertions. */
export function uniqueJobName(prefix: string): string {
  sequence += 1
  return `${prefix} ${Date.now()}-${sequence}`
}

/** Create a progress job via the API and return its id. Defaults to cancellable so teardown can cancel it. */
export async function createProgressJob(
  request: APIRequestContext,
  token: string,
  overrides: CreateProgressJobOverrides = {},
): Promise<string> {
  const data: Record<string, unknown> = {
    jobType: overrides.jobType ?? uniqueJobType('qa-progress'),
    name: overrides.name ?? uniqueJobName('QA Progress Job'),
    cancellable: overrides.cancellable ?? true,
  }
  if (overrides.description !== undefined) data.description = overrides.description
  if (overrides.totalCount !== undefined) data.totalCount = overrides.totalCount
  if (overrides.meta !== undefined) data.meta = overrides.meta

  const response = await apiRequest(request, 'POST', PROGRESS_JOBS_PATH, { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), 'POST /api/progress/jobs should return 201').toBe(201)
  return expectId(body?.id, 'Job creation response should include id')
}

/** List progress jobs with arbitrary query params; asserts 200 and returns the parsed body. */
export async function listProgressJobs(
  request: APIRequestContext,
  token: string,
  query: Record<string, string | number | undefined> = {},
): Promise<ProgressListResponse> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const queryString = params.toString()
  const path = queryString ? `${PROGRESS_JOBS_PATH}?${queryString}` : PROGRESS_JOBS_PATH

  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET ${path} should return 200`).toBe(200)
  const body = await readJsonSafe<ProgressListResponse>(response)
  expect(body, 'progress list response should be JSON').not.toBeNull()
  return body as ProgressListResponse
}

/** Best-effort cancellation used in teardown. Swallows errors so it never masks the real assertion. */
export async function cancelProgressJob(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', progressJobPath(id), { token }).catch(() => undefined)
}

export type RestrictedProgressUser = {
  token: string
  userId: string
  roleId: string
  email: string
}

// Password policy requires upper + lower + digit + special; the seeded "secret" is too weak for the users API.
const RESTRICTED_USER_PASSWORD = 'QaProgress1!'

/**
 * Provision a fresh user whose single custom role grants exactly `features`, then log in as them.
 * Org/tenant are taken from the admin caller so the user lands in the same scope as the fixtures.
 */
export async function createProgressUserWithFeatures(
  request: APIRequestContext,
  adminToken: string,
  features: string[],
  labelPrefix: string,
): Promise<RestrictedProgressUser> {
  const { organizationId } = getTokenContext(adminToken)
  sequence += 1
  const suffix = `${Date.now()}-${sequence}`
  const slug = labelPrefix.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  const roleId = await createRoleFixture(request, adminToken, { name: `qa-progress ${labelPrefix} ${suffix}` })
  await setRoleAclFeatures(request, adminToken, { roleId, features })

  const email = `qa-progress-${slug}-${suffix}@qa.example.com`
  const userId = await createUserFixture(request, adminToken, {
    email,
    password: RESTRICTED_USER_PASSWORD,
    organizationId,
    roles: [roleId],
    name: `QA Progress ${labelPrefix} ${suffix}`,
  })

  const token = await getAuthToken(request, email, RESTRICTED_USER_PASSWORD)
  return { token, userId, roleId, email }
}

/** Tear down a user created by {@link createProgressUserWithFeatures}; user first, then its role. */
export async function deleteProgressUser(
  request: APIRequestContext,
  adminToken: string | null,
  user: { userId?: string | null; roleId?: string | null } | null,
): Promise<void> {
  if (!adminToken || !user) return
  await deleteUserIfExists(request, adminToken, user.userId ?? null)
  await deleteRoleIfExists(request, adminToken, user.roleId ?? null)
}
