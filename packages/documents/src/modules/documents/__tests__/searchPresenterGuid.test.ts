jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

import { searchConfig } from '../search'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'

describe('documents search result presenter', () => {
  it('uses a localized generic label instead of exposing an id when title is absent', async () => {
    const presenter = await searchConfig.entities[0]?.formatResult?.({
      record: { id: DOCUMENT_ID, title: null },
    } as never)

    expect(presenter?.title).toBe('Document')
    expect(JSON.stringify(presenter)).not.toContain(DOCUMENT_ID)
  })
})

describe('documents search content scope', () => {
  function buildContext(scope: { tenantId?: string | null; organizationId?: string | null }) {
    const findOne = jest.fn(async (..._args: unknown[]) => null)
    return {
      findOne,
      ctx: {
        record: { id: DOCUMENT_ID, title: 'Quarterly plan' },
        customFields: {},
        container: { resolve: () => ({ findOne }) },
        ...scope,
      },
    }
  }

  it('refuses the content read when the tenant scope is absent', async () => {
    const { findOne, ctx } = buildContext({ organizationId: ORGANIZATION_ID })

    await searchConfig.entities[0]?.buildSource?.(ctx as never)

    expect(findOne).not.toHaveBeenCalled()
  })

  it('refuses the content read when the organization scope is absent', async () => {
    const { findOne, ctx } = buildContext({ tenantId: TENANT_ID })

    await searchConfig.entities[0]?.buildSource?.(ctx as never)

    expect(findOne).not.toHaveBeenCalled()
  })

  it('reads content with both ownership predicates when the scope is complete', async () => {
    const { findOne, ctx } = buildContext({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })

    await searchConfig.entities[0]?.buildSource?.(ctx as never)

    expect(findOne).toHaveBeenCalledTimes(1)
    expect(findOne.mock.calls[0]?.[1]).toMatchObject({
      documentId: DOCUMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })
  })
})
