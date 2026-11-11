/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  isOptionalCustomersPeerAbsentError,
  requireVendorIfPresent,
} from '../asnVendor'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const VENDOR = '33333333-3333-4333-8333-333333333333'

describe('isOptionalCustomersPeerAbsentError', () => {
  it('recognizes Awilix resolution failures', () => {
    const error = Object.assign(new Error("Could not resolve 'queryEngine'"), {
      name: 'AwilixResolutionError',
    })
    expect(isOptionalCustomersPeerAbsentError(error)).toBe(true)
  })

  it('recognizes unknown-entity registration failures', () => {
    expect(
      isOptionalCustomersPeerAbsentError(new Error('Unknown entity customers:customer_entity')),
    ).toBe(true)
    expect(
      isOptionalCustomersPeerAbsentError(
        new Error('entity id customers:customer_entity is not registered'),
      ),
    ).toBe(true)
  })

  it('does not treat transient/query failures as peer-absent', () => {
    expect(isOptionalCustomersPeerAbsentError(new Error('connection timed out'))).toBe(false)
    expect(isOptionalCustomersPeerAbsentError(new Error('relation "customers_entities" does not exist'))).toBe(
      false,
    )
    expect(isOptionalCustomersPeerAbsentError(null)).toBe(false)
  })
})

describe('requireVendorIfPresent', () => {
  const scope = { tenantId: TENANT, organizationId: ORG }

  it('no-ops when vendorId is absent', async () => {
    const resolve = jest.fn()
    await expect(requireVendorIfPresent({ resolve }, null, scope)).resolves.toBeUndefined()
    await expect(requireVendorIfPresent({ resolve }, undefined, scope)).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('accepts a vendor that query engine returns', async () => {
    const query = jest.fn(async () => ({ items: [{ id: VENDOR }] }))
    await expect(
      requireVendorIfPresent({ resolve: () => ({ query }) }, VENDOR, scope),
    ).resolves.toBeUndefined()
    expect(query).toHaveBeenCalled()
  })

  it('rejects missing vendor with 422 invalid_vendor', async () => {
    const query = jest.fn(async () => ({ items: [] }))
    await expect(
      requireVendorIfPresent({ resolve: () => ({ query }) }, VENDOR, scope),
    ).rejects.toMatchObject({ status: 422, body: { error: 'invalid_vendor' } })
  })

  it('degrades when customers peer / queryEngine is absent', async () => {
    const error = Object.assign(new Error("Could not resolve 'queryEngine'"), {
      name: 'AwilixResolutionError',
    })
    await expect(
      requireVendorIfPresent(
        {
          resolve: () => {
            throw error
          },
        },
        VENDOR,
        scope,
      ),
    ).resolves.toBeUndefined()
  })

  it('maps transient query failures to 503 vendor_lookup_unavailable', async () => {
    const query = jest.fn(async () => {
      throw new Error('connection timed out')
    })
    try {
      await requireVendorIfPresent({ resolve: () => ({ query }) }, VENDOR, scope)
      throw new Error('expected reject')
    } catch (error) {
      expect(error).toBeInstanceOf(CrudHttpError)
      expect((error as CrudHttpError).status).toBe(503)
      expect((error as CrudHttpError).body).toMatchObject({ error: 'vendor_lookup_unavailable' })
    }
  })

  it('re-throws CrudHttpError from the query path unchanged', async () => {
    const query = jest.fn(async () => {
      throw new CrudHttpError(422, { error: 'invalid_vendor' })
    })
    await expect(
      requireVendorIfPresent({ resolve: () => ({ query }) }, VENDOR, scope),
    ).rejects.toMatchObject({ status: 422, body: { error: 'invalid_vendor' } })
  })
})
