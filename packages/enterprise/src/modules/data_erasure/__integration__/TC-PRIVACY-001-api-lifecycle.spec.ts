import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

type Policy = {
  id: string
  dataClassId: string
  retentionDays: number
  action: 'delete' | 'anonymize'
  batchSize: number
  isActive: boolean
  updatedAt: string
}

type LegalHold = {
  id: string
  updatedAt: string
}

test.describe('TC-PRIVACY-001: privacy API lifecycle', () => {
  test('renders the privacy administration page', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/security/privacy')
    await expect(page.getByRole('heading', { name: 'Privacy and retention' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Retention policies' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Legal holds' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Data-subject requests' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Operation history' })).toBeVisible()
  })

  test('registers data classes, runs retention, and blocks erasure under a legal hold', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let policy: Policy | null = null
    let originalPolicy: Policy | null = null
    let legalHold: LegalHold | null = null

    try {
      const classesResponse = await apiRequest(request, 'GET', '/api/data_erasure/data-classes', { token })
      expect(classesResponse.ok()).toBeTruthy()
      const classes = await classesResponse.json() as { items: Array<{ id: string }> }
      expect(classes.items.map((item) => item.id)).toEqual(expect.arrayContaining([
        'audit_logs.access_logs',
        'auth.users',
        'customers.people',
      ]))

      const listResponse = await apiRequest(request, 'GET', '/api/data_erasure/policies', { token })
      expect(listResponse.ok()).toBeTruthy()
      const listed = await listResponse.json() as { items: Policy[] }
      originalPolicy = listed.items.find((item) => item.dataClassId === 'audit_logs.access_logs') ?? null

      if (originalPolicy) {
        policy = await updatePolicy(request, token, originalPolicy.id, originalPolicy.updatedAt, {
          retentionDays: 90,
          action: 'delete',
          batchSize: 25,
          isActive: true,
        })
      } else {
        const createResponse = await apiRequest(request, 'POST', '/api/data_erasure/policies', {
          token,
          data: {
            dataClassId: 'audit_logs.access_logs',
            retentionDays: 90,
            action: 'delete',
            batchSize: 25,
            isActive: true,
          },
        })
        expect(createResponse.status()).toBe(201)
        policy = await createResponse.json() as Policy
      }

      const retentionResponse = await apiRequest(request, 'POST', '/api/data_erasure/retention/run', {
        token,
        data: { policyId: policy.id, dryRun: true, maxBatches: 1 },
      })
      expect(retentionResponse.ok()).toBeTruthy()
      const retention = await retentionResponse.json() as { status: string; dryRun: boolean; report: Record<string, unknown> }
      expect(retention.status).toBe('completed')
      expect(retention.dryRun).toBe(true)
      expect(retention.report).toEqual(expect.objectContaining({ batches: 1 }))

      const subjectId = randomUUID()
      const holdResponse = await apiRequest(request, 'POST', '/api/data_erasure/legal-holds', {
        token,
        data: {
          dataClassId: 'auth.users',
          subject: { kind: 'auth:user', id: subjectId },
          reason: 'Integration test legal hold',
        },
      })
      expect(holdResponse.status()).toBe(201)
      legalHold = await holdResponse.json() as LegalHold

      const erasureResponse = await apiRequest(request, 'POST', '/api/data_erasure/subjects', {
        token,
        data: {
          action: 'erase',
          subject: { kind: 'auth:user', id: subjectId },
          dataClassIds: ['auth.users'],
          dryRun: false,
        },
      })
      expect(erasureResponse.ok()).toBeTruthy()
      const erasure = await erasureResponse.json() as {
        operation: { id: string; status: string; report: { classes: Array<{ errorCode: string }> } }
      }
      expect(erasure.operation.status).toBe('blocked')
      expect(erasure.operation.report.classes[0]?.errorCode).toBe('LEGAL_HOLD_ACTIVE')

      const operationsResponse = await apiRequest(request, 'GET', '/api/data_erasure/operations?pageSize=100', { token })
      expect(operationsResponse.ok()).toBeTruthy()
      const operations = await operationsResponse.json() as { items: Array<{ id: string }> }
      expect(operations.items.some((item) => item.id === erasure.operation.id)).toBe(true)
    } finally {
      if (legalHold) {
        await postWithVersion(request, token, `/api/data_erasure/legal-holds/${legalHold.id}/release`, legalHold.updatedAt)
          .catch(() => undefined)
      }
      if (policy) {
        const restore = originalPolicy
          ? {
              retentionDays: originalPolicy.retentionDays,
              action: originalPolicy.action,
              batchSize: originalPolicy.batchSize,
              isActive: originalPolicy.isActive,
            }
          : { isActive: false }
        const latestResponse = await apiRequest(request, 'GET', `/api/data_erasure/policies/${policy.id}`, { token })
        if (latestResponse.ok()) {
          const latest = await latestResponse.json() as Policy
          await updatePolicy(request, token, latest.id, latest.updatedAt, restore).catch(() => undefined)
        }
      }
    }
  })

  test('previews the strict sandbox sanitization profile in a classified non-production environment', async ({ request }) => {
    const classification = process.env.OM_ENVIRONMENT_CLASSIFICATION?.trim().toLowerCase()
    test.skip(
      !classification || classification === 'production',
      'Environment sanitization requires an explicit non-production OM_ENVIRONMENT_CLASSIFICATION.',
    )
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', '/api/data_erasure/environment-sanitization', {
      token,
      data: { profile: 'sandbox-strict', dryRun: true },
    })
    expect(response.ok(), `Sanitization preview failed with status ${response.status()}`).toBeTruthy()
    const body = await response.json() as {
      operation: {
        type: string
        status: string
        dryRun: boolean
        report: {
          environmentClassification: string
          classes: Array<{ dataClassId: string; findings: Array<{ code: string; count: number }> }>
        }
      }
    }
    expect(body.operation).toEqual(expect.objectContaining({
      type: 'sanitization',
      status: 'completed',
      dryRun: true,
    }))
    expect(body.operation.report.environmentClassification).toBe(classification)
    expect(body.operation.report.classes.length).toBeGreaterThan(0)
    expect(JSON.stringify(body.operation.report)).not.toContain('passwordHash')
  })

  test('resolves, discovers, exports, anonymizes, and erases a real application user', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(token)
    const stamp = Date.now()
    const email = `tc-privacy-user-${stamp}@example.com`
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, token, { name: `TC Privacy ${stamp}`, tenantId })
      userId = await createUserFixture(request, token, {
        email,
        password: 'Privacy-Test-1!',
        organizationId,
        roles: [roleId],
        name: 'Privacy Test User',
      })

      const resolutionResponse = await apiRequest(request, 'POST', '/api/data_erasure/subjects/resolve', {
        token,
        data: {
          identifier: { kind: 'email', value: email },
          dataClassIds: ['auth.users'],
        },
      })
      expect(resolutionResponse.ok()).toBeTruthy()
      const resolution = await resolutionResponse.json() as {
        operation: { status: string; report: Record<string, unknown> }
        subjects: Record<string, Array<{ kind: string; id: string }>>
      }
      expect(resolution.operation.status).toBe('completed')
      expect(resolution.subjects['auth.users']).toEqual([{ kind: 'auth:user', id: userId }])
      expect(JSON.stringify(resolution.operation.report)).not.toContain(email)

      const discovery = await runSubjectAction(request, token, 'discover', userId, true)
      expect(discovery.operation.status).toBe('completed')
      expect(discovery.operation.report.totals.recordCount).toBe(1)

      const exported = await runSubjectAction(request, token, 'export', userId, true)
      expect(exported.exports?.['auth.users']?.data).toEqual(expect.objectContaining({ email }))

      const anonymized = await runSubjectAction(request, token, 'anonymize', userId, false)
      expect(anonymized.operation.status).toBe('completed')
      expect(anonymized.operation.report.totals.affected).toBe(1)

      const anonymizedExport = await runSubjectAction(request, token, 'export', userId, true)
      expect(anonymizedExport.exports?.['auth.users']?.data).toEqual(expect.objectContaining({
        email: `anonymized+${userId}@example.invalid`,
        name: null,
      }))

      const erased = await runSubjectAction(request, token, 'erase', userId, false)
      expect(erased.operation.status).toBe('completed')
      expect(erased.operation.report.totals.affected).toBe(1)

      const absent = await runSubjectAction(request, token, 'discover', userId, true)
      expect(absent.operation.status).toBe('completed')
      expect(absent.operation.report.totals.recordCount).toBe(0)
      userId = null
    } finally {
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })

  test('resolves a customer person by phone without persisting the phone in the operation report', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const phone = `+48 500 ${String(stamp).slice(-3)} ${String(stamp + 17).slice(-3)}`
    let personId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/customers/people', {
        token,
        data: {
          firstName: 'Privacy',
          lastName: `Phone ${stamp}`,
          displayName: `Privacy Phone ${stamp}`,
          primaryPhone: phone,
          status: 'active',
        },
      })
      expect(createResponse.ok(), `Create person failed with status ${createResponse.status()}`).toBeTruthy()
      const created = await readJsonSafe<{ id?: unknown }>(createResponse)
      personId = typeof created?.id === 'string' ? created.id : null
      expect(personId).toBeTruthy()

      const resolutionResponse = await apiRequest(request, 'POST', '/api/data_erasure/subjects/resolve', {
        token,
        data: {
          identifier: { kind: 'phone', value: phone },
          dataClassIds: ['customers.people'],
        },
      })
      expect(resolutionResponse.ok()).toBeTruthy()
      const resolution = await resolutionResponse.json() as {
        operation: { status: string; report: Record<string, unknown> }
        subjects: Record<string, Array<{ kind: string; id: string }>>
      }
      expect(resolution.operation.status).toBe('completed')
      expect(resolution.subjects['customers.people']).toEqual([{ kind: 'customers:person', id: personId }])
      expect(JSON.stringify(resolution.operation.report)).not.toContain(phone)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('exports actor access logs but does not allow per-subject audit-log erasure', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { userId } = getTokenScope(token)
    const exportResponse = await apiRequest(request, 'POST', '/api/data_erasure/subjects', {
      token,
      data: {
        action: 'export',
        subject: { kind: 'auth:user', id: userId },
        dataClassIds: ['audit_logs.access_logs'],
        dryRun: true,
      },
    })
    expect(exportResponse.ok()).toBeTruthy()
    const exported = await exportResponse.json() as {
      operation: { status: string }
      exports: Record<string, { recordCount: number; data: unknown }>
    }
    expect(exported.operation.status).toBe('completed')
    expect(exported.exports['audit_logs.access_logs']).toEqual(expect.objectContaining({
      recordCount: expect.any(Number),
      data: expect.any(Array),
    }))

    const eraseResponse = await apiRequest(request, 'POST', '/api/data_erasure/subjects', {
      token,
      data: {
        action: 'erase',
        subject: { kind: 'auth:user', id: userId },
        dataClassIds: ['audit_logs.access_logs'],
        dryRun: false,
      },
    })
    expect(eraseResponse.status()).toBe(400)
  })
})

