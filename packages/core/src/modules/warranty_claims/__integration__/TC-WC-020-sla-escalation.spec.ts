import fs from 'node:fs/promises'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { createQueue } from '@open-mercato/queue'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  readClaimEvents,
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
const QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')

if (!process.env.DATABASE_URL) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
}
process.env.QUEUE_BASE_DIR = process.env.QUEUE_BASE_DIR?.trim() || QUEUE_BASE_DIR

type SlaSweepPayload = {
  scope: {
    tenantId: string
    organizationId: string
  }
}

type QueueEventPayload = {
  event?: string
  payload?: Record<string, unknown>
}

type QueueEventJob = {
  id?: string
  payload?: QueueEventPayload
}

type SlaStateRow = {
  escalation_level: number | string | null
  assignee_user_id: string | null
  sla_paused_at: Date | string | null
}

type SlaState = {
  escalationLevel: number
  assigneeUserId: string | null
  slaPausedAt: string | null
}

let dbClient: Client | null = null

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function toQueueEventJob(value: unknown): QueueEventJob | null {
  const record = toRecord(value)
  if (!record) return null
  const payloadRecord = toRecord(record.payload)
  const eventPayload = payloadRecord ? toRecord(payloadRecord.payload) : null
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    payload: payloadRecord
      ? {
          event: typeof payloadRecord.event === 'string' ? payloadRecord.event : undefined,
          payload: eventPayload ?? undefined,
        }
      : undefined,
  }
}

