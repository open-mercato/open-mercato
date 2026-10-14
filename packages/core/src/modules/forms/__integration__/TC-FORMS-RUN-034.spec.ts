import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildMinimalFormSchema,
  createPublishedFormFixture,
  deleteFormIfExists,
  portalCall,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-RUN-034: a portal customer can start, submit and sign consent only for
 * their own subject (#7224).
 *
 * Two customers in one organization share a published form with a signature field.
 * Customer A is refused with 403 when starting on customer B's `customer` subject or
 * on a subject type the portal does not support, and nothing is persisted. A draft
 * whose subject was rewritten to B in the database (the shape of a draft forged
 * before the fix) is refused on both submit routes, so B's signed consent stays the
 * only active record for B. A's own start, signature and submit still work, and so
 * does a submit by A on B's subject once staff assign A as an actor there.
 *
 * ENVIRONMENT: the forged-draft step writes to Postgres directly, so the app and the
 * fixtures must share one database (the standard integration harness).
 *
 * Cleanup: the form's submissions, revisions, actors and consent records have no
 * delete API, so `finally` removes them in SQL before deleting the form and customers.
 */

type ConsentItem = { submissionId?: string; status?: string }
type StartedSubmission = { submissionId: string; revisionId: string }

function buildSignatureFormSchema(): Record<string, unknown> {
  const schema = buildMinimalFormSchema() as Record<string, unknown>
  const properties = schema.properties as Record<string, unknown>
  properties.consent = {
    type: 'object',
    'x-om-type': 'signature',
    'x-om-label': { en: 'Consent signature' },
    'x-om-consent-clause': { en: 'I consent to the processing described above.' },
    'x-om-signature-modes': ['typed'],
    'x-om-editable-by': ['participant'],
    'x-om-visible-to': ['admin', 'participant'],
  }
  schema['x-om-sections'] = [
    { key: 'identity', title: { en: 'Identity' }, fieldKeys: ['full_name', 'notes', 'consent'] },
  ]
  return schema
}

function typedSignature(name: string): Record<string, unknown> {
  return {
    mode: 'typed',
    typedName: name,
    affirmed: true,
    signedAt: new Date().toISOString(),
    clauseSha256: 'c'.repeat(64),
  }
}

async function startOwn(
  request: APIRequestContext,
  cookies: Record<string, string>,
  formKey: string,
  subjectId: string,
): Promise<StartedSubmission> {
  const response = await portalCall(request, 'POST', '/api/forms/form-submissions', {
    cookies,
    data: { form_key: formKey, subject_type: 'customer', subject_id: subjectId },
  })
  const body = await readJsonSafe<{ submission?: { id?: string }; revision?: { id?: string } }>(response)
  expect(response.status(), `own-subject start should be 201 (got ${response.status()}: ${JSON.stringify(body)})`).toBe(201)
  return { submissionId: String(body?.submission?.id), revisionId: String(body?.revision?.id) }
}

async function sign(
  request: APIRequestContext,
  cookies: Record<string, string>,
  started: StartedSubmission,
  signer: string,
): Promise<string> {
  await waitForAutosaveWindow()
  const response = await portalCall(request, 'PATCH', `/api/forms/form-submissions/${started.submissionId}`, {
    cookies,
    data: {
      base_revision_id: started.revisionId,
      patch: { full_name: signer, consent: typedSignature(signer) },
    },
  })
  const body = await readJsonSafe<{ revision?: { id?: string } }>(response)
  expect(response.status(), `signature save should be 200 (got ${response.status()}: ${JSON.stringify(body)})`).toBe(200)
  return String(body?.revision?.id)
}

async function submitOwn(
  request: APIRequestContext,
  cookies: Record<string, string>,
  submissionId: string,
  revisionId: string,
): Promise<void> {
  const response = await portalCall(request, 'POST', `/api/forms/form-submissions/${submissionId}/submit`, {
    cookies,
    data: { base_revision_id: revisionId },
  })
  expect(response.status(), `own-subject submit should be 200 (got ${response.status()})`).toBe(200)
}

async function readActiveConsentSubmissions(
  request: APIRequestContext,
  adminToken: string,
  subjectId: string,
  formId: string,
): Promise<string[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/forms/subjects/customer/${subjectId}/consents?formId=${formId}`,
    { token: adminToken },
  )
  expect(response.status(), 'consent read should be 200').toBe(200)
  const body = await readJsonSafe<{ items?: ConsentItem[] }>(response)
  return (body?.items ?? [])
    .filter((item) => item.status === 'active')
    .map((item) => String(item.submissionId))
}

async function countSubmissions(formId: string, subjectId: string, startedBy: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count
         from forms_form_submission s
         join forms_form_version v on v.id = s.form_version_id
        where v.form_id = $1 and s.subject_id = $2 and s.started_by = $3`,
      [formId, subjectId, startedBy],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

async function readSubmissionStatus(submissionId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ status: string }>(
      'select status from forms_form_submission where id = $1',
      [submissionId],
    )
    return result.rows[0]?.status ?? null
  })
}

