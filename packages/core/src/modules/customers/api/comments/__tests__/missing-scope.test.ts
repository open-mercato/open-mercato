/** @jest-environment node */

/**
 * Regression test for #2117 (audit finding C-03): the comments afterList deal
 * enrichment must hard-fail (400) when tenant/org context is missing instead of
 * falling through to an unscoped em.find that could decrypt foreign-tenant deal
 * titles. The deal lookup must also scope its WHERE clause by tenant + org.
 */

const mockFindWithDecryption = jest.fn()
let capturedCrudOptions: Record<string, any> | null = null

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: Record<string, any>) => {
    capturedCrudOptions = opts
    return { GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const DEAL_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

type AfterListCtx = {
  auth: { tenantId: string | null; orgId: string | null }
  selectedOrganizationId: string | null
  container: { resolve: (token: string) => unknown }
}

async function runAfterList(
  payload: { items: unknown[] },
  ctx: AfterListCtx,
): Promise<unknown> {
  let caught: unknown
  try {
    await capturedCrudOptions?.hooks?.afterList?.(payload, ctx)
  } catch (err) {
    caught = err
  }
  return caught
}

describe('customers comments afterList deal enrichment scope (#2117)', () => {
  beforeAll(async () => {
    await import('../route')
  })

  beforeEach(() => {
    mockFindWithDecryption.mockReset()
  })

  it('throws 400 when tenant context is missing and deals need enrichment', async () => {
    const em = { find: jest.fn() }
    const ctx: AfterListCtx = {
      auth: { tenantId: null, orgId: null },
      selectedOrganizationId: null,
      container: { resolve: (token) => (token === 'em' ? em : null) },
    }
    const caught = await runAfterList({ items: [{ id: 'c1', deal_id: DEAL_ID }] }, ctx)

    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as { status: number }).status).toBe(400)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
  })

  it('throws 400 when organization context is missing even with a tenant', async () => {
    const em = { find: jest.fn() }
    const ctx: AfterListCtx = {
      auth: { tenantId: 'tenant-1', orgId: null },
      selectedOrganizationId: null,
      container: { resolve: (token) => (token === 'em' ? em : null) },
    }
    const caught = await runAfterList({ items: [{ id: 'c1', deal_id: DEAL_ID }] }, ctx)

    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as { status: number }).status).toBe(400)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
  })

  it('scopes the deal lookup by tenant and organization in the WHERE clause', async () => {
    mockFindWithDecryption.mockResolvedValue([{ id: DEAL_ID, title: 'Acme expansion' }])
    const em = { find: jest.fn() }
    const ctx: AfterListCtx = {
      auth: { tenantId: 'tenant-1', orgId: 'org-1' },
      selectedOrganizationId: 'org-1',
      container: { resolve: (token) => (token === 'em' ? em : null) },
    }
    const payload = { items: [{ id: 'c1', deal_id: DEAL_ID }] as Record<string, unknown>[] }

    const caught = await runAfterList(payload, ctx)

    expect(caught).toBeUndefined()
    expect(em.find).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      expect.anything(),
      expect.objectContaining({
        id: { $in: [DEAL_ID] },
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(payload.items[0]).toMatchObject({
      deal_title: 'Acme expansion',
      dealTitle: 'Acme expansion',
    })
  })

  it('does not require scope when no item references a deal', async () => {
    const em = { find: jest.fn() }
    const ctx: AfterListCtx = {
      auth: { tenantId: null, orgId: null },
      selectedOrganizationId: null,
      container: { resolve: (token) => (token === 'em' ? em : null) },
    }
    const caught = await runAfterList({ items: [{ id: 'c1' }] }, ctx)

    expect(caught).toBeUndefined()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
  })
})
