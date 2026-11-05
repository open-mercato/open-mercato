import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-045D-001a — Communication Channels hub module loads and registers its ACL features.
 *
 * SPEC-045d Phase 1 (slice 2a) acceptance: after the hub module ships, its 4 ACL features
 * (`communication_channels.view/.manage/.react/.assign`) MUST be visible in the
 * platform's feature manifest and grantable to roles.
 *
 * The features are sourced from `packages/core/src/modules/communication_channels/acl.ts`
 * and made available to the auth registry via the module generator. This test asserts
 * the runtime endpoint that lists available features (used by the role-edit page)
 * surfaces all 4 hub features.
 */
test.describe('TC-045D-001a: Communication Channels module load + ACL features', () => {
  test('lists all 4 hub features via the platform feature registry', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await apiRequest(request, 'GET', '/api/auth/features', { token })
    expect(response.status(), 'GET /api/auth/features should return 200').toBe(200)

    const body = await readJsonSafe<{ items?: Array<{ id: string; module?: string }> }>(response)
    const ids = (body?.items ?? []).map((f) => f.id)

    expect(ids).toContain('communication_channels.view')
    expect(ids).toContain('communication_channels.manage')
    expect(ids).toContain('communication_channels.react')
    expect(ids).toContain('communication_channels.assign')

    // Every hub feature reports `module === 'communication_channels'`
    const hubFeatures = (body?.items ?? []).filter((f) => f.id.startsWith('communication_channels.'))
    for (const feature of hubFeatures) {
      expect(feature.module).toBe('communication_channels')
    }
  })
})
