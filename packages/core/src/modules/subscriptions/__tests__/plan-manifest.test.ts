import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveSubscriptionPlanManifest } from '../lib/plan-manifest'

describe('resolveSubscriptionPlanManifest', () => {
  const originalEnv = process.env.OM_SUBSCRIPTIONS_PLANS_FILE

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OM_SUBSCRIPTIONS_PLANS_FILE
    } else {
      process.env.OM_SUBSCRIPTIONS_PLANS_FILE = originalEnv
    }
  })

  it('falls back to the built-in manifest when no path is configured', async () => {
    delete process.env.OM_SUBSCRIPTIONS_PLANS_FILE

    const resolved = await resolveSubscriptionPlanManifest()

    expect(resolved.source).toBe('builtin')
    expect(resolved.manifestPath).toBeNull()
    expect(resolved.manifest.length).toBeGreaterThan(0)
  })

  it('loads a manifest from an explicit file path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subscription-manifest-'))
    const manifestPath = path.join(tempDir, 'plans.cjs')
    await fs.writeFile(
      manifestPath,
      `module.exports = {
        subscriptionPlans: [
        {
          code: 'custom',
          productCode: 'external-app',
          title: 'Custom',
          prices: [
            {
              code: 'custom-monthly-v1',
              providerKey: 'stripe',
              currencyCode: 'USD',
              interval: 'month',
              intervalCount: 1,
              unitAmountMinor: 2500,
              stripe: {
                productLookupKey: 'custom-product',
                priceLookupKey: 'custom-price'
              }
            }
          ]
        }
      ]
      }
      `,
      'utf8',
    )

    const resolved = await resolveSubscriptionPlanManifest({ manifestPath })

    expect(resolved.source).toBe('file')
    expect(resolved.manifestPath).toBe(manifestPath)
    expect(resolved.manifest).toEqual([
      expect.objectContaining({
        code: 'custom',
        title: 'Custom',
      }),
    ])
  })

  it('uses the environment-configured manifest path when no explicit path is provided', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subscription-manifest-env-'))
    const manifestPath = path.join(tempDir, 'plans.json')
    await fs.writeFile(
      manifestPath,
      JSON.stringify([
        {
          code: 'env-plan',
          productCode: 'external-app',
          title: 'Env Plan',
          prices: [
            {
              code: 'env-plan-monthly-v1',
              providerKey: 'stripe',
              currencyCode: 'USD',
              interval: 'month',
              intervalCount: 1,
              unitAmountMinor: 3100,
              stripe: {
                productLookupKey: 'env-product',
                priceLookupKey: 'env-price',
              },
            },
          ],
        },
      ]),
      'utf8',
    )
    process.env.OM_SUBSCRIPTIONS_PLANS_FILE = manifestPath

    const resolved = await resolveSubscriptionPlanManifest()

    expect(resolved.source).toBe('file')
    expect(resolved.manifestPath).toBe(manifestPath)
    expect(resolved.manifest[0]?.code).toBe('env-plan')
  })
})
