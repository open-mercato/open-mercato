import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  listClaimLines,
  uniqueLabel,
} from './helpers'

type DamageAssessment = {
  damageType?: string
  severity?: 'minor' | 'moderate' | 'severe' | 'unknown'
  probableCause?: string
  misuseSuspected?: boolean
  confidence?: number
  summary?: string
}

type AiAssessResponse = {
  status?: 'ok' | 'notConfigured' | 'aiUnavailable'
  assessment?: DamageAssessment
  extraction?: Record<string, unknown>
  error?: string
}

test.describe('TC-WC-024: warranty claim AI assess API', () => {
  test('enforces auth/manage gates and returns documented AI degradation shapes', async ({ request }) => {
    const unauthenticated = await request.post('/api/warranty_claims/ai/assess', {
      headers: { 'Content-Type': 'application/json', Cookie: '' },
      data: {
        claimId: randomUUID(),
        lineId: randomUUID(),
        attachmentId: randomUUID(),
        kind: 'damage',
      },
    })
    expect(unauthenticated.status(), 'AI assess route should require staff auth').toBe(401)

    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-024')

    let viewOnlyRoleId: string | null = null
    let viewOnlyUserId: string | null = null
    let claimId: string | null = null

    try {
      viewOnlyRoleId = await createRoleFixture(request, adminToken, { name: `QA WC AI Assess View ${stamp}` })
      await setRoleAclFeatures(request, adminToken, {
        roleId: viewOnlyRoleId,
        features: ['warranty_claims.claim.view'],
        organizations: [organizationId],
      })
      const password = 'Valid1!Pass'
      const email = `${stamp}@test.invalid`
      viewOnlyUserId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [viewOnlyRoleId],
        name: `QA WC AI Assess View ${stamp}`,
      })
      const viewOnlyToken = await getAuthToken(request, email, password)

      const claim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC AI Assess ${stamp}`,
        reasonCode: 'defective',
        lines: [
          {
            lineNo: 1,
            productName: `QA AI assess product ${stamp}`,
            serialNumber: `SER-024-${stamp}`,
            faultDescription: 'The housing is cracked in the submitted photo',
            qtyClaimed: 1,
          },
        ],
      })
      claimId = claim.id
      const [line] = await listClaimLines(request, adminToken, claim.id!)
      expect(line?.id, 'created claim should include a line').toBeTruthy()

      const payload = {
        claimId,
        lineId: line.id,
        attachmentId: randomUUID(),
        kind: 'damage',
      }

      const forbidden = await apiRequest(request, 'POST', '/api/warranty_claims/ai/assess', {
        token: viewOnlyToken,
        data: payload,
      })
      expect(forbidden.status(), 'view-only user should not run AI assess').toBe(403)

      const assessResponse = await apiRequest(request, 'POST', '/api/warranty_claims/ai/assess', {
        token: adminToken,
        data: payload,
      })
      const assessBody = await readJsonSafe<AiAssessResponse>(assessResponse)
      expect(
        assessResponse.status(),
        `AI assess should return the documented 200 degradation/success envelope: ${JSON.stringify(assessBody)}`,
      ).toBe(200)
      expect(['ok', 'notConfigured', 'aiUnavailable']).toContain(assessBody?.status)
      if (assessBody?.status === 'ok') {
        expect(assessBody.assessment, 'damage assessment should be present on configured model success').toBeTruthy()
        expect(typeof assessBody.assessment?.summary).toBe('string')
        expect(typeof assessBody.assessment?.confidence).toBe('number')
      }
    } finally {
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      await deleteUserIfExists(request, adminToken, viewOnlyUserId)
      await deleteRoleIfExists(request, adminToken, viewOnlyRoleId)
    }
  })
})
