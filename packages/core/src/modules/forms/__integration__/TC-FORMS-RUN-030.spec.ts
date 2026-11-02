import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createPublishedFormFixture,
  deleteFormIfExists,
  portalCall,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-RUN-030: the portal (customer-session) runtime happy path.
 *
 * This is the second of the module's two runtime surfaces and it authorizes
 * differently from the anonymous one: there is no access token, the portal
 * session identifies the customer, and `POST /api/form-submissions` auto-assigns
 * the starter to the version's `x-om-default-actor-role`. That actor row is what
 * `SubmissionService.save()` requires — no actor means `403 NO_ACTOR`, not 401.
 *
 * The unauthenticated variants close the loop: every one of these routes is
 * `requireAuth: false` at the platform layer and enforces customer auth
 * internally, so a missing session must be 401 rather than an unguarded 200.
 */
test.describe('TC-FORMS-RUN-030: portal runtime happy path', () => {
  test('resolves by key, starts, autosaves and submits with a customer session', async ({ request }) => {
    test.setTimeout(150_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    let adminToken: string | null = null
    let formId: string | null = null
    let customerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)

      const published = await createPublishedFormFixture(request, adminToken, { name: `QA RUN030 ${stamp}` })
      formId = published.formId

      const customer = await createCustomerUserFixture(request, adminToken, {
        email: `qa-forms-run030-${stamp}@test.local`,
        displayName: `QA RUN030 ${stamp}`,
      })
      customerId = customer.id

      const session = await portalLogin(request, {
        email: customer.email,
        password: customer.password,
        tenantId,
      })
      const cookies = portalCookieHeaders(session)

      const activeRes = await portalCall(
        request,
        'GET',
        `/api/forms/by-key/${encodeURIComponent(published.formKey)}/active`,
        { cookies },
      )
      const active = await readJsonSafe<{
        form?: { id?: string; key?: string }
        formVersion?: { id?: string; versionNumber?: number; roles?: string[] }
        fieldIndex?: Record<string, unknown>
        callerRoles?: string[]
      }>(activeRes)
      expect(
        activeRes.status(),
        `by-key/active should return 200 for a portal session (got ${activeRes.status()}: ${JSON.stringify(active)})`,
      ).toBe(200)
      expect(active?.form?.key, 'the active read names the form key').toBe(published.formKey)
      expect(active?.formVersion?.id, 'the active read serves the published version').toBe(published.versionId)
      expect(active?.formVersion?.versionNumber).toBe(1)
      expect(Array.isArray(active?.callerRoles), 'the active read reports the caller roles it sliced by').toBe(true)

      const startRes = await portalCall(request, 'POST', '/api/forms/form-submissions', {
        cookies,
        data: {
          form_key: published.formKey,
          subject_type: 'customer',
          subject_id: customer.id,
        },
      })
      const started = await readJsonSafe<{
        submission?: { id?: string; status?: string; currentRevisionId?: string; subjectType?: string }
        revision?: { id?: string; revisionNumber?: number }
        actors?: Array<{ userId?: string; role?: string }>
      }>(startRes)
      expect(
        startRes.status(),
        `portal start should return 201 (got ${startRes.status()}: ${JSON.stringify(started)})`,
      ).toBe(201)
      const submissionId = started!.submission!.id as string
      const revisionId = started!.revision!.id as string
      expect(started?.submission?.status, 'a portal start opens a draft').toBe('draft')
      expect(started?.submission?.subjectType, 'the subject type is echoed').toBe('customer')
      expect(started?.revision?.revisionNumber, 'the portal start writes revision 1').toBe(1)
      // The auto-assigned actor is the authorization the save path requires.
      const actor = (started?.actors ?? []).find((entry) => entry.userId === customer.id)
      expect(actor, 'the starter is auto-assigned as an actor').toBeTruthy()
      expect(actor?.role, 'the actor takes the schema default actor role').toBe('participant')

      await waitForAutosaveWindow()
      const saveRes = await portalCall(request, 'PATCH', `/api/forms/form-submissions/${submissionId}`, {
        cookies,
        data: { base_revision_id: revisionId, patch: { full_name: 'Portal Pat' } },
      })
      const saved = await readJsonSafe<{ revision?: { id?: string; revisionNumber?: number } }>(saveRes)
      expect(
        saveRes.status(),
        `portal autosave should return 200 (got ${saveRes.status()}: ${JSON.stringify(saved)})`,
      ).toBe(200)
      expect(saved?.revision?.revisionNumber, 'the portal autosave appends revision 2').toBe(2)
      const secondRevisionId = saved!.revision!.id as string

      const submitRes = await portalCall(
        request,
        'POST',
        `/api/forms/form-submissions/${submissionId}/submit`,
        { cookies, data: { base_revision_id: secondRevisionId } },
      )
      const submitted = await readJsonSafe<{ submission?: { status?: string; submittedBy?: string } }>(submitRes)
      expect(
        submitRes.status(),
        `portal submit should return 200 (got ${submitRes.status()}: ${JSON.stringify(submitted)})`,
      ).toBe(200)
      expect(submitted?.submission?.status, 'the portal submit finalizes the submission').toBe('submitted')
      expect(submitted?.submission?.submittedBy, 'the customer is recorded as the submitter').toBe(customer.id)

      const readRes = await portalCall(request, 'GET', `/api/forms/form-submissions/${submissionId}`, {
        cookies,
      })
      expect(readRes.status(), 'the customer can resume-read their own submission').toBe(200)
      const view = await readJsonSafe<{ decoded_data?: Record<string, unknown> }>(readRes)
      expect(view?.decoded_data?.full_name, 'the saved answer is role-visible to the participant').toBe('Portal Pat')

      // No session ⇒ 401 on every portal runtime route. Issued from a context
      // that never saw a login, so a replayed cookie cannot fake the pass.
      await withCredentialIsolatedRequest(async (anonymous) => {
        const routes: Array<{ method: string; path: string; data?: unknown }> = [
          { method: 'GET', path: `/api/forms/by-key/${encodeURIComponent(published.formKey)}/active` },
          {
            method: 'POST',
            path: '/api/forms/form-submissions',
            data: { form_key: published.formKey, subject_type: 'customer', subject_id: customer.id },
          },
          { method: 'GET', path: `/api/forms/form-submissions/${submissionId}` },
          {
            method: 'PATCH',
            path: `/api/forms/form-submissions/${submissionId}`,
            data: { base_revision_id: secondRevisionId, patch: { full_name: 'anonymous' } },
          },
          {
            method: 'POST',
            path: `/api/forms/form-submissions/${submissionId}/submit`,
            data: { base_revision_id: secondRevisionId },
          },
        ]
        for (const route of routes) {
          const response = await anonymous.fetch(route.path, {
            method: route.method,
            headers: { 'Content-Type': 'application/json' },
            data: route.data,
          })
          expect(
            response.status(),
            `${route.method} ${route.path} must be 401 without a portal session (got ${response.status()})`,
          ).toBe(401)
        }
      })
    } finally {
      await deleteCustomerUserFixture(request, adminToken, customerId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
