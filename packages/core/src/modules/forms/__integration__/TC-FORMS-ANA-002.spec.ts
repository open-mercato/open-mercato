import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildSensitiveFormSchema,
  createAnonymousRunFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  publicAutosave,
  publicSubmit,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

type FieldStats = {
  fieldKey: string
  type: string
  sensitive: boolean
  answered: number
  blank: number
  choices?: Array<{ value: unknown; count: number }>
}

/**
 * TC-FORMS-ANA-002: analytics never returns a raw answer value for a sensitive or
 * free-text field.
 *
 * This is a PII-leak guard, not an analytics feature — which is why it sits in P0
 * while the rest of the analytics area does not. The service decrypts revision
 * payloads server-side in order to TALLY them, so it holds every answer in memory
 * on every request; the contract is that only counts come back out.
 *
 * Distinct, searchable sentinel strings are written into a sensitive field and a
 * free-text field, then the WHOLE response body is stringified and searched. That
 * is deliberately coarser than checking named keys: a leak could surface anywhere
 * — a `choices` distribution, a drop-off label, an error message echoing input —
 * and a key-by-key assertion would miss a path nobody thought of.
 *
 * The positive half matters as much: a non-sensitive enumerable field MUST still
 * get a `choices` distribution, otherwise "no values leak" could be satisfied by
 * an endpoint that returns nothing useful at all.
 */
test.describe('TC-FORMS-ANA-002: analytics is PII-safe', () => {
  test('returns counts only, never a sensitive or free-text answer value', async ({ request }) => {
    test.setTimeout(180_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const sensitiveAnswer = `SENSITIVE-DIAGNOSIS-${stamp}`
    const freeTextAnswer = `FREETEXT-NOTES-${stamp}`
    const nameAnswer = `FREETEXT-NAME-${stamp}`

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      await withCredentialIsolatedRequest(async (anonymous) => {
        const run = await createAnonymousRunFixture(request, anonymous, adminToken as string, {
          schema: buildSensitiveFormSchema(),
        })
        formId = run.formId
        distributionId = run.distributionId

        await waitForAutosaveWindow()
        const saveRes = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          baseRevisionId: run.revisionId,
          patch: {
            full_name: nameAnswer,
            notes: freeTextAnswer,
            diagnosis: sensitiveAnswer,
            consented: true,
          },
          clientIp: run.clientIp,
        })
        expect(
          saveRes.status(),
          `the autosave should succeed (got ${saveRes.status()}: ${await saveRes.text()})`,
        ).toBe(200)
        const saved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(saveRes)

        const submitRes = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken: saved?.access_token ?? run.accessToken,
          baseRevisionId: saved!.revision!.id as string,
          clientIp: run.clientIp,
        })
        expect(submitRes.status(), 'the submit should succeed').toBe(200)
      })

      const analyticsRes = await apiRequest(request, 'GET', `/api/forms/${formId}/analytics`, {
        token: adminToken,
      })
      const raw = await analyticsRes.text()
      expect(
        analyticsRes.status(),
        `the analytics read should return 200 (got ${analyticsRes.status()}: ${raw.slice(0, 300)})`,
      ).toBe(200)

      // The leak check: the entire payload, not a hand-picked set of keys.
      expect(raw, 'a sensitive answer must never appear anywhere in the analytics body').not.toContain(
        sensitiveAnswer,
      )
      expect(raw, 'a free-text answer must never appear anywhere in the analytics body').not.toContain(
        freeTextAnswer,
      )
      expect(raw, 'a free-text name must never appear anywhere in the analytics body').not.toContain(
        nameAnswer,
      )

      const analytics = JSON.parse(raw) as {
        formId: string
        funnel: Record<string, unknown>
        fields: FieldStats[]
        volume: unknown[]
        scan: { limit: number; scanned: number; capped: boolean }
      }
      expect(analytics.formId, 'the response names the form').toBe(formId)
      expect(analytics.scan.scanned, 'the scan saw our submission').toBeGreaterThanOrEqual(1)
      expect(analytics.scan.capped, 'a single submission does not hit the scan cap').toBe(false)

      const byKey = new Map(analytics.fields.map((entry) => [entry.fieldKey, entry]))

      const diagnosis = byKey.get('diagnosis') as FieldStats
      expect(diagnosis, 'the sensitive field still appears, so operators can see completion').toBeTruthy()
      expect(diagnosis.sensitive, 'the sensitive field is flagged as such').toBe(true)
      expect(diagnosis.answered, 'the sensitive field reports that it was answered').toBe(1)
      expect(
        diagnosis.choices,
        'a sensitive field gets no value distribution at all, only counts',
      ).toBeUndefined()

      const notes = byKey.get('notes') as FieldStats
      expect(notes, 'the free-text field appears').toBeTruthy()
      expect(
        notes.choices,
        'a free-text field is not enumerable, so it gets no value distribution',
      ).toBeUndefined()

      const name = byKey.get('full_name') as FieldStats
      expect(
        name.choices,
        'a text field is not enumerable either, however short the answers are',
      ).toBeUndefined()

      // The positive half: a non-sensitive enumerable field DOES get counts, so
      // the guard above is not satisfied by an empty response.
      const consented = byKey.get('consented') as FieldStats
      expect(consented, 'the enumerable boolean field appears').toBeTruthy()
      expect(consented.sensitive, 'the boolean field is not sensitive').toBe(false)
      expect(consented.answered, 'the boolean field reports that it was answered').toBe(1)
      expect(
        Array.isArray(consented.choices),
        'a non-sensitive enumerable field DOES get a value distribution',
      ).toBe(true)
      expect(consented.choices?.length, 'the distribution carries the one observed value').toBe(1)
      expect(consented.choices?.[0]?.count, 'the distribution counts the one submission').toBe(1)
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
