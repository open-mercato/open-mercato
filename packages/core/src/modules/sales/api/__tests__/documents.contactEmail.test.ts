/** @jest-environment node */
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((em: { find: (...args: unknown[]) => unknown }, entity: unknown, where: unknown, options: unknown) =>
    em.find(entity, where, options),
  ),
}))

import { attachContactEmails } from '@open-mercato/core/modules/sales/api/documents/factory'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

const snapshot = (email: string) => ({ customer: { primaryEmail: email } })

function makeCtx(records: Array<{ id: string; metadata: unknown }>, calls: Array<{ where: Record<string, unknown>; options: Record<string, unknown> }>) {
  const em = {
    find: (_entity: unknown, where: Record<string, unknown>, options: Record<string, unknown>) => {
      calls.push({ where, options })
      return Promise.resolve(records)
    },
  }
  return {
    container: { resolve: (token: string) => (token === 'em' ? em : null) },
    auth: { tenantId: 'ten-1', orgId: 'org-1' },
    selectedOrganizationId: 'org-1',
  } as unknown as CrudCtx
}

describe('attachContactEmails', () => {
  it('reports the Send to address on grid rows, which come without metadata (#8459)', async () => {
    const calls: Array<{ where: Record<string, unknown>; options: Record<string, unknown> }> = []
    const ctx = makeCtx([{ id: 'doc-1', metadata: { customerEmail: ' accounting@example.test ' } }, { id: 'doc-2', metadata: null }], calls)
    const payload: { items: Array<Record<string, unknown>> } = {
      items: [
        { id: 'doc-1', metadata: null, customerSnapshot: snapshot('record@example.test') },
        { id: 'doc-2', metadata: null, customerSnapshot: snapshot('other@example.test') },
      ],
    }

    await attachContactEmails(SalesQuote, payload, ctx)

    expect(payload.items[0].contactEmail).toBe('accounting@example.test')
    expect(payload.items[1].contactEmail).toBe('other@example.test')
    expect(payload.items[0].metadata).toBeNull()
  })

  it('scopes the read to the tenant and organization and loads only what it needs', async () => {
    const calls: Array<{ where: Record<string, unknown>; options: Record<string, unknown> }> = []
    const ctx = makeCtx([], calls)

    await attachContactEmails(SalesQuote, { items: [{ id: 'doc-1', metadata: null, customerSnapshot: null }] }, ctx)

    expect(calls).toHaveLength(1)
    expect(calls[0].where).toMatchObject({
      id: { $in: ['doc-1'] },
      tenantId: 'ten-1',
      organizationId: { $in: ['org-1'] },
    })
    expect(calls[0].options.fields).toEqual(['id', 'metadata', 'tenantId', 'organizationId'])
  })

  it('does not query again for a row that already carries metadata', async () => {
    const calls: Array<{ where: Record<string, unknown>; options: Record<string, unknown> }> = []
    const ctx = makeCtx([], calls)
    const payload: { items: Array<Record<string, unknown>> } = {
      items: [{ id: 'doc-1', metadata: { customerEmail: 'accounting@example.test' }, customerSnapshot: snapshot('record@example.test') }],
    }

    await attachContactEmails(SalesQuote, payload, ctx)

    expect(calls).toHaveLength(0)
    expect(payload.items[0].contactEmail).toBe('accounting@example.test')
  })
})
