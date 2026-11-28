import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'audit_logs', 'customers'],
}

const CONFLICT_CODE = 'eudr.errors.undoConflict'
const CONFLICT_MESSAGE = 'This record changed after the action you are undoing. Undo was refused.'
const PASSWORD = 'StrongSecret123!'
const STATEMENTS_PATH = '/api/eudr/statements'
const PLOTS_PATH = '/api/eudr/plots'
const RISK_ASSESSMENTS_PATH = '/api/eudr/risk-assessments'
const COMPANIES_PATH = '/api/customers/companies'
const POLYGON = {
  type: 'Polygon',
  coordinates: [[[-5.6, 6.8], [-5.6, 6.81], [-5.59, 6.81], [-5.59, 6.8], [-5.6, 6.8]]],
}

type Cleanup = {
  superadminToken: string | null
  adminToken: string | null
  roleId: string | null
  userId: string | null
  companyId: string | null
  records: Array<{ path: string; id: string }>
}

type Fixtures = {
  request: APIRequestContext
  adminToken: string
  creatorToken: string
  creatorEmail: string
  supplierId: string
  stamp: string
  cleanup: Cleanup
}

type EntityCase = {
  label: string
  path: string
  field: string
  createPayload: (fixtures: Fixtures) => Promise<Record<string, unknown>>
}

type UndoRefusalBody = { error?: string; code?: string }

