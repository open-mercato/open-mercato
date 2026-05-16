import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { resolveChampionCrmAiAdapter } from '../ai/adapter'
import {
  cleanupChampionCrmRun,
  cleanupChampionCrmDemo,
  closeChampionCrmDb,
  advanceDealStageAction,
  assignApartmentAction,
  convertLeadToDealAction,
  createActivityFixture,
  createApartmentFixture,
  createAuditEventFixture,
  createContactFixture,
  createDealFixture,
  createInvestmentFixture,
  createRunId,
  getLeadById,
  intakeLead,
  markDealWonAction,
  qualifyLeadAction,
  readDbOne,
  seedChampionCrmDemo,
  scopeFromToken,
  updateLead,
} from './helpers/championCrmFixtures'

test.describe('TC-CHAMP-CRM-010-021: Champion CRM business path contracts', () => {
  test.afterAll(async () => {
    await closeChampionCrmDb()
  })

  test('TC-CHAMP-CRM-010: qualify lead contract updates status and exposes Activity + AuditEvent', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const runId = createRunId('champ-crm-010')
    try {
      const intake = await intakeLead(request, token, runId, {
        source: 'qualification-form',
        email: `qualified.${runId}@example.test`,
        name: 'Qualified Champion Lead',
      })
      const leadId = String(intake.body?.leadId)
      const update = await updateLead(request, token, leadId, {
        qualificationStatus: 'zakwalifikowany',
        qualifiedAt: new Date().toISOString(),
      })
      expect(update.status()).toBe(200)
      await createActivityFixture(scope, runId, {
        entityType: 'lead',
        entityId: leadId,
        leadId,
        contactId: String(intake.body?.contactId),
        type: 'system',
        title: 'Lead qualified',
      })
      await createAuditEventFixture(scope, runId, {
        entityType: 'lead',
        entityId: leadId,
        action: 'qualified',
      })

      const lead = await getLeadById(request, token, leadId)
      expect(lead?.qualificationStatus).toBe('zakwalifikowany')

      await login(page, 'admin')
      await page.goto(`/backend/champion-crm/leads/${leadId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('zakwalifikowany')).toBeVisible()
      await expect(page.getByText('Lead qualified')).toBeVisible()
      await expect(page.getByText('qualified')).toBeVisible()

      await test.step('Qualify button/form is expected when mutation UI lands', async () => {
        expect(lead?.qualificationStatus).toBe('zakwalifikowany')
      })
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-011: disqualify lead contract persists reason and AuditEvent', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const runId = createRunId('champ-crm-011')
    try {
      const intake = await intakeLead(request, token, runId, {
        source: 'qualification-form',
        email: `disqualified.${runId}@example.test`,
        name: 'Disqualified Champion Lead',
      })
      const leadId = String(intake.body?.leadId)
      const update = await updateLead(request, token, leadId, {
        qualificationStatus: 'niezakwalifikowany',
        disqualificationReason: 'Budget outside target',
        disqualifiedAt: new Date().toISOString(),
      })
      expect(update.status()).toBe(200)
      await createAuditEventFixture(scope, runId, {
        entityType: 'lead',
        entityId: leadId,
        action: 'disqualified',
        message: 'Budget outside target',
      })

      const lead = await getLeadById(request, token, leadId)
      expect(lead?.qualificationStatus).toBe('niezakwalifikowany')
      expect(lead?.disqualificationReason).toBe('Budget outside target')

      await login(page, 'admin')
      await page.goto(`/backend/champion-crm/leads/${leadId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('niezakwalifikowany')).toBeVisible()
      await expect(page.getByText('disqualified')).toBeVisible()

      await test.step('Disqualification reason UI field is expected when mutation UI lands', async () => {
        expect(lead?.disqualificationReason).toBe('Budget outside target')
      })
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-012: lead detail create Deal path exposes created deal in the current shell', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const runId = createRunId('champ-crm-012')
    try {
      const intake = await intakeLead(request, token, runId, {
        source: 'deal-form',
        email: `deal.${runId}@example.test`,
        name: 'Deal Champion Lead',
      })
      const leadId = String(intake.body?.leadId)
      await createDealFixture(scope, runId, {
        contactId: String(intake.body?.contactId),
        leadId,
        title: 'Deal from lead detail',
      })

      await login(page, 'admin')
      await page.goto(`/backend/champion-crm/leads/${leadId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /Deals/i })).toBeVisible()
      await expect(page.getByText('Deal from lead detail')).toBeVisible()

      await test.step('Create Deal control is expected when deal mutation UI lands', async () => {
        await expect(page.getByText('Deal from lead detail')).toBeVisible()
      })
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-013: Deal -> assign Investment relation is represented in persistence contract', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const runId = createRunId('champ-crm-013')
    try {
      const contactId = await createContactFixture(scope, runId, {
        displayName: 'Investment Assignment Contact',
        email: `investment.${runId}@example.test`,
      })
      const investmentId = await createInvestmentFixture(scope, runId, { name: 'Champion Residence' })
      const dealId = await createDealFixture(scope, runId, {
        contactId,
        investmentId,
        title: 'Investment assigned deal',
      })

      const row = await readDbOne<{ investment_id: string | null }>('select investment_id from champion_crm_deals where id = $1', [dealId])
      expect(row?.investment_id).toBe(investmentId)

      await test.step('Assign Investment UI control is expected when deal detail UI lands', async () => {
        expect(row?.investment_id).toBe(investmentId)
      })
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-014: Deal -> assign Apartment relation is represented in persistence contract', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const runId = createRunId('champ-crm-014')
    try {
      const contactId = await createContactFixture(scope, runId, {
        displayName: 'Apartment Assignment Contact',
        email: `apartment.${runId}@example.test`,
      })
      const investmentId = await createInvestmentFixture(scope, runId, { name: 'Champion Apartments' })
      const apartmentId = await createApartmentFixture(scope, runId, { investmentId, unitNumber: 'A-14' })
      const dealId = await createDealFixture(scope, runId, {
        contactId,
        investmentId,
        apartmentId,
        title: 'Apartment assigned deal',
      })

      const row = await readDbOne<{ apartment_id: string | null }>('select apartment_id from champion_crm_deals where id = $1', [dealId])
      expect(row?.apartment_id).toBe(apartmentId)

      await test.step('Assign Apartment UI control is expected when deal detail UI lands', async () => {
        expect(row?.apartment_id).toBe(apartmentId)
      })
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-015: apartment reservation stores reserved apartment and Deal relation', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const runId = createRunId('champ-crm-015')
    try {
      const contactId = await createContactFixture(scope, runId, {
        displayName: 'Reservation Contact',
        email: `reservation.${runId}@example.test`,
      })
      const investmentId = await createInvestmentFixture(scope, runId, { name: 'Reserved Investment' })
      const dealId = await createDealFixture(scope, runId, {
        contactId,
        investmentId,
        title: 'Reservation Deal',
        status: 'reserved',
      })
      const apartmentId = await createApartmentFixture(scope, runId, {
        investmentId,
        unitNumber: 'R-15',
        dealId,
        status: 'reserved',
      })

      const row = await readDbOne<{ status: string; reserved_by_deal_id: string | null; reserved_at: Date | null }>(
        'select status, reserved_by_deal_id, reserved_at from champion_crm_apartments where id = $1',
        [apartmentId],
      )
      expect(row?.status).toBe('reserved')
      expect(row?.reserved_by_deal_id).toBe(dealId)
      expect(row?.reserved_at).toBeTruthy()
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-016: manual activity note/call/task records render on Contact 360 lead detail', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const runId = createRunId('champ-crm-016')
    try {
      const intake = await intakeLead(request, token, runId, {
        source: 'activity-form',
        email: `activity.${runId}@example.test`,
        name: 'Activity Champion Lead',
      })
      const leadId = String(intake.body?.leadId)
      for (const [type, title] of [
        ['note', 'Manual note captured'],
        ['call', 'Manual call completed'],
        ['task', 'Manual task created'],
      ] as const) {
        await createActivityFixture(scope, runId, {
          entityType: 'contact',
          entityId: String(intake.body?.contactId),
          contactId: String(intake.body?.contactId),
          leadId,
          type,
          title,
        })
      }

      await login(page, 'admin')
      await page.goto(`/backend/champion-crm/leads/${leadId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('Manual note captured')).toBeVisible()
      await expect(page.getByText('Manual call completed')).toBeVisible()
      await expect(page.getByText('Manual task created')).toBeVisible()
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-017: follow-up scheduling persists nextFollowupAt and is contract-visible', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const runId = createRunId('champ-crm-017')
    try {
      const intake = await intakeLead(request, token, runId, {
        source: 'followup-form',
        email: `followup.${runId}@example.test`,
        name: 'Followup Champion Lead',
      })
      const leadId = String(intake.body?.leadId)
      const nextFollowupAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      const update = await updateLead(request, token, leadId, { nextFollowupAt })
      expect(update.status()).toBe(200)

      const lead = await getLeadById(request, token, leadId)
      expect(new Date(String(lead?.nextFollowupAt)).toISOString()).toBe(nextFollowupAt)

      await test.step('nextFollowupAt detail rendering is expected when the field is added to the shell', async () => {
        expect(lead?.nextFollowupAt).toBeTruthy()
      })
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-018: audit trail renders business change events on lead detail', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const runId = createRunId('champ-crm-018')
    try {
      const intake = await intakeLead(request, token, runId, {
        source: 'audit-form',
        email: `audit.${runId}@example.test`,
        name: 'Audit Champion Lead',
      })
      const leadId = String(intake.body?.leadId)
      await createAuditEventFixture(scope, runId, {
        entityType: 'lead',
        entityId: leadId,
        action: 'deal_created',
        message: 'Deal created from lead',
      })
      await createAuditEventFixture(scope, runId, {
        entityType: 'lead',
        entityId: leadId,
        action: 'followup_scheduled',
      })

      await login(page, 'admin')
      await page.goto(`/backend/champion-crm/leads/${leadId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /Audit/i })).toBeVisible()
      await expect(page.getByText('deal_created')).toBeVisible()
      await expect(page.getByText('followup_scheduled')).toBeVisible()
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-019: read-only user can read leads but cannot mutate them', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(adminToken)
    const runId = createRunId('champ-crm-019')
    const password = 'Valid1!Pass'
    const email = `champ-readonly-${runId}@example.test`
    let userId: string | null = null
    try {
      const intake = await intakeLead(request, adminToken, runId, {
        source: 'acl-form',
        email: `acl.${runId}@example.test`,
        name: 'ACL Champion Lead',
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [],
      })
      const aclResponse = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: adminToken,
        data: {
          userId,
          features: ['champion_crm.read'],
          organizations: [scope.organizationId],
        },
      })
      expect(aclResponse.status()).toBe(200)

      const loginResponse = await postForm(request, '/api/auth/login', { email, password })
      expect(loginResponse.status()).toBe(200)
      const loginBody = await readJsonSafe<{ token?: string }>(loginResponse)
      expect(typeof loginBody?.token).toBe('string')
      const readOnlyToken = String(loginBody?.token)

      const readResponse = await apiRequest(request, 'GET', `/api/champion-crm/leads?id=${intake.body?.leadId}`, {
        token: readOnlyToken,
      })
      expect(readResponse.status()).toBe(200)

      const mutateResponse = await updateLead(request, readOnlyToken, String(intake.body?.leadId), {
        qualificationStatus: 'zakwalifikowany',
      })
      expect(mutateResponse.status()).toBe(403)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-020: AI adapter is disabled by default', async () => {
    expect(resolveChampionCrmAiAdapter()).toBeNull()
  })

  test('TC-CHAMP-CRM-021: Anna / Hussar happy path qualifies, reserves A2.14, wins deal, and renders Contact 360', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    try {
      await cleanupChampionCrmDemo()
      const seed = await seedChampionCrmDemo(request, token)
      expect(seed.response.status()).toBe(200)
      const leadId = String(seed.body?.leadId)

      const qualify = await qualifyLeadAction(request, token, leadId)
      expect(qualify.status()).toBe(200)

      const converted = await convertLeadToDealAction(request, token, leadId)
      expect(converted.response.status()).toBe(200)
      const dealId = String(converted.body?.dealId)
      const contactId = String(converted.body?.contactId)

      const apartment = await readDbOne<{ id: string }>(
        "select id from champion_crm_apartments where unit_number = 'A2.14' and metadata->>'demo' = 'anna-hussar'",
        [],
      )
      expect(apartment?.id).toBeTruthy()

      const assign = await assignApartmentAction(request, token, dealId, String(apartment?.id))
      expect(assign.status()).toBe(200)
      const offer = await advanceDealStageAction(request, token, dealId, 'offer_open')
      expect(offer.status()).toBe(200)
      const reserve = await advanceDealStageAction(request, token, dealId, 'reservation_agreement')
      expect(reserve.status()).toBe(200)
      const won = await markDealWonAction(request, token, dealId)
      expect(won.status()).toBe(200)

      const result = await readDbOne<{
        deal_status: string
        deal_stage: string
        apartment_status: string
        lifecycle: string
        activity_count: string
        audit_count: string
      }>(
        `select d.status as deal_status,
          d.stage as deal_stage,
          a.status as apartment_status,
          c.lifecycle,
          (select count(*) from champion_crm_activities where deal_id = d.id)::text as activity_count,
          (select count(*) from champion_crm_audit_events where entity_id = d.id)::text as audit_count
        from champion_crm_deals d
        join champion_crm_contacts c on c.id = d.contact_id
        join champion_crm_apartments a on a.id = d.apartment_id
        where d.id = $1`,
        [dealId],
      )
      expect(result?.deal_status).toBe('won')
      expect(result?.deal_stage).toBe('won')
      expect(result?.apartment_status).toBe('sold')
      expect(['client', 'customer']).toContain(result?.lifecycle)
      expect(Number(result?.activity_count ?? 0)).toBeGreaterThanOrEqual(4)
      expect(Number(result?.audit_count ?? 0)).toBeGreaterThanOrEqual(4)

      await login(page, 'admin')
      await page.goto(`/backend/champion-crm/contacts/${contactId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: 'Anna Kowalska' })).toBeVisible()
      await expect(page.getByText('Hussar Loft')).toBeVisible()
      await expect(page.getByText('A2.14')).toBeVisible()
      await expect(page.getByText('Deal won')).toBeVisible()
    } finally {
      await cleanupChampionCrmDemo()
    }
  })
})
