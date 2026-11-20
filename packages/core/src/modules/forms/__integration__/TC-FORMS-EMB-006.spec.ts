import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createDistributionFixture,
  createPublishedFormFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  patchDistribution,
  readDistribution,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-EMB-006: the embed allowlist cannot be enabled empty or with a
 * non-origin entry.
 *
 * `embedSettingsSchema` refines "enabled ⇒ at least one allowed domain" and
 * validates each entry through the same `normalizeEmbedOrigin` helper the runtime
 * CSP builder uses, so the Zod layer and the emitted `frame-ancestors` agree
 * byte-for-byte. An enabled-but-empty bag would otherwise compile to a
 * `frame-ancestors` with no origins — the kind of config that reads as "embedding
 * is on" while being either useless or, worse, permissive.
 *
 * `http://` is accepted only for localhost, so a plain-http public origin is
 * rejected — that is a downgrade guard, not a style rule.
 */
const REJECTED_SETTINGS: Array<{ label: string; allowedDomains: string[] }> = [
  { label: 'enabled with an empty allowlist', allowedDomains: [] },
  { label: 'a non-https public origin', allowedDomains: ['http://evil.com'] },
  { label: 'an origin carrying a path', allowedDomains: ['https://www.acme.com/embed'] },
  { label: 'a bare hostname with no scheme', allowedDomains: ['www.acme.com'] },
]

test.describe('TC-FORMS-EMB-006: embed settings validation', () => {
  test('rejects an empty or malformed allowlist and accepts a real https origin', async ({ request }) => {
    test.slow()

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const published = await createPublishedFormFixture(request, adminToken, { name: 'QA EMB006' })
      formId = published.formId

      // Every rejected shape must be refused at create time.
      for (const { label, allowedDomains } of REJECTED_SETTINGS) {
        const response = await apiRequest(request, 'POST', `/api/forms/${formId}/distributions`, {
          token: adminToken,
          data: {
            mode: 'open',
            defaultLocale: 'en',
            settings: { embed: { enabled: true, allowedDomains, autoResize: true } },
          },
        })
        const body = await readJsonSafe<{ id?: string; error?: string }>(response)
        expect(
          response.status(),
          `create with ${label} must be a client error (got ${response.status()}: ${JSON.stringify(body)})`,
        ).toBeGreaterThanOrEqual(400)
        expect(response.status(), `create with ${label} must not be a server fault`).toBeLessThan(500)
        expect(body?.id, `create with ${label} must not create a distribution`).toBeFalsy()
      }

      // A real https origin is accepted.
      const distribution = await createDistributionFixture(request, adminToken, formId, {
        mode: 'open',
        settings: {
          embed: { enabled: true, allowedDomains: ['https://www.acme.com'], autoResize: true },
        },
      })
      distributionId = distribution.id

      const detail = await readDistribution(request, adminToken, distributionId)
      const embed = (detail?.settings as Record<string, unknown> | null)?.embed as
        | Record<string, unknown>
        | undefined
      expect(embed?.enabled, 'the accepted settings persisted as enabled').toBe(true)
      expect(embed?.allowedDomains, 'the accepted origin persisted').toEqual(['https://www.acme.com'])

      // The same validation applies on update, not only on create.
      const badPatch = await patchDistribution(request, adminToken, distributionId, {
        settings: { embed: { enabled: true, allowedDomains: [], autoResize: true } },
      })
      const badPatchBody = await readJsonSafe<{ error?: string }>(badPatch)
      expect(
        badPatch.status(),
        `patching to an empty allowlist must be a client error (got ${badPatch.status()}: ${JSON.stringify(badPatchBody)})`,
      ).toBeGreaterThanOrEqual(400)
      expect(badPatch.status(), 'patching to an empty allowlist must not be a server fault').toBeLessThan(500)

      const afterBadPatch = await readDistribution(request, adminToken, distributionId)
      const embedAfter = (afterBadPatch?.settings as Record<string, unknown> | null)?.embed as
        | Record<string, unknown>
        | undefined
      expect(
        embedAfter?.allowedDomains,
        'the rejected patch left the stored allowlist untouched',
      ).toEqual(['https://www.acme.com'])

      // Disabling embedding without an allowlist is legal — the refine only
      // guards the enabled case.
      const disable = await patchDistribution(request, adminToken, distributionId, {
        settings: { embed: { enabled: false, allowedDomains: [], autoResize: true } },
      })
      expect(disable.status(), 'disabling embedding with an empty allowlist is allowed').toBe(200)
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
