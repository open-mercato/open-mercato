/** @jest-environment node */

import { urlForCustomerOrg } from '../customerUrl'

describe('urlForCustomerOrg', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      PLATFORM_PORTAL_BASE_URL: 'https://portal.example.com',
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('builds an organization-scoped portal URL through orgService when available', async () => {
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'domainMappingService') return { resolveActiveByOrg: jest.fn(async () => null) }
        if (name === 'orgService') return { findById: jest.fn(async () => ({ id: 'org-1', slug: 'acme' })) }
        return null
      }),
    }

    await expect(urlForCustomerOrg('org-1', '/invite?token=raw', { container: container as never }))
      .resolves.toBe('https://portal.example.com/acme/portal/invite?token=raw')
  })

  it('falls back to EntityManager organization lookup when orgService is not registered', async () => {
    const em = {
      findOne: jest.fn(async () => ({ id: 'org-1', slug: 'acme' })),
    }
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'domainMappingService') return { resolveActiveByOrg: jest.fn(async () => null) }
        if (name === 'orgService') throw new Error('[internal] orgService unavailable')
        if (name === 'em') return em
        return null
      }),
    }

    await expect(urlForCustomerOrg('org-1', '/invite?token=raw', { container: container as never }))
      .resolves.toBe('https://portal.example.com/acme/portal/invite?token=raw')
    expect(em.findOne).toHaveBeenCalled()
  })

  it('uses custom domain without adding portal slug prefix', async () => {
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'domainMappingService') return { resolveActiveByOrg: jest.fn(async () => ({ hostname: 'shop.example.com' })) }
        return null
      }),
    }

    await expect(urlForCustomerOrg('org-1', '/invite?token=raw', { container: container as never }))
      .resolves.toBe('https://shop.example.com/invite?token=raw')
  })
})