async function createRecord(
  fixtures: Fixtures,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<{ id: string }> {
  const response = await apiRequest(fixtures.request, 'POST', path, { token, data })
  const body = await readJsonSafe<{ id?: string; error?: string }>(response)
  expect(response.status(), `create ${path} failed: ${JSON.stringify(body)}`).toBe(201)
  const id = expectId(body?.id, `${path} create response id`)
  fixtures.cleanup.records.push({ path, id })
  return { id }
}

async function updateRecord(
  fixtures: Fixtures,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  const response = await apiRequest(fixtures.request, 'PUT', path, { token, data })
  expect(response.status(), `update ${path} failed: ${JSON.stringify(await readJsonSafe(response))}`).toBe(200)
  return response
}

async function readField(fixtures: Fixtures, path: string, id: string, field: string): Promise<unknown> {
  const response = await apiRequest(fixtures.request, 'GET', `${path}?ids=${encodeURIComponent(id)}`, {
    token: fixtures.adminToken,
  })
  expect(response.status(), `read ${path} failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const row = body?.items?.find((item) => item.id === id)
  expect(row, `${path} row ${id} should be listed`).toBeTruthy()
  return row?.[field]
}

async function expectConflict(fixtures: Fixtures, undoToken: string, context: string): Promise<void> {
  const response = await undoByToken(fixtures.request, fixtures.creatorToken, undoToken)
  const body = await readJsonSafe<UndoRefusalBody>(response)
  expect(response.status(), `${context}: undo must be refused with 409, got ${JSON.stringify(body)}`).toBe(409)
  expect(body?.code, `${context}: refusal code`).toBe(CONFLICT_CODE)
  expect(body?.error, `${context}: refusal message should be localized`).toBe(CONFLICT_MESSAGE)
}

const entityCases: EntityCase[] = [
  {
    label: 'plot',
    path: PLOTS_PATH,
    field: 'name',
    createPayload: async ({ supplierId, stamp }) => ({
      name: `TC-EUDR-020 Plot ${stamp}`,
      supplierEntityId: supplierId,
      originCountry: 'CI',
      geometry: POLYGON,
    }),
  },
  {
    label: 'evidence submission',
    path: '/api/eudr/evidence-submissions',
    field: 'batchNumber',
    createPayload: async ({ supplierId }) => ({ supplierEntityId: supplierId, commodity: 'cocoa' }),
  },
  {
    label: 'product mapping',
    path: '/api/eudr/product-mappings',
    field: 'notes',
    createPayload: async () => ({ productId: randomUUID(), commodity: 'cocoa', hsCode: '1801' }),
  },
  {
    label: 'due diligence statement',
    path: STATEMENTS_PATH,
    field: 'notes',
    createPayload: async ({ stamp }) => ({
      title: `TC-EUDR-020 Statement ${stamp}`,
      commodity: 'cocoa',
      actorRole: 'operator',
    }),
  },
  {
    label: 'risk assessment',
    path: RISK_ASSESSMENTS_PATH,
    field: 'notes',
    createPayload: async (fixtures) => {
      const statement = await createRecord(fixtures, fixtures.adminToken, STATEMENTS_PATH, {
        title: `TC-EUDR-020 Risk statement ${fixtures.stamp}`,
        commodity: 'cocoa',
        actorRole: 'operator',
      })
      return { statementId: statement.id, criteria: {}, conclusion: 'negligible' }
    },
  },
  {
    label: 'mitigation action',
    path: '/api/eudr/mitigation-actions',
    field: 'title',
    createPayload: async (fixtures) => {
      const statement = await createRecord(fixtures, fixtures.adminToken, STATEMENTS_PATH, {
        title: `TC-EUDR-020 Mitigation statement ${fixtures.stamp}`,
        commodity: 'cocoa',
        actorRole: 'operator',
      })
      const assessment = await createRecord(fixtures, fixtures.adminToken, RISK_ASSESSMENTS_PATH, {
        statementId: statement.id,
        criteria: {},
        conclusion: 'non_negligible',
      })
      return { riskAssessmentId: assessment.id, title: `TC-EUDR-020 Action ${fixtures.stamp}` }
    },
  },
]

function newCleanup(): Cleanup {
  return { superadminToken: null, adminToken: null, roleId: null, userId: null, companyId: null, records: [] }
}

async function setUp(request: APIRequestContext, cleanup: Cleanup): Promise<Fixtures> {
  const superadminToken = await getAuthToken(request, 'superadmin')
  cleanup.superadminToken = superadminToken
  const adminToken = await getAuthToken(request, 'admin')
  cleanup.adminToken = adminToken
  const { organizationId, tenantId } = getTokenContext(adminToken)
  const stamp = randomUUID().slice(0, 8)
  const fixtures: Fixtures = {
    request,
    adminToken,
    creatorToken: '',
    creatorEmail: `qa-eudr-020-${stamp}@example.com`,
    supplierId: '',
    stamp,
    cleanup,
  }
  cleanup.roleId = await createRoleFixture(request, superadminToken, { name: `qa-eudr-020-${stamp}`, tenantId })
  await setRoleAclFeatures(request, superadminToken, {
    roleId: cleanup.roleId,
    features: [
      'eudr.plots.view',
      'eudr.plots.manage',
      'eudr.submissions.view',
      'eudr.submissions.manage',
      'eudr.mappings.view',
      'eudr.mappings.manage',
      'eudr.statements.view',
      'eudr.statements.manage',
      'eudr.risk.view',
      'eudr.risk.manage',
      'audit_logs.view_self',
      'audit_logs.undo_self',
    ],
    organizations: [organizationId],
  })
  cleanup.userId = await createUserFixture(request, superadminToken, {
    email: fixtures.creatorEmail,
    password: PASSWORD,
    organizationId,
    roles: [cleanup.roleId],
    name: 'QA TC-EUDR-020 Editor',
  })
  fixtures.creatorToken = await getAuthToken(request, fixtures.creatorEmail, PASSWORD)
  cleanup.companyId = await createCompanyFixture(request, adminToken, `TC-EUDR-020 Supplier ${stamp}`)
  fixtures.supplierId = cleanup.companyId
  return fixtures
}

async function tearDown(request: APIRequestContext, cleanup: Cleanup): Promise<void> {
  for (const record of [...cleanup.records].reverse()) {
    await deleteEntityIfExists(request, cleanup.adminToken, record.path, record.id).catch(() => undefined)
  }
  await deleteEntityIfExists(request, cleanup.adminToken, COMPANIES_PATH, cleanup.companyId).catch(() => undefined)
  await deleteUserIfExists(request, cleanup.superadminToken, cleanup.userId)
  await deleteRoleIfExists(request, cleanup.superadminToken, cleanup.roleId)
}

test.describe('TC-EUDR-020: EUDR undo never overwrites a later edit by another user', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('update undos are refused after another user edits the record, own undos still chain', async ({ request }) => {
    const cleanup = newCleanup()
    try {
      const active = await setUp(request, cleanup)

      for (const entity of entityCases) {
        const created = await createRecord(active, active.creatorToken, entity.path, await entity.createPayload(active))
        const ownEdit = await updateRecord(active, active.creatorToken, entity.path, {
          id: created.id,
          [entity.field]: `${entity.label} edited by creator ${active.stamp}`,
        })
        const ownEditOperation = expectOperation(ownEdit, `${entity.label} creator edit`)
        const laterValue = `${entity.label} edited later by admin ${active.stamp}`
        await updateRecord(active, active.adminToken, entity.path, { id: created.id, [entity.field]: laterValue })

        await expectConflict(active, ownEditOperation.undoToken, `${entity.label} update undo after a later edit`)
        expect(await readField(active, entity.path, created.id, entity.field), `${entity.label}: the later edit survives`).toBe(laterValue)

        const firstOwn = expectOperation(
          await updateRecord(active, active.creatorToken, entity.path, { id: created.id, [entity.field]: `${entity.label} first ${active.stamp}` }),
          `${entity.label} first own edit`,
        )
        const secondOwn = expectOperation(
          await updateRecord(active, active.creatorToken, entity.path, { id: created.id, [entity.field]: `${entity.label} second ${active.stamp}` }),
          `${entity.label} second own edit`,
        )
        await undoOk(request, active.creatorToken, secondOwn.undoToken, `${entity.label} newest own undo`)
        await undoOk(request, active.creatorToken, firstOwn.undoToken, `${entity.label} older own undo`)
        expect(await readField(active, entity.path, created.id, entity.field), `${entity.label}: chained undo restores the admin edit`).toBe(laterValue)
      }
    } finally {
      await tearDown(request, cleanup)
    }
  })

  test('the audit log shows the translated refusal when undoing an edit another user changed since', async ({ page, request }) => {
    const cleanup = newCleanup()
    try {
      const active = await setUp(request, cleanup)
      const plot = await createRecord(active, active.creatorToken, PLOTS_PATH, {
        name: `TC-EUDR-020 UI plot ${active.stamp}`,
        supplierEntityId: active.supplierId,
        originCountry: 'CI',
        geometry: POLYGON,
      })
      await updateRecord(active, active.creatorToken, PLOTS_PATH, { id: plot.id, name: `TC-EUDR-020 UI plot edited ${active.stamp}` })
      const laterName = `TC-EUDR-020 UI plot renamed by admin ${active.stamp}`
      await updateRecord(active, active.adminToken, PLOTS_PATH, { id: plot.id, name: laterName })

      const loginForm = new URLSearchParams()
      loginForm.set('email', active.creatorEmail)
      loginForm.set('password', PASSWORD)
      const loginResponse = await page.request.post('/api/auth/login', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: loginForm.toString(),
      })
      expect(loginResponse.ok(), 'creator should log in').toBe(true)

      await page.goto('/backend/audit-logs')
      const updateRow = page.getByRole('row').filter({ hasText: 'Update EUDR plot' }).first()
      await expect(updateRow).toBeVisible({ timeout: 20_000 })
      const undoResponse = page.waitForResponse((response) => (
        response.url().includes('/api/audit_logs/audit-logs/actions/undo') && response.request().method() === 'POST'
      ))
      await updateRow.getByRole('button', { name: 'Undo this action' }).click()
      expect((await undoResponse).status(), 'UI undo must be refused').toBe(409)
      await expect(page.getByText(CONFLICT_MESSAGE).first()).toBeVisible({ timeout: 10_000 })

      expect(await readField(active, PLOTS_PATH, plot.id, 'name'), 'the admin rename survives the refused UI undo').toBe(laterName)
    } finally {
      await tearDown(request, cleanup)
    }
  })
})