async function getDbClient(): Promise<Client> {
  if (dbClient) return dbClient
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for TC-WC-020 to seed SLA timestamps')
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

async function updateSlaClock(input: {
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

async function readSlaState(claimId: string): Promise<SlaState> {
  const client = await getDbClient()
  const result = await client.query<SlaStateRow>(
    `
      select escalation_level, assignee_user_id, sla_paused_at
      from warranty_claims
      where id = $1
    `,
    [claimId],
  )
  const row = result.rows[0]
  expect(row, `claim ${claimId} should exist for SLA state read`).toBeTruthy()
  return {
    escalationLevel: Number(row.escalation_level ?? 0),
    assigneeUserId: row.assignee_user_id ?? null,
    slaPausedAt: row.sla_paused_at ? new Date(row.sla_paused_at).toISOString() : null,
  }
}

async function readQueuedEventJobs(): Promise<QueueEventJob[]> {
  const queueFile = path.join(QUEUE_BASE_DIR, 'events', 'queue.json')
  try {
    const raw = await fs.readFile(queueFile, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(toQueueEventJob).filter((job): job is QueueEventJob => job !== null)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
    if (code === 'ENOENT') return []
    throw error
  }
}

function hasQueuedClaimEvent(jobs: readonly QueueEventJob[], event: string, claimId: string): boolean {
  return jobs.some((job) => job.payload?.event === event && job.payload.payload?.claimId === claimId)
}

async function enqueueSlaSweep(payload: SlaSweepPayload): Promise<void> {
  const queue = createQueue<SlaSweepPayload>('warranty_claims.sla_sweep', 'local', {
    baseDir: QUEUE_BASE_DIR,
    concurrency: 1,
  })
  try {
    await queue.enqueue(payload)
  } finally {
    await queue.close()
  }
}

async function runSlaSweep(scope: SlaSweepPayload['scope']): Promise<QueueEventJob[]> {
  const before = await readQueuedEventJobs()
  const beforeIds = new Set(before.map((job) => job.id).filter((id): id is string => typeof id === 'string'))
  await enqueueSlaSweep({ scope })
  const processed = await drainIntegrationQueue('warranty_claims.sla_sweep', { appRoot: APP_ROOT })
  expect(processed, 'SLA sweep queue should process at least one job').toBeGreaterThan(0)
  const after = await readQueuedEventJobs()
  return after.filter((job) => !job.id || !beforeIds.has(job.id))
}

async function saveSlaSettings(
  request: Parameters<typeof readWarrantyClaimSettings>[0],
  token: string,
  current: WarrantyClaimSettingsResult,
  assigneeUserId: string,
): Promise<WarrantyClaimSettingsResult> {
  return saveWarrantyClaimSettings(request, token, {
    slaHours: 1,
    slaPauseOnInfoRequested: true,
    slaAtRiskThresholdPct: 50,
    autoApproveEnabled: current.autoApproveEnabled,
    autoApproveMaxAmount: current.autoApproveMaxAmount,
    autoApproveCurrencyCode: current.autoApproveCurrencyCode,
    autoApproveRequireInWarranty: current.autoApproveRequireInWarranty,
    defaultWarrantyMonths: current.defaultWarrantyMonths,
    businessHours: null,
    escalationTiers: [{ atPct: 100, action: 'reassign', toUserId: assigneeUserId }],
    adjudicationUseRules: current.adjudicationUseRules,
    quarantineGrades: current.quarantineGrades,
    returnLabelProvider: current.returnLabelProvider,
  }, current.updatedAt)
}

async function createSubmittedSlaClaim(
  request: Parameters<typeof createClaimFixture>[0],
  token: string,
  stamp: string,
  label: string,
): Promise<ClaimItem> {
  const claim = await createClaimFixture(request, token, {
    claimType: 'warranty',
    customerName: `QA WC SLA ${label} ${stamp}`,
    reasonCode: 'defective',
    currencyCode: 'USD',
  })
  return submitAndExpect(request, token, claim)
}

test.afterAll(async () => {
  await closeDbClient()
})

test.describe('TC-WC-020: warranty claim SLA escalation sweep', () => {
  test('emits SLA at-risk and breached events, skips paused claims, and applies each escalation tier once', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = uniqueLabel('tc-wc-020')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)
    const createdClaimIds: string[] = []
    const now = new Date()

    try {
      await saveSlaSettings(request, adminToken, settingsBefore, scope.userId)

      const atRiskClaim = await createSubmittedSlaClaim(request, adminToken, stamp, 'at-risk')
      createdClaimIds.push(atRiskClaim.id!)
      const breachedClaim = await createSubmittedSlaClaim(request, adminToken, stamp, 'breached')
      createdClaimIds.push(breachedClaim.id!)
      const pausedClaim = await createSubmittedSlaClaim(request, adminToken, stamp, 'paused')
      createdClaimIds.push(pausedClaim.id!)

      await updateSlaClock({
        claimId: atRiskClaim.id!,
        submittedAt: new Date(now.getTime() - 45 * 60 * 1000),
        dueAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      await updateSlaClock({
        claimId: breachedClaim.id!,
        submittedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        dueAt: new Date(now.getTime() - 60 * 60 * 1000),
      })
      await updateSlaClock({
        claimId: pausedClaim.id!,
        submittedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        dueAt: new Date(now.getTime() - 60 * 60 * 1000),
        pausedAt: now,
      })

      const firstSweepEvents = await runSlaSweep({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      expect(
        hasQueuedClaimEvent(firstSweepEvents, 'warranty_claims.claim.sla_at_risk', atRiskClaim.id!),
        'SLA sweep should emit an at-risk event for the threshold-crossing claim',
      ).toBe(true)
      expect(
        hasQueuedClaimEvent(firstSweepEvents, 'warranty_claims.claim.sla_breached', breachedClaim.id!),
        'SLA sweep should emit a breached event for the overdue claim',
      ).toBe(true)
      expect(
        firstSweepEvents.some((job) => job.payload?.payload?.claimId === pausedClaim.id),
        'paused claims should not emit SLA sweep events',
      ).toBe(false)

      const breachedState = await readSlaState(breachedClaim.id!)
      expect(breachedState.escalationLevel).toBe(1)
      expect(breachedState.assigneeUserId).toBe(scope.userId)

      const pausedState = await readSlaState(pausedClaim.id!)
      expect(pausedState.escalationLevel).toBe(0)
      expect(pausedState.assigneeUserId).toBeNull()
      expect(pausedState.slaPausedAt).toBeTruthy()

      const breachedEvents = await readClaimEvents(request, adminToken, breachedClaim.id!)
      const escalatedEvents = breachedEvents.filter(
        (event) => event.kind === 'system' && event.payload?.action === 'sla_escalated',
      )
      expect(escalatedEvents.length).toBe(1)
      expect(escalatedEvents[0].payload?.level).toBe(1)
      expect(escalatedEvents[0].payload?.reassignToUserId).toBe(scope.userId)

      await drainIntegrationQueue('events', { appRoot: APP_ROOT })
      await runSlaSweep({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      const breachedStateAfterSecondSweep = await readSlaState(breachedClaim.id!)
      expect(breachedStateAfterSecondSweep.escalationLevel).toBe(1)
      expect(breachedStateAfterSecondSweep.assigneeUserId).toBe(scope.userId)
      const breachedEventsAfterSecondSweep = await readClaimEvents(request, adminToken, breachedClaim.id!)
      expect(
        breachedEventsAfterSecondSweep.filter(
          (event) => event.kind === 'system' && event.payload?.action === 'sla_escalated',
        ).length,
        'second sweep should not bump the already-fired tier again',
      ).toBe(escalatedEvents.length)
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
      for (const claimId of createdClaimIds.reverse()) {
        await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      }
    }
  })
})
