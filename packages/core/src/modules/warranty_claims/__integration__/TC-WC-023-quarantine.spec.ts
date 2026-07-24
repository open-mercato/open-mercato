import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  listClaimLines,
  readClaimLine,
  readWarrantyClaimSettings,
  receiveClaimLine,
  requestJson,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
  type WarrantyClaimSettingsResult,
} from './helpers'

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato')
const QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')

type QueueEventPayload = {
  event?: string
  payload?: Record<string, unknown>
}

type QueueEventJob = {
  payload?: QueueEventPayload
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function toQueueEventJob(value: unknown): QueueEventJob | null {
  const record = toRecord(value)
  if (!record) return null
  const payloadRecord = toRecord(record.payload)
  const eventPayload = payloadRecord ? toRecord(payloadRecord.payload) : null
  return {
    payload: payloadRecord
      ? {
          event: typeof payloadRecord.event === 'string' ? payloadRecord.event : undefined,
          payload: eventPayload ?? undefined,
        }
      : undefined,
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

function hasQueuedLineEvent(jobs: readonly QueueEventJob[], event: string, lineId: string): boolean {
  return jobs.some((job) => job.payload?.event === event && job.payload.payload?.lineId === lineId)
}

async function saveQuarantineSettings(
  request: Parameters<typeof readWarrantyClaimSettings>[0],
  token: string,
  current: WarrantyClaimSettingsResult,
): Promise<void> {
  await saveWarrantyClaimSettings(request, token, {
    slaHours: current.slaHours,
    slaPauseOnInfoRequested: current.slaPauseOnInfoRequested,
    slaAtRiskThresholdPct: current.slaAtRiskThresholdPct,
    autoApproveEnabled: current.autoApproveEnabled,
    autoApproveMaxAmount: current.autoApproveMaxAmount,
    autoApproveCurrencyCode: current.autoApproveCurrencyCode,
    autoApproveRequireInWarranty: current.autoApproveRequireInWarranty,
    defaultWarrantyMonths: current.defaultWarrantyMonths,
    businessHours: current.businessHours,
    escalationTiers: current.escalationTiers,
    adjudicationUseRules: current.adjudicationUseRules,
    quarantineGrades: ['D'],
    returnLabelProvider: current.returnLabelProvider,
  }, current.updatedAt)
}

test.describe('TC-WC-023: warranty claim quarantine receiving', () => {
  test('holds configured grades, emits the quarantine event, and releases the hold', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-023')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)

    let claimId: string | null = null

    try {
      await saveQuarantineSettings(request, adminToken, settingsBefore)

      let claim = await createClaimFixture(request, adminToken, {
        claimType: 'return',
        customerName: `QA WC Quarantine ${stamp}`,
        reasonCode: 'damaged',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-023-${stamp}`,
            productName: 'QA quarantine product',
            faultDescription: 'Fixture should be quarantined',
            qtyClaimed: 1,
            creditAmount: 18,
          },
        ],
      })
      claimId = claim.id
      const [line] = await listClaimLines(request, adminToken, claim.id!)
      expect(line?.id, 'created claim should include a line').toBeTruthy()

      claim = await submitAndExpect(request, adminToken, claim)
      claim = await transitionAndExpect(request, adminToken, claim, 'in_review')
      claim = await transitionAndExpect(request, adminToken, claim, 'approved')
      claim = await transitionAndExpect(request, adminToken, claim, 'awaiting_return')
      claim = await transitionAndExpect(request, adminToken, claim, 'received')

      const lineBeforeReceive = await readClaimLine(request, adminToken, claim.id!, line.id!)
      expect(
        lineBeforeReceive.updatedAt,
        'lifecycle transitions bump the claim version only, so the line must carry its own',
      ).not.toBe(claim.updatedAt)

      const receiveResponse = await receiveClaimLine(request, adminToken, {
        lineId: line.id!,
        conditionGrade: 'D',
        inspectionNotes: `Quarantine inspection ${stamp}`,
        updatedAt: lineBeforeReceive.updatedAt,
      })
      const receiveBody = await readJsonSafe<{ ok?: boolean; lineId?: string | null }>(receiveResponse)
      expect(receiveResponse.status(), `quarantine grade should be received: ${JSON.stringify(receiveBody)}`).toBe(200)
      expect(receiveBody?.lineId).toBe(line.id)

      const heldLine = await readClaimLine(request, adminToken, claim.id!, line.id!)
      expect(heldLine.conditionGrade).toBe('D')
      expect(heldLine.quarantineStatus).toBe('held')
      const queuedEvents = await readQueuedEventJobs()
      expect(
        hasQueuedLineEvent(queuedEvents, 'warranty_claims.claim_line.quarantined', line.id!),
        'receiving a configured quarantine grade should emit line_quarantined',
      ).toBe(true)

      const staleReleaseResponse = await requestJson(
        request,
        'POST',
        '/api/warranty_claims/receiving',
        adminToken,
        { lineId: line.id, action: 'release', updatedAt: lineBeforeReceive.updatedAt },
      )
      expect(
        staleReleaseResponse.status(),
        'releasing with the pre-receive line version should conflict',
      ).toBe(409)

      const releaseResponse = await requestJson(
        request,
        'POST',
        '/api/warranty_claims/receiving',
        adminToken,
        { lineId: line.id, action: 'release', updatedAt: heldLine.updatedAt },
      )
      const releaseBody = await readJsonSafe<{ ok?: boolean; lineId?: string | null }>(releaseResponse)
      expect(releaseResponse.status(), `quarantine release should return 200: ${JSON.stringify(releaseBody)}`).toBe(200)
      expect(releaseBody?.lineId).toBe(line.id)

      const releasedLine = await readClaimLine(request, adminToken, claim.id!, line.id!)
      expect(releasedLine.quarantineStatus).toBe('released')
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
    }
  })
})
