import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAnonymousRunFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  publicAutosave,
  readSubmissionDetail,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-SUB-002: the admin submission detail decrypts the answers for the
 * owning organization's staff and is tenant-scoped against everyone else.
 *
 * The admin read is the one place a submission's plaintext answers leave the
 * database, so both halves are load-bearing: an in-scope admin must get the
 * decrypted values (otherwise the inbox is useless), and an out-of-scope one must
 * get a 404 indistinguishable from a nonexistent id (otherwise the id space is
 * enumerable across organizations).
 *
 * The foreign reader is a SECOND USER whose home organization is the other org,
 * not the same admin carrying an `om_selected_org` cookie. That distinction cost
 * a wrong first draft and is worth recording: unlike `/api/forms/:id`, the
 * `/api/forms/submissions/*` routes call `getAuthFromRequest` and scope directly
 * on `auth.orgId` — they never consult `resolveOrganizationScopeForRequest`, so
 * the selected-organization cookie is ignored. Scoping on the JWT rather than a
 * cookie is the safer design (a cookie cannot widen it), but it means a
 * cookie-based "cross-org" probe silently tests nothing and passes.
 *
 * ENVIRONMENT: mixes API and DB fixtures — needs the standard harness where the
 * app and the fixtures share a database.
 */
test.describe('TC-FORMS-SUB-002: admin submission detail', () => {
  test('decrypts answers for the owning organization and 404s for another', async ({ request }) => {
    test.setTimeout(180_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const answer = `QA SUB002 answer ${stamp}`
    const foreignEmail = `qa-forms-sub002-${stamp}@test.local`
    const foreignPassword = `Password${stamp}!`

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null
    let otherOrgId: string | null = null
    let foreignRoleId: string | null = null
    let foreignUserId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId, organizationId } = getTokenContext(adminToken)

      await withCredentialIsolatedRequest(async (anonymous) => {
        const run = await createAnonymousRunFixture(request, anonymous, adminToken as string)
        formId = run.formId
        distributionId = run.distributionId

        await waitForAutosaveWindow()
        const saveRes = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          baseRevisionId: run.revisionId,
          patch: { full_name: answer },
          clientIp: run.clientIp,
        })
        expect(saveRes.status(), 'the participant autosave should succeed').toBe(200)
        const saved = await readJsonSafe<{ revision?: { id?: string } }>(saveRes)
        const revisionId = saved!.revision!.id as string

        const detailRes = await readSubmissionDetail(request, adminToken as string, run.submissionId)
        const detail = await readJsonSafe<{
          submission?: {
            id?: string
            organizationId?: string
            status?: string
            currentRevisionId?: string
            updatedAt?: string
          }
          revision?: { id?: string; revisionNumber?: number }
          decoded_data?: Record<string, unknown>
          actors?: Array<{ role?: string }>
          formVersion?: { id?: string; versionNumber?: number; roles?: string[] }
        }>(detailRes)
        expect(
          detailRes.status(),
          `the owning admin should read the submission (got ${detailRes.status()}: ${JSON.stringify(detail)})`,
        ).toBe(200)
        expect(detail?.submission?.id).toBe(run.submissionId)
        expect(detail?.submission?.organizationId, 'the submission belongs to the caller organization').toBe(
          organizationId,
        )
        expect(detail?.submission?.status, 'the submission is still a draft').toBe('draft')
        expect(detail?.submission?.currentRevisionId, 'the detail points at the latest revision').toBe(revisionId)
        expect(detail?.submission?.updatedAt, 'the detail carries updatedAt').toBeTruthy()
        expect(detail?.revision?.revisionNumber, 'the detail serves revision 2').toBe(2)
        expect(detail?.formVersion?.id, 'the detail names the pinned form version').toBe(run.versionId)
        expect(detail?.formVersion?.roles, 'the detail lists the version roles').toContain('participant')
        expect(
          (detail?.actors ?? []).some((actor) => actor.role === 'participant'),
          'the detail lists the participant actor',
        ).toBe(true)
        // The admin read is the decryption boundary — the plaintext must be here.
        expect(detail?.decoded_data?.full_name, 'the admin read decrypts the answer').toBe(answer)

        // A staff user whose HOME organization is a different one in the same
        // tenant, holding every forms feature, must still not reach it.
        otherOrgId = await createOrganizationInDb({ name: `QA SUB002 Org ${stamp}`, tenantId })
        foreignRoleId = await createRoleFixture(request, adminToken as string, {
          name: `QA SUB002 Foreign Forms ${stamp}`,
        })
        await setRoleAclFeatures(request, adminToken as string, {
          roleId: foreignRoleId,
          features: ['forms.view', 'forms.submissions.export'],
        })
        foreignUserId = await createUserFixture(request, adminToken as string, {
          email: foreignEmail,
          password: foreignPassword,
          organizationId: otherOrgId,
          roles: [foreignRoleId],
        })
        const foreignToken = await getAuthToken(request, foreignEmail, foreignPassword)

        const crossOrg = await readSubmissionDetail(request, foreignToken, run.submissionId)
        expect(
          crossOrg.status(),
          `a cross-organization submission read must be 404 (got ${crossOrg.status()})`,
        ).toBe(404)
        const crossBody = await readJsonSafe<{ error?: string; decoded_data?: unknown }>(crossOrg)
        expect(crossBody?.decoded_data, 'the 404 must not leak any answer payload').toBeUndefined()
        expect(
          JSON.stringify(crossBody ?? {}),
          'the 404 body must not contain the answer',
        ).not.toContain(answer)

        // Indistinguishable from an id that does not exist.
        const missing = await readSubmissionDetail(request, foreignToken, randomUUID())
        expect(missing.status(), 'a nonexistent submission id answers the same status').toBe(crossOrg.status())
        expect(await readJsonSafe(missing), 'a nonexistent id answers the same body').toEqual(crossBody)

        // The sibling sub-routes are scoped the same way — a single leaky one
        // would be enough to read the data another way.
        for (const suffix of ['/revisions', '/export', '/access-audit']) {
          const response = await apiRequest(
            request,
            'GET',
            `/api/forms/submissions/${run.submissionId}${suffix}`,
            { token: foreignToken },
          )
          expect(
            response.status(),
            `${suffix} must also be 404 for a foreign organization (got ${response.status()})`,
          ).toBe(404)
          expect(
            await response.text(),
            `${suffix} must not leak the answer`,
          ).not.toContain(answer)
        }

        // And the unauthenticated case, from a jar that never saw a login.
        const anonymousRead = await anonymous.get(`/api/forms/submissions/${run.submissionId}`)
        expect(anonymousRead.status(), 'the admin detail route rejects an anonymous caller').toBe(401)
      })

      // Sanity: the in-scope read still works after the denials, proving they
      // were about scope and not a poisoned session.
      const reread = await apiRequest(request, 'GET', `/api/forms/${formId}/submissions`, {
        token: adminToken,
      })
      expect(reread.status(), 'the owning admin is unaffected by the denied reads').toBe(200)
    } finally {
      await deleteUserIfExists(request, adminToken, foreignUserId)
      await deleteRoleIfExists(request, adminToken, foreignRoleId)
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
      await deleteOrganizationInDb(otherOrgId).catch(() => undefined)
    }
  })
})
