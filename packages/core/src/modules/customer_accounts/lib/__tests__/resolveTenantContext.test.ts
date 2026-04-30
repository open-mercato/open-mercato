/** @jest-environment node */

import { resolveTenantContext, TenantResolutionError } from '../resolveTenantContext'

const PLATFORM_TENANT = '11111111-1111-1111-1111-111111111111'
const HOST_TENANT = '22222222-2222-2222-2222-222222222222'
const HOST_ORG = '33333333-3333-3333-3333-333333333333'

function makeContainer(resolveFn: ((hostname: string) => Promise<unknown>) | null) {
  return {
    resolve(name: string) {
      if (name === 'domainMappingService') {
        if (!resolveFn) throw new Error('not registered')
        return {
          resolveByHostname: resolveFn,
        }
      }
      throw new Error(`unexpected resolve(${name})`)
    },
  } as never
}

function makeReq(host: string): Request {
  return new Request('http://example.com/api/customer_accounts/login', {
    method: 'POST',
    headers: { host },
  })
}

describe('resolveTenantContext', () => {
  beforeEach(() => {
    process.env.PLATFORM_DOMAINS = 'localhost,openmercato.com'
  })

  it('returns body tenantId on a platform host', async () => {
    const ctx = await resolveTenantContext(makeReq('openmercato.com'), PLATFORM_TENANT, {
      container: makeContainer(null),
    })
    expect(ctx).toEqual({
      source: 'body',
      tenantId: PLATFORM_TENANT,
      organizationId: null,
      hostname: 'openmercato.com',
    })
  })

  it('throws 400 when platform host has no body tenantId', async () => {
    await expect(
      resolveTenantContext(makeReq('localhost'), null, { container: makeContainer(null) }),
    ).rejects.toBeInstanceOf(TenantResolutionError)
  })

  it('resolves from custom-domain host', async () => {
    const ctx = await resolveTenantContext(
      makeReq('shop.acme.com'),
      undefined,
      {
        container: makeContainer(async () => ({
          tenantId: HOST_TENANT,
          organizationId: HOST_ORG,
          status: 'active',
        })),
      },
    )
    expect(ctx).toEqual({
      source: 'host',
      tenantId: HOST_TENANT,
      organizationId: HOST_ORG,
      hostname: 'shop.acme.com',
    })
  })

  it('throws 404 when custom-domain hostname is not active', async () => {
    await expect(
      resolveTenantContext(makeReq('shop.acme.com'), undefined, {
        container: makeContainer(async () => null),
      }),
    ).rejects.toMatchObject({ status: 404 })

    await expect(
      resolveTenantContext(makeReq('shop.acme.com'), undefined, {
        container: makeContainer(async () => ({
          tenantId: HOST_TENANT,
          organizationId: HOST_ORG,
          status: 'pending',
        })),
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when body tenantId mismatches the host-resolved tenant', async () => {
    await expect(
      resolveTenantContext(makeReq('shop.acme.com'), PLATFORM_TENANT, {
        container: makeContainer(async () => ({
          tenantId: HOST_TENANT,
          organizationId: HOST_ORG,
          status: 'active',
        })),
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('accepts matching body tenantId on a custom-domain host', async () => {
    const ctx = await resolveTenantContext(makeReq('shop.acme.com'), HOST_TENANT, {
      container: makeContainer(async () => ({
        tenantId: HOST_TENANT,
        organizationId: HOST_ORG,
        status: 'active',
      })),
    })
    expect(ctx.tenantId).toBe(HOST_TENANT)
    expect(ctx.source).toBe('host')
  })
})
