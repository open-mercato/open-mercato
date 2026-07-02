import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  runMercatoCommandExpectFailure,
  syncPlans,
} from './helpers/fixtures'

test.describe('TC-SUB-014: versioned price economics guard', () => {
  test('rejects a plan economic mutation without a new versioned price code', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request)
    const { tenantId, organizationId } = getTokenContext(token)
    await syncPlans(request, token)

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-sub-014-'))
    const manifestPath = path.join(tempDir, 'plans.json')
    await fs.writeFile(
      manifestPath,
      JSON.stringify([
        {
          code: 'starter',
          productCode: 'external-app',
          title: 'Starter',
          description: 'Mutated starter plan for guard coverage.',
          entitlements: { projectsLimit: 5, aiEnabled: false },
          prices: [
            {
              code: 'starter-monthly-v1',
              providerKey: 'stripe',
              currencyCode: 'USD',
              interval: 'month',
              intervalCount: 1,
              unitAmountMinor: 2900,
              trialDays: 14,
              isDefault: true,
              isActive: true,
              stripe: {
                productLookupKey: 'external-app-starter',
                priceLookupKey: 'external-app-starter-monthly-v1',
                taxBehavior: 'exclusive',
              },
            },
          ],
        },
      ]),
      'utf8',
    )

    const failure = await runMercatoCommandExpectFailure([
      'subscriptions',
      'sync-plans',
      '--tenant',
      tenantId,
      '--org',
      organizationId,
      '--manifest',
      manifestPath,
    ])
    const output = `${failure.stdout}\n${failure.stderr}\n${failure.message}`
    expect(output).toContain('economic change')
  })
})
