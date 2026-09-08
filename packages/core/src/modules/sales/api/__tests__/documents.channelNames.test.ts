/** @jest-environment node */
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((em: any, entityName: any, where: any, options: any) =>
    em.find(entityName, where, options)
  ),
}))

import { attachChannelNames } from '@open-mercato/core/modules/sales/api/documents/factory'

const CHANNEL_A = '11111111-1111-4111-8111-111111111111'
const CHANNEL_B = '22222222-2222-4222-9222-222222222222'
const CHANNEL_GONE = '33333333-3333-4333-8333-333333333333'

type Channel = { id: string; name: string; code: string | null }

function makeCtx(
  channels: Channel[],
  recordedWheres: Record<string, unknown>[],
  overrides?: Partial<Record<string, unknown>>,
  recordedOptions?: Array<Record<string, unknown> | undefined>,
) {
  const em = {
    find: (_entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => {
      recordedWheres.push(where)
      recordedOptions?.push(options)
      const ids = ((where.id as { $in?: string[] })?.$in ?? []) as string[]
      return Promise.resolve(channels.filter((channel) => ids.includes(channel.id)))
    },
  }
  return {
    container: { resolve: (token: string) => (token === 'em' ? em : null) },
    auth: { tenantId: 'ten-1', orgId: 'org-1' },
    selectedOrganizationId: 'org-1',
    ...overrides,
  } as unknown as CrudCtx
}

describe('attachChannelNames', () => {
  it('should resolve names and codes for a mixed page', async () => {
    const wheres: Record<string, unknown>[] = []
    const ctx = makeCtx(
      [
        { id: CHANNEL_A, name: 'Web shop', code: 'web-shop' },
        { id: CHANNEL_B, name: 'Marketplace', code: null },
      ],
      wheres
    )
    const payload = {
      items: [
        { id: 'doc-1', channelId: CHANNEL_A },
        { id: 'doc-2', channelId: CHANNEL_B },
        { id: 'doc-3', channelId: null },
      ],
    }

    await attachChannelNames(payload, ctx)

    expect(payload.items[0]).toMatchObject({ channelName: 'Web shop', channelCode: 'web-shop' })
    expect(payload.items[1]).toMatchObject({ channelName: 'Marketplace', channelCode: null })
    expect(payload.items[2]).not.toHaveProperty('channelName')
  })

  it('should issue exactly one query for a page with repeated channel ids', async () => {
    const wheres: Record<string, unknown>[] = []
    const ctx = makeCtx([{ id: CHANNEL_A, name: 'Web shop', code: 'web-shop' }], wheres)
    const payload = {
      items: [
        { id: 'doc-1', channelId: CHANNEL_A },
        { id: 'doc-2', channelId: CHANNEL_A },
        { id: 'doc-3', channelId: CHANNEL_A },
      ],
    }

    await attachChannelNames(payload, ctx)

    expect(wheres).toHaveLength(1)
    expect((wheres[0].id as { $in: string[] }).$in).toEqual([CHANNEL_A])
  })

  it('should not query at all when no item carries a channel', async () => {
    const wheres: Record<string, unknown>[] = []
    const ctx = makeCtx([], wheres)

    await attachChannelNames({ items: [{ id: 'doc-1', channelId: null }, { id: 'doc-2' }] }, ctx)

    expect(wheres).toHaveLength(0)
  })

  it('should not query for an empty page', async () => {
    const wheres: Record<string, unknown>[] = []
    await attachChannelNames({ items: [] }, makeCtx([], wheres))
    expect(wheres).toHaveLength(0)
  })

  it('should leave channelName null when the channel row is gone, preserving channelId', async () => {
    const wheres: Record<string, unknown>[] = []
    const ctx = makeCtx([], wheres)
    const payload = { items: [{ id: 'doc-1', channelId: CHANNEL_GONE }] }

    await attachChannelNames(payload, ctx)

    expect(payload.items[0]).toMatchObject({
      channelId: CHANNEL_GONE,
      channelName: null,
      channelCode: null,
    })
  })

  it('should scope the lookup by tenant and the selected organization', async () => {
    const wheres: Record<string, unknown>[] = []
    const ctx = makeCtx([{ id: CHANNEL_A, name: 'Web shop', code: 'web-shop' }], wheres)

    await attachChannelNames({ items: [{ id: 'doc-1', channelId: CHANNEL_A }] }, ctx)

    expect(wheres[0]).toMatchObject({
      tenantId: 'ten-1',
      organizationId: { $in: ['org-1'] },
    })
  })

  it('should use the full organizationIds set when the request spans several orgs', async () => {
    const wheres: Record<string, unknown>[] = []
    const ctx = makeCtx([{ id: CHANNEL_A, name: 'Web shop', code: 'web-shop' }], wheres, {
      organizationIds: ['org-1', 'org-2'],
    })

    await attachChannelNames({ items: [{ id: 'doc-1', channelId: CHANNEL_A }] }, ctx)

    expect(wheres[0]).toMatchObject({ organizationId: { $in: ['org-1', 'org-2'] } })
  })

  it('should request only the columns it reads', async () => {
    const wheres: Record<string, unknown>[] = []
    const options: Array<Record<string, unknown> | undefined> = []
    const ctx = makeCtx([{ id: CHANNEL_A, name: 'Web shop', code: 'web-shop' }], wheres, undefined, options)

    await attachChannelNames({ items: [{ id: 'doc-1', channelId: CHANNEL_A }] }, ctx)

    // SalesChannel carries eight encrypted PII columns (sales/encryption.ts). Selecting the whole
    // row would decrypt all of them on every documents-list request for fields nothing renders.
    expect(options[0]).toMatchObject({ fields: ['id', 'name', 'code'] })
  })

  it('should no-op when the container cannot resolve an EntityManager', async () => {
    const ctx = { container: { resolve: () => null }, auth: { tenantId: 'ten-1' } } as unknown as CrudCtx
    const payload = { items: [{ id: 'doc-1', channelId: CHANNEL_A }] }

    await expect(attachChannelNames(payload, ctx)).resolves.toBeUndefined()
    expect(payload.items[0]).not.toHaveProperty('channelName')
  })
})
