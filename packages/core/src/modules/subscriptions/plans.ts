import { z } from 'zod'

export type SubscriptionPlanProvider = 'stripe'
export type SubscriptionPlanIntervalManifest = 'month' | 'year'

export type SubscriptionPriceManifest = {
  code: string
  providerKey: SubscriptionPlanProvider
  currencyCode: string
  interval: SubscriptionPlanIntervalManifest
  intervalCount: number
  unitAmountMinor: number
  trialDays?: number | null
  isDefault?: boolean
  isActive?: boolean
  stripe: {
    productLookupKey: string
    priceLookupKey: string
    taxBehavior?: 'inclusive' | 'exclusive' | 'unspecified'
  }
}

export type SubscriptionPlanManifest = {
  code: string
  productCode: string
  title: string
  description?: string | null
  isActive?: boolean
  entitlements?: Record<string, unknown>
  prices: SubscriptionPriceManifest[]
}

export const subscriptionPriceManifestSchema = z.object({
  code: z.string().min(1).max(128),
  providerKey: z.literal('stripe'),
  currencyCode: z.string().min(1).max(16),
  interval: z.enum(['month', 'year']),
  intervalCount: z.number().int().positive(),
  unitAmountMinor: z.number().int().nonnegative(),
  trialDays: z.number().int().nonnegative().nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  stripe: z.object({
    productLookupKey: z.string().min(1).max(255),
    priceLookupKey: z.string().min(1).max(255),
    taxBehavior: z.enum(['inclusive', 'exclusive', 'unspecified']).optional(),
  }),
})

export const subscriptionPlanManifestSchema = z.object({
  code: z.string().min(1).max(128),
  productCode: z.string().min(1).max(128),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  entitlements: z.record(z.string(), z.unknown()).optional(),
  prices: z.array(subscriptionPriceManifestSchema).min(1),
})

export const subscriptionPlansManifestSchema = z.array(subscriptionPlanManifestSchema)

export const subscriptionPlans: SubscriptionPlanManifest[] = [
  {
    code: 'starter',
    productCode: 'external-app',
    title: 'Starter',
    description: 'Basic plan for small teams getting started.',
    isActive: true,
    entitlements: {
      projectsLimit: 5,
      aiEnabled: false,
    },
    prices: [
      {
        code: 'starter-monthly-v1',
        providerKey: 'stripe',
        currencyCode: 'USD',
        interval: 'month',
        intervalCount: 1,
        unitAmountMinor: 1900,
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
  {
    code: 'growth',
    productCode: 'external-app',
    title: 'Growth',
    description: 'Higher entitlements and AI features enabled.',
    isActive: true,
    entitlements: {
      projectsLimit: 50,
      aiEnabled: true,
    },
    prices: [
      {
        code: 'growth-monthly-v1',
        providerKey: 'stripe',
        currencyCode: 'USD',
        interval: 'month',
        intervalCount: 1,
        unitAmountMinor: 4900,
        trialDays: 14,
        isDefault: true,
        isActive: true,
        stripe: {
          productLookupKey: 'external-app-growth',
          priceLookupKey: 'external-app-growth-monthly-v1',
          taxBehavior: 'exclusive',
        },
      },
    ],
  },
]
