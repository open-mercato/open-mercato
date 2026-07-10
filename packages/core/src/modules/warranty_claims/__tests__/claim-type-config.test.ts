import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertDispositionAllowedForType, resolveClaimTypeUiConfig } from '../lib/claimTypeConfig'

describe('resolveClaimTypeUiConfig', () => {
  it('falls back to the warranty config for unknown types', () => {
    expect(resolveClaimTypeUiConfig('unknown')).toBe(resolveClaimTypeUiConfig('warranty'))
    expect(resolveClaimTypeUiConfig(null)).toBe(resolveClaimTypeUiConfig('warranty'))
  })
})

describe('assertDispositionAllowedForType', () => {
  it('accepts dispositions from the claim type policy and empty values', () => {
    expect(() => assertDispositionAllowedForType('return', 'restock')).not.toThrow()
    expect(() => assertDispositionAllowedForType('warranty', 'return_to_vendor')).not.toThrow()
    expect(() => assertDispositionAllowedForType('vendor_recovery', 'return_to_vendor')).not.toThrow()
    expect(() => assertDispositionAllowedForType('return', null)).not.toThrow()
    expect(() => assertDispositionAllowedForType('return', undefined)).not.toThrow()
  })

  it('rejects dispositions outside the claim type policy with the i18n error', () => {
    for (const [claimType, disposition] of [
      ['return', 'return_to_vendor'],
      ['return', 'scrap'],
      ['return', 'field_destroy'],
      ['vendor_recovery', 'restock'],
    ] as const) {
      try {
        assertDispositionAllowedForType(claimType, disposition)
        throw new Error(`[internal] expected ${claimType}/${disposition} to be rejected`)
      } catch (err) {
        expect(err).toBeInstanceOf(CrudHttpError)
        expect((err as CrudHttpError).body).toEqual({ error: 'warranty_claims.errors.dispositionTypeConflict' })
        expect((err as CrudHttpError).status).toBe(400)
      }
    }
  })
})