type SubjectActionResponse = {
  operation: {
    status: string
    report: {
      totals: { recordCount: number; affected: number }
    }
  }
  exports?: Record<string, { data: Record<string, unknown> | null }>
}

async function runSubjectAction(
  request: APIRequestContext,
  token: string,
  action: 'discover' | 'export' | 'erase' | 'anonymize',
  subjectId: string,
  dryRun: boolean,
): Promise<SubjectActionResponse> {
  const response = await apiRequest(request, 'POST', '/api/data_erasure/subjects', {
    token,
    data: {
      action,
      subject: { kind: 'auth:user', id: subjectId },
      dataClassIds: ['auth.users'],
      dryRun,
    },
  })
  expect(response.ok(), `${action} subject request failed with status ${response.status()}`).toBeTruthy()
  return response.json() as Promise<SubjectActionResponse>
}

async function updatePolicy(
  request: APIRequestContext,
  token: string,
  id: string,
  updatedAt: string,
  data: Record<string, unknown>,
): Promise<Policy> {
  const response = await request.put(resolveUrl(`/api/data_erasure/policies/${id}`), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt,
    },
    data,
  })
  expect(response.ok(), `Policy update should succeed with status ${response.status()}`).toBeTruthy()
  return response.json() as Promise<Policy>
}

async function postWithVersion(
  request: APIRequestContext,
  token: string,
  path: string,
  updatedAt: string,
) {
  return request.post(resolveUrl(path), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt,
    },
  })
}

function resolveUrl(path: string): string {
  const baseUrl = process.env.BASE_URL?.trim()
  return baseUrl ? `${baseUrl}${path}` : path
}
