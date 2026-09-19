/** @jest-environment node */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  salesTaxProviderSettingsSchema,
  TAX_PROVIDER_TIMEOUT_MAX_MS,
  TAX_PROVIDER_TIMEOUT_MIN_MS,
} from '../../data/validators'
import { registerTaxProvider } from '../../lib/providers/registry'
import type { TaxProvider } from '../../lib/providers/types'

const apiDir = join(__dirname, '..')
const providersRoute = readFileSync(join(apiDir, 'tax-providers', 'route.ts'), 'utf8')
const settingsRoute = readFileSync(join(apiDir, 'settings', 'tax-provider', 'route.ts'), 'utf8')
const settingsCommand = readFileSync(join(apiDir, '..', 'commands', 'settings.ts'), 'utf8')

const scope = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
}

describe('salesTaxProviderSettingsSchema', () => {
  it('accepts a selection with options, a ship from address and a timeout', () => {
    const parsed = salesTaxProviderSettingsSchema.safeParse({
      ...scope,
      providerKey: 'external-tax',
      providerSettings: { rate: 5, jurisdictionName: 'State' },
      shipFromAddress: { addressLine1: 'One Market St', city: 'San Francisco', country: 'US' },
      timeoutMs: 5000,
    })
    expect(parsed.success).toBe(true)
  })

  it('requires a provider key', () => {
    expect(salesTaxProviderSettingsSchema.safeParse({ ...scope }).success).toBe(false)
    expect(
      salesTaxProviderSettingsSchema.safeParse({ ...scope, providerKey: '   ' }).success
    ).toBe(false)
  })

  it('bounds the timeout so a provider cannot hold a write open indefinitely', () => {
    expect(
      salesTaxProviderSettingsSchema.safeParse({ ...scope, providerKey: 'external-tax', timeoutMs: 1 })
        .success
    ).toBe(false)
    expect(
      salesTaxProviderSettingsSchema.safeParse({
        ...scope,
        providerKey: 'external-tax',
        timeoutMs: TAX_PROVIDER_TIMEOUT_MAX_MS + 1,
      }).success
    ).toBe(false)
    for (const value of [TAX_PROVIDER_TIMEOUT_MIN_MS, TAX_PROVIDER_TIMEOUT_MAX_MS]) {
      expect(
        salesTaxProviderSettingsSchema.safeParse({ ...scope, providerKey: 'external-tax', timeoutMs: value })
          .success
      ).toBe(true)
    }
  })

  it('allows clearing the ship from address and the timeout', () => {
    const parsed = salesTaxProviderSettingsSchema.safeParse({
      ...scope,
      providerKey: 'table-rates',
      shipFromAddress: null,
      timeoutMs: null,
    })
    expect(parsed.success).toBe(true)
  })
})

describe('GET /api/sales/tax-providers', () => {
  it('is readable with the view feature only', () => {
    expect(providersRoute).toContain("GET: { requireAuth: true, requireFeatures: ['sales.settings.view'] }")
  })

  it('returns field definitions and filters out any secret field', () => {
    expect(providersRoute).toContain("fields: (provider.settings?.fields ?? []).filter((field) => field.type !== 'secret')")
  })

  it('never serializes a configured value or a credential', () => {
    // Match code, not prose: the OpenAPI descriptions legitimately mention both.
    expect(providersRoute).not.toMatch(/providerSettings\s*[:,)]/)
    expect(providersRoute).not.toMatch(/\bcredentials\s*[:,)]/)
    expect(providersRoute).not.toContain('resolveCredentials')
  })

  it('exports openApi', () => {
    expect(providersRoute).toContain('export const openApi')
  })
})

describe('GET|PUT /api/sales/settings/tax-provider', () => {
  it('requires the manage feature on both methods', () => {
    expect(settingsRoute).toContain("GET: { requireAuth: true, requireFeatures: ['sales.settings.manage'] }")
    expect(settingsRoute).toContain("PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] }")
  })

  it('reports the built in default when the column is NULL', () => {
    const occurrences = settingsRoute.match(/record\?\.taxProviderKey \?\? DEFAULT_TAX_PROVIDER_KEY/g) ?? []
    expect(occurrences.length).toBe(2)
  })

  it('falls back to the instance timeout when the organization set none', () => {
    const occurrences = settingsRoute.match(/record\?\.taxProviderTimeoutMs \?\? resolveDefaultTaxProviderTimeout\(\)/g) ?? []
    expect(occurrences.length).toBe(2)
  })

  it('runs the mutation guard before executing the command', () => {
    expect(settingsRoute).toContain('validateCrudMutationGuard')
    expect(settingsRoute).toContain("resourceKind: 'sales.settings'")
    expect(settingsRoute.indexOf('validateCrudMutationGuard')).toBeLessThan(
      settingsRoute.indexOf("commandBus.execute('sales.settings.save_tax_provider'")
    )
  })

  it('scopes the payload and exports openApi', () => {
    expect(settingsRoute).toContain('withScopedPayload')
    expect(settingsRoute).toContain('export const openApi')
  })

  it('never returns a credential on either method', () => {
    // Match code, not prose: the OpenAPI descriptions legitimately mention it.
    expect(settingsRoute).not.toMatch(/\bcredentials\s*[:,)]/)
    expect(settingsRoute).not.toContain('resolveCredentials')
    // The GET and PUT bodies are the same five keys, none of them a secret.
    const bodyKeys = settingsRoute.match(/providerKey: record\?\.taxProviderKey/g) ?? []
    expect(bodyKeys.length).toBe(2)
  })

  it('filters secret fields out of the provider catalog it embeds', () => {
    expect(settingsRoute).toContain("filter((field) => field.type !== 'secret')")
  })
})

describe('the save command refuses what the route must not accept', () => {
  it('rejects an unregistered provider rather than degrading every later calculation', () => {
    expect(settingsCommand).toContain("code: 'sales.tax_provider_unknown'")
    expect(settingsCommand).toContain('const provider = getTaxProvider(input.providerKey)')
  })

  it('rejects a settings key the provider declared as a secret', () => {
    expect(settingsCommand).toContain("code: 'sales.tax_provider_secret_field'")
    expect(settingsCommand).toContain("filter((field) => field.type === 'secret')")
  })

  it('invalidates the selection cache after the write, never inside it', () => {
    const execute = settingsCommand.slice(
      settingsCommand.indexOf("id: 'sales.settings.save_tax_provider'"),
      settingsCommand.indexOf('buildLog: async ({ snapshots, input })')
    )
    expect(execute.indexOf('await em.flush()')).toBeLessThan(
      execute.indexOf('invalidateTaxProviderSelection')
    )
  })
})

describe('registerTaxProvider drops secret fields before they can be stored', () => {
  it('strips a secret field from a registered provider', () => {
    const provider: TaxProvider = {
      key: 'secret-declaring',
      label: 'Secret declaring',
      settings: {
        fields: [
          { key: 'accountId', label: 'Account id', type: 'text' },
          { key: 'licenseKey', label: 'License key', type: 'secret' },
        ],
        schema: z.object({ accountId: z.string().optional() }),
      },
      calculate: async () => null,
    }
    const unregister = registerTaxProvider(provider)
    try {
      const { getTaxProvider } = jest.requireActual('../../lib/providers/registry') as typeof import('../../lib/providers/registry')
      const registered = getTaxProvider('secret-declaring')
      const keys = (registered?.settings?.fields ?? []).map((field) => field.key)
      expect(keys).toEqual(['accountId'])
    } finally {
      unregister()
    }
  })
})
