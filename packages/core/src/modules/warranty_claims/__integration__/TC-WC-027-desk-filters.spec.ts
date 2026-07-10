import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  assignClaim,
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  listClaims,
  readClaim,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitAndExpect,
  uniqueLabel,
  type ClaimItem,
  type WarrantyClaimSettingsResult,
} from './helpers'

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.DATABASE_URL) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

let dbClient: Client | null = null

async function getDbClient(): Promise<Client> {
  if (dbClient) return dbClient
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for TC-WC-027 to seed SLA timestamps')
  }
  const client = new Client({ connectionString })
  await client.connect()
  dbClient = client
  return client
}

async function closeDbClient(): Promise<void> {
  const client = dbClient
  dbClient = null
  if (client) await client.end()
}

async function forceClaimSlaWindow(input: {
  claimId: string
  submittedAt: Date
  dueAt: Date
  pausedAt?: Date | null
}): Promise<void> {
  const client = await getDbClient()
  await client.query(
    `
      update warranty_claims
      set submitted_at = $2,
          sla_due_at = $3,
          sla_paused_at = $4,
          updated_at = now()
      where id = $1
    `,
    [input.claimId, input.submittedAt, input.dueAt, input.pausedAt ?? null],
  )
}

async function forceClaimDetailRefs(input: {
  claimId: string
  salesReturnId: string
  replacementOrderId: string
  sourceClaimId: string
}): Promise<void> {
  const client = await getDbClient()
  await client.query(
    `
      update warranty_claims
      set sales_return_id = $2,
          replacement_order_id = $3,
          source_claim_id = $4,
          updated_at = now()
      where id = $1
    `,
    [input.claimId, input.salesReturnId, input.replacementOrderId, input.sourceClaimId],
  )
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function shiftDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS)
}

function findClaim(items: ClaimItem[], claimId: string | null): ClaimItem | undefined {
  return items.find((item) => item.id === claimId)
}

async function createSubmittedClaim(
  request: Parameters<typeof createClaimFixture>[0],
  token: string,
  customerName: string,
): Promise<ClaimItem> {
  const claim = await createClaimFixture(request, token, {
    claimType: 'warranty',
    customerName,
    reasonCode: 'defective',
    currencyCode: 'USD',
  })
  return submitAndExpect(request, token, claim)
}

