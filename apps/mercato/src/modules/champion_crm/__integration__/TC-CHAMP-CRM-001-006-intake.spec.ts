import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupChampionCrmRun,
  closeChampionCrmDb,
  createRunId,
  getLeadById,
  intakeLead,
  readDbOne,
} from './helpers/championCrmFixtures'

test.describe('TC-CHAMP-CRM-001-006: Champion CRM lead intake contracts', () => {
  test.afterAll(async () => {
    await closeChampionCrmDb()
  })

  test('TC-CHAMP-CRM-001: website/form intake creates a new Lead and Contact', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const runId = createRunId('champ-crm-001')
    try {
      const { response, body } = await intakeLead(request, token, runId, {
        source: 'website-form',
        email: `anna.${runId}@example.test`,
        phone: '+48 501 100 001',
        name: 'Anna Intake',
      })

      expect(response.status()).toBe(201)
      expect(body?.techStatus).toBe('created_contact')
      expect(typeof body?.leadId).toBe('string')
      expect(typeof body?.contactId).toBe('string')

      const lead = await getLeadById(request, token, String(body?.leadId))
      expect(lead?.source).toBe('website-form')
      expect(lead?.contactId).toBe(body?.contactId)
      expect(lead?.emailNormalized).toBe(`anna.${runId}@example.test`)
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-002: same email intake deduplicates to the existing Contact', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const runId = createRunId('champ-crm-002')
    const email = `email-dedup.${runId}@example.test`
    try {
      const first = await intakeLead(request, token, runId, {
        source: 'website-form',
        email,
        name: 'Email Dedup One',
      })
      expect(first.response.status()).toBe(201)
      const contactId = String(first.body?.contactId)

      const second = await intakeLead(request, token, runId, {
        source: 'website-form',
        email,
        name: 'Email Dedup Two',
      })
      expect(second.response.status()).toBe(201)
      expect(second.body?.techStatus).toBe('matched_contact')
      expect(second.body?.contactId).toBe(contactId)
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-003: same phone intake deduplicates to the existing Contact', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const runId = createRunId('champ-crm-003')
    const phone = '+48 501 100 003'
    try {
      const first = await intakeLead(request, token, runId, {
        source: 'call-center',
        phone,
        name: 'Phone Dedup One',
      })
      expect(first.response.status()).toBe(201)
      const contactId = String(first.body?.contactId)

      const second = await intakeLead(request, token, runId, {
        source: 'call-center',
        phone,
        name: 'Phone Dedup Two',
      })
      expect(second.response.status()).toBe(201)
      expect(second.body?.techStatus).toBe('matched_contact')
      expect(second.body?.contactId).toBe(contactId)
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-004: lead without email or phone is routed to manual_review', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const runId = createRunId('champ-crm-004')
    try {
      const { response, body } = await intakeLead(request, token, runId, {
        source: 'kiosk',
        name: 'Anonymous Visitor',
      })
      expect(response.status()).toBe(201)
      expect(body?.techStatus).toBe('manual_review')
      expect(body?.contactId).toBeNull()

      const lead = await getLeadById(request, token, String(body?.leadId))
      expect(lead?.techStatus).toBe('manual_review')
      expect(lead?.nameRaw).toBe('Anonymous Visitor')
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-005: UTM and source payload are persisted for campaign attribution', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const runId = createRunId('champ-crm-005')
    try {
      const { response, body } = await intakeLead(request, token, runId, {
        source: 'landing-page',
        email: `utm.${runId}@example.test`,
        name: 'Campaign Visitor',
        utm: {
          source: 'google',
          medium: 'cpc',
          campaign: 'spring-open-day',
          term: 'apartments',
          content: 'hero-cta',
        },
        payload: { runId, formId: 'hero', campaignCode: 'SPRING' },
      })
      expect(response.status()).toBe(201)

      const row = await readDbOne<{
        source: string
        utm_source: string
        utm_medium: string
        utm_campaign: string
        source_payload: Record<string, unknown>
      }>(
        'select source, utm_source, utm_medium, utm_campaign, source_payload from champion_crm_leads where id = $1',
        [body?.leadId],
      )
      expect(row?.source).toBe('landing-page')
      expect(row?.utm_source).toBe('google')
      expect(row?.utm_medium).toBe('cpc')
      expect(row?.utm_campaign).toBe('spring-open-day')
      expect(row?.source_payload?.campaignCode).toBe('SPRING')
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-006: consents create ConsentEvent records and remain linked to Contact 360 context', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const runId = createRunId('champ-crm-006')
    try {
      const { response, body } = await intakeLead(request, token, runId, {
        source: 'privacy-form',
        email: `consent.${runId}@example.test`,
        name: 'Consent Person',
        consents: [
          { scope: 'contact_request', granted: true, textVersion: 'v1', evidence: { runId, ip: '127.0.0.1' } },
          { scope: 'marketing_email', granted: true, textVersion: 'v1', evidence: { runId, checkbox: 'marketing' } },
        ],
      })
      expect(response.status()).toBe(201)
      expect(typeof body?.contactId).toBe('string')

      const row = await readDbOne<{ consent_count: string; contact_id: string | null }>(
        'select count(*)::text as consent_count, max(contact_id)::text as contact_id from champion_crm_consent_events where lead_id = $1',
        [body?.leadId],
      )
      expect(row?.consent_count).toBe('2')
      expect(row?.contact_id).toBe(body?.contactId)

      await test.step('Contact 360 consent UI is expected once a consent panel is implemented', async () => {
        expect(body?.contactId, 'current detail shell links consent records to the same Contact 360 context').toBeTruthy()
      })
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })
})