async function deleteFormRuntimeRows(formId: string | null): Promise<void> {
  if (!formId) return
  await withClient(async (client) => {
    const submissionIds = `select s.id from forms_form_submission s
      join forms_form_version v on v.id = s.form_version_id where v.form_id = $1`
    await client.query('delete from forms_consent_record where form_id = $1', [formId])
    await client.query(`delete from forms_form_submission_actor where submission_id in (${submissionIds})`, [formId])
    await client.query(`delete from forms_form_submission_revision where submission_id in (${submissionIds})`, [formId])
    await client.query(`delete from forms_form_submission where id in (${submissionIds})`, [formId])
  })
}

test.describe('TC-FORMS-RUN-034: portal start and submit are limited to the caller\'s own subject', () => {
  test('customer A cannot start or submit for customer B, and B\'s consent survives', async ({ request }) => {
    test.setTimeout(240_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    let adminToken: string | null = null
    let formId: string | null = null
    let customerAId: string | null = null
    let customerBId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)

      const published = await createPublishedFormFixture(request, adminToken, {
        name: `QA RUN034 ${stamp}`,
        schema: buildSignatureFormSchema(),
        uiSchema: { full_name: { 'ui:widget': 'text' }, consent: { 'ui:widget': 'signature' } },
      })
      formId = published.formId

      const customerA = await createCustomerUserFixture(request, adminToken, {
        email: `qa-forms-run034-a-${stamp}@test.local`,
        displayName: `QA RUN034 A ${stamp}`,
      })
      customerAId = customerA.id
      const customerB = await createCustomerUserFixture(request, adminToken, {
        email: `qa-forms-run034-b-${stamp}@test.local`,
        displayName: `QA RUN034 B ${stamp}`,
      })
      customerBId = customerB.id

      const cookiesA = portalCookieHeaders(
        await portalLogin(request, { email: customerA.email, password: customerA.password, tenantId }),
      )
      const cookiesB = portalCookieHeaders(
        await portalLogin(request, { email: customerB.email, password: customerB.password, tenantId }),
      )

      const forgedStart = await portalCall(request, 'POST', '/api/forms/form-submissions', {
        cookies: cookiesA,
        data: { form_key: published.formKey, subject_type: 'customer', subject_id: customerB.id },
      })
      const forgedStartBody = await readJsonSafe<{ error?: string }>(forgedStart)
      expect.soft(
        forgedStart.status(),
        `A starting on B's subject must be 403 (got ${forgedStart.status()}: ${JSON.stringify(forgedStartBody)})`,
      ).toBe(403)
      expect.soft(forgedStartBody?.error).toBe('SUBJECT_FORBIDDEN')
      expect.soft(
        await countSubmissions(published.formId, customerB.id, customerA.id),
        'no submission on B\'s subject is persisted for A',
      ).toBe(0)

      const unsupportedStart = await portalCall(request, 'POST', '/api/forms/form-submissions', {
        cookies: cookiesA,
        data: { form_key: published.formKey, subject_type: 'patient', subject_id: customerA.id },
      })
      expect.soft(unsupportedStart.status(), 'an unsupported subject type must be 403').toBe(403)

      const startedB = await startOwn(request, cookiesB, published.formKey, customerB.id)
      const revisionB = await sign(request, cookiesB, startedB, 'Customer B')
      await submitOwn(request, cookiesB, startedB.submissionId, revisionB)
      await expect
        .poll(() => readActiveConsentSubmissions(request, adminToken!, customerB.id, published.formId), {
          timeout: 30_000,
          message: 'B\'s signed consent is projected as active',
        })
        .toEqual([startedB.submissionId])

      const forgedDraft = await startOwn(request, cookiesA, published.formKey, customerA.id)
      const forgedRevision = await sign(request, cookiesA, forgedDraft, 'Customer A')
      await withClient((client) =>
        client.query('update forms_form_submission set subject_id = $1 where id = $2', [
          customerB.id,
          forgedDraft.submissionId,
        ]),
      )

      const portalForgedSubmit = await portalCall(
        request,
        'POST',
        `/api/forms/form-submissions/${forgedDraft.submissionId}/submit`,
        { cookies: cookiesA, data: { base_revision_id: forgedRevision } },
      )
      expect.soft(portalForgedSubmit.status(), 'portal submit of a forged draft must be 403').toBe(403)
      const publicForgedSubmit = await portalCall(
        request,
        'POST',
        `/api/forms/public/submissions/${forgedDraft.submissionId}/submit`,
        { cookies: cookiesA, data: { base_revision_id: forgedRevision } },
      )
      expect.soft(publicForgedSubmit.status(), 'public submit of a forged draft must be 403').toBe(403)
      expect.soft(await readSubmissionStatus(forgedDraft.submissionId), 'the forged draft stays a draft').toBe('draft')

      const startedA = await startOwn(request, cookiesA, published.formKey, customerA.id)
      const revisionA = await sign(request, cookiesA, startedA, 'Customer A')
      await submitOwn(request, cookiesA, startedA.submissionId, revisionA)
      await expect
        .poll(() => readActiveConsentSubmissions(request, adminToken!, customerA.id, published.formId), {
          timeout: 30_000,
          message: 'A\'s own signed consent is projected under A',
        })
        .toEqual([startedA.submissionId])

      expect(
        await readActiveConsentSubmissions(request, adminToken, customerB.id, published.formId),
        'B keeps exactly its own active consent',
      ).toEqual([startedB.submissionId])

      const staffAssigned = await startOwn(request, cookiesB, published.formKey, customerB.id)
      const assignResponse = await apiRequest(
        request,
        'POST',
        `/api/forms/submissions/${staffAssigned.submissionId}/actors`,
        { token: adminToken, data: { user_id: customerA.id, role: 'participant' } },
      )
      expect(assignResponse.status(), 'staff assign A as an actor on B\'s submission').toBe(201)
      const coActorRevision = await sign(request, cookiesA, staffAssigned, 'Customer A for B')
      const coActorSubmit = await portalCall(
        request,
        'POST',
        `/api/forms/form-submissions/${staffAssigned.submissionId}/submit`,
        { cookies: cookiesA, data: { base_revision_id: coActorRevision } },
      )
      expect(coActorSubmit.status(), 'a staff-assigned co-actor still submits on another subject').toBe(200)
      await expect
        .poll(() => readActiveConsentSubmissions(request, adminToken!, customerB.id, published.formId), {
          timeout: 30_000,
          message: 'the staff-vouched co-actor signature is projected under B',
        })
        .toEqual([staffAssigned.submissionId])
    } finally {
      await deleteFormRuntimeRows(formId).catch(() => undefined)
      await deleteCustomerUserFixture(request, adminToken, customerAId)
      await deleteCustomerUserFixture(request, adminToken, customerBId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