test.describe('TC-WC-027: warranty claims desk filters', () => {
  test.afterAll(async () => {
    await closeDbClient()
  })

  test('filters unassigned claims, enriches assignee names, and trims detail-only ids from grid rows and exports', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = uniqueLabel('tc-wc-027-a')
    let unassignedClaimId: string | null = null
    let assignedClaimId: string | null = null

    try {
      const unassignedClaim = await createSubmittedClaim(request, adminToken, `QA WC Desk Unassigned ${stamp}`)
      unassignedClaimId = unassignedClaim.id

      let assignedClaim = await createSubmittedClaim(request, adminToken, `QA WC Desk Assigned ${stamp}`)
      assignedClaimId = assignedClaim.id
      const assignResponse = await assignClaim(
        request,
        adminToken,
        { id: assignedClaim.id!, assigneeUserId: scope.userId },
        assignedClaim.updatedAt,
      )
      expect(assignResponse.status(), 'assigning the fixture claim should return 200').toBe(200)
      assignedClaim = await readClaim(request, adminToken, assignedClaim.id!)
      expect(assignedClaim.assigneeUserId, 'fixture claim should be assigned').toBe(scope.userId)

      const forcedRefs = {
        claimId: unassignedClaim.id!,
        salesReturnId: randomUUID(),
        replacementOrderId: randomUUID(),
        sourceClaimId: randomUUID(),
      }
      await forceClaimDetailRefs(forcedRefs)

      const unassignedOnly = await listClaims(request, adminToken, `unassignedOnly=true&search=${encodeURIComponent(stamp)}&pageSize=100`)
      expect(findClaim(unassignedOnly, unassignedClaimId), 'unassignedOnly should include the unassigned claim').toBeTruthy()
      expect(findClaim(unassignedOnly, assignedClaimId), 'unassignedOnly should exclude the assigned claim').toBeFalsy()
      expect(
        unassignedOnly.every((item) => item.assigneeUserId === null),
        'every unassignedOnly row should have a null assigneeUserId',
      ).toBe(true)

      const unassignedWins = await listClaims(
        request,
        adminToken,
        `unassignedOnly=true&assigneeUserId=${encodeURIComponent(scope.userId)}&search=${encodeURIComponent(stamp)}&pageSize=100`,
      )
      expect(
        findClaim(unassignedWins, assignedClaimId),
        'unassignedOnly should take precedence over assigneeUserId',
      ).toBeFalsy()

      const assignedList = await listClaims(
        request,
        adminToken,
        `assigneeUserId=${encodeURIComponent(scope.userId)}&search=${encodeURIComponent(stamp)}&pageSize=100`,
      )
      const assignedRow = findClaim(assignedList, assignedClaimId)
      expect(assignedRow, 'assigneeUserId filter should include the assigned claim').toBeTruthy()
      expect(findClaim(assignedList, unassignedClaimId), 'assigneeUserId filter should exclude the unassigned claim').toBeFalsy()
      expect(typeof assignedRow?.assigneeName, 'assigned rows should carry a resolved assigneeName').toBe('string')
      expect((assignedRow?.assigneeName ?? '').length, 'assigneeName should not be empty').toBeGreaterThan(0)

      const gridRows = await listClaims(request, adminToken, `search=${encodeURIComponent(stamp)}&pageSize=100`)
      const gridRow = findClaim(gridRows, unassignedClaimId)
      expect(gridRow, 'grid listing should include the fixture claim').toBeTruthy()
      expect(gridRow, 'grid rows should keep the detail-only keys').toHaveProperty('salesReturnId')
      expect(gridRow?.salesReturnId, 'grid rows should not carry salesReturnId values').toBeNull()
      expect(gridRow?.replacementOrderId, 'grid rows should not carry replacementOrderId values').toBeNull()
      expect(gridRow?.sourceClaimId, 'grid rows should not carry sourceClaimId values').toBeNull()
      expect(gridRow, 'unassigned rows should expose a null assigneeName').toHaveProperty('assigneeName', null)

      const detail = await readClaim(request, adminToken, unassignedClaim.id!)
      expect(detail.salesReturnId, 'detail fetch should keep salesReturnId').toBe(forcedRefs.salesReturnId)
      expect(detail.replacementOrderId, 'detail fetch should keep replacementOrderId').toBe(forcedRefs.replacementOrderId)
      expect(detail.sourceClaimId, 'detail fetch should keep sourceClaimId').toBe(forcedRefs.sourceClaimId)

      const csvResponse = await apiRequest(
        request,
        'GET',
        `/api/warranty_claims?format=csv&search=${encodeURIComponent(stamp)}&pageSize=100`,
        { token: adminToken },
      )
      expect(csvResponse.status(), 'CSV export should return 200').toBe(200)
      const csvText = await csvResponse.text()
      const csvHeader = csvText.split('\n')[0] ?? ''
      expect(csvHeader, 'CSV export should keep the claim number column').toContain('ClaimNumber')
      expect(csvHeader, 'CSV export should keep the assignee id column').toContain('AssigneeUserId')
      expect(csvHeader, 'CSV export should not include the sales return column').not.toContain('SalesReturnId')
      expect(csvHeader, 'CSV export should not include the replacement order column').not.toContain('ReplacementOrderId')
      expect(csvHeader, 'CSV export should not include the source claim column').not.toContain('SourceClaimId')
      expect(csvText, 'CSV export should include the fixture claim').toContain(unassignedClaim.claimNumber ?? '')
      expect(csvText, 'CSV export should not leak the trimmed salesReturnId value').not.toContain(forcedRefs.salesReturnId)
      expect(csvText, 'CSV export should not leak the trimmed sourceClaimId value').not.toContain(forcedRefs.sourceClaimId)
    } finally {
      await cancelThenDeleteClaimIfPossible(request, adminToken, assignedClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, unassignedClaimId)
    }
  })

  test('filters by submitted and created date ranges with inclusive UTC day boundaries', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-027-b')
    let submittedClaimId: string | null = null
    let draftClaimId: string | null = null

    try {
      const submittedClaim = await createSubmittedClaim(request, adminToken, `QA WC Desk Dates ${stamp}`)
      submittedClaimId = submittedClaim.id

      const draftClaim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Desk Draft ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      draftClaimId = draftClaim.id

      const forcedSubmittedAt = new Date(Date.now() - 3 * DAY_MS)
      await forceClaimSlaWindow({
        claimId: submittedClaim.id!,
        submittedAt: forcedSubmittedAt,
        dueAt: new Date(forcedSubmittedAt.getTime() + 30 * DAY_MS),
      })
      const submittedDay = isoDate(forcedSubmittedAt)

      const inRange = await listClaims(
        request,
        adminToken,
        `submittedFrom=${submittedDay}&submittedTo=${submittedDay}&search=${encodeURIComponent(stamp)}&pageSize=100`,
      )
      expect(findClaim(inRange, submittedClaimId), 'inclusive submitted range should include the claim').toBeTruthy()
      expect(findClaim(inRange, draftClaimId), 'submitted range should exclude never-submitted drafts').toBeFalsy()

      const afterRange = await listClaims(
        request,
        adminToken,
        `submittedFrom=${isoDate(shiftDays(forcedSubmittedAt, 1))}&search=${encodeURIComponent(stamp)}&pageSize=100`,
      )
      expect(findClaim(afterRange, submittedClaimId), 'submittedFrom after the submission day should exclude the claim').toBeFalsy()

      const beforeRange = await listClaims(
        request,
        adminToken,
        `submittedTo=${isoDate(shiftDays(forcedSubmittedAt, -1))}&search=${encodeURIComponent(stamp)}&pageSize=100`,
      )
      expect(findClaim(beforeRange, submittedClaimId), 'submittedTo before the submission day should exclude the claim').toBeFalsy()

      const createdDay = isoDate(new Date(draftClaim.createdAt ?? Date.now()))
      const createdInRange = await listClaims(
        request,
        adminToken,
        `createdFrom=${createdDay}&createdTo=${createdDay}&search=${encodeURIComponent(stamp)}&pageSize=100`,
      )
      expect(findClaim(createdInRange, draftClaimId), 'inclusive created range should include the fresh claim').toBeTruthy()

      const createdBefore = await listClaims(
        request,
        adminToken,
        `createdTo=${isoDate(shiftDays(new Date(draftClaim.createdAt ?? Date.now()), -1))}&search=${encodeURIComponent(stamp)}&pageSize=100`,
      )
      expect(findClaim(createdBefore, draftClaimId), 'createdTo before the creation day should exclude the claim').toBeFalsy()

      const createdAfter = await listClaims(
        request,
        adminToken,
        `createdFrom=${isoDate(shiftDays(new Date(draftClaim.createdAt ?? Date.now()), 1))}&search=${encodeURIComponent(stamp)}&pageSize=100`,
      )
      expect(findClaim(createdAfter, draftClaimId), 'createdFrom after the creation day should exclude the claim').toBeFalsy()

      const invalidFormat = await apiRequest(
        request,
        'GET',
        `/api/warranty_claims?submittedFrom=${encodeURIComponent('07/10/2026')}`,
        { token: adminToken },
      )
      expect(invalidFormat.status(), 'non-ISO submittedFrom should be rejected').toBe(400)
    } finally {
      await cancelThenDeleteClaimIfPossible(request, adminToken, submittedClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, draftClaimId)
    }
  })

  test('slaAtRiskOnly returns approaching claims per settings threshold, excluding overdue, paused, fresh, and draft claims', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-027-c')
    let settingsSnapshot: WarrantyClaimSettingsResult | null = null
    let atRiskClaimId: string | null = null
    let freshClaimId: string | null = null
    let overdueClaimId: string | null = null
    let pausedClaimId: string | null = null
    let pausedOverdueClaimId: string | null = null
    let draftClaimId: string | null = null

    try {
      settingsSnapshot = await readWarrantyClaimSettings(request, adminToken)
      await saveWarrantyClaimSettings(
        request,
        adminToken,
        { slaAtRiskThresholdPct: 50 },
        settingsSnapshot.updatedAt,
      )

      const now = Date.now()

      const atRiskClaim = await createSubmittedClaim(request, adminToken, `QA WC Desk AtRisk ${stamp}`)
      atRiskClaimId = atRiskClaim.id
      await forceClaimSlaWindow({
        claimId: atRiskClaim.id!,
        submittedAt: new Date(now - 2 * HOUR_MS),
        dueAt: new Date(now + 1 * HOUR_MS),
      })

      const freshClaim = await createSubmittedClaim(request, adminToken, `QA WC Desk Fresh ${stamp}`)
      freshClaimId = freshClaim.id
      await forceClaimSlaWindow({
        claimId: freshClaim.id!,
        submittedAt: new Date(now - 5 * 60 * 1000),
        dueAt: new Date(now + 6 * HOUR_MS),
      })

      const overdueClaim = await createSubmittedClaim(request, adminToken, `QA WC Desk Overdue ${stamp}`)
      overdueClaimId = overdueClaim.id
      await forceClaimSlaWindow({
        claimId: overdueClaim.id!,
        submittedAt: new Date(now - 3 * HOUR_MS),
        dueAt: new Date(now - 1 * HOUR_MS),
      })

      const pausedClaim = await createSubmittedClaim(request, adminToken, `QA WC Desk Paused ${stamp}`)
      pausedClaimId = pausedClaim.id
      await forceClaimSlaWindow({
        claimId: pausedClaim.id!,
        submittedAt: new Date(now - 2 * HOUR_MS),
        dueAt: new Date(now + 1 * HOUR_MS),
        pausedAt: new Date(now - 30 * 60 * 1000),
      })

      const pausedOverdueClaim = await createSubmittedClaim(request, adminToken, `QA WC Desk PausedOverdue ${stamp}`)
      pausedOverdueClaimId = pausedOverdueClaim.id
      await forceClaimSlaWindow({
        claimId: pausedOverdueClaim.id!,
        submittedAt: new Date(now - 3 * HOUR_MS),
        dueAt: new Date(now - 1 * HOUR_MS),
        pausedAt: new Date(now - 30 * 60 * 1000),
      })

      const draftClaim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Desk DraftRisk ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      draftClaimId = draftClaim.id

      const atRiskRows = await listClaims(
        request,
        adminToken,
        `slaAtRiskOnly=true&search=${encodeURIComponent(stamp)}&pageSize=100`,
      )
      expect(findClaim(atRiskRows, atRiskClaimId), 'slaAtRiskOnly should include the approaching claim').toBeTruthy()
      expect(findClaim(atRiskRows, freshClaimId), 'slaAtRiskOnly should exclude claims below the threshold').toBeFalsy()
      expect(findClaim(atRiskRows, overdueClaimId), 'slaAtRiskOnly should exclude overdue claims').toBeFalsy()
      expect(findClaim(atRiskRows, pausedClaimId), 'slaAtRiskOnly should exclude paused claims').toBeFalsy()
      expect(findClaim(atRiskRows, draftClaimId), 'slaAtRiskOnly should exclude drafts without an SLA clock').toBeFalsy()

      const overdueRows = await listClaims(
        request,
        adminToken,
        `overdueOnly=true&search=${encodeURIComponent(stamp)}&pageSize=100`,
      )
      expect(findClaim(overdueRows, overdueClaimId), 'overdueOnly should include the past-due claim').toBeTruthy()
      expect(findClaim(overdueRows, atRiskClaimId), 'overdueOnly should not include at-risk claims').toBeFalsy()
      expect(findClaim(overdueRows, pausedOverdueClaimId), 'overdueOnly should not include paused past-due claims').toBeFalsy()
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsSnapshot)
      await cancelThenDeleteClaimIfPossible(request, adminToken, atRiskClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, freshClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, overdueClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, pausedClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, pausedOverdueClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, draftClaimId)
    }
  })
})
