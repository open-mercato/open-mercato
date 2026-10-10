/** @jest-environment node */
/**
 * Seeding a chart of accounts.
 *
 * The property that matters is **idempotency by code**: re-running the seed after
 * a template gains an account must add only that account and leave every existing
 * row — including a name an operator edited — exactly as it is. A seed that
 * overwrote would be a seed nobody dares run twice, and then a tenant that opened
 * its books before the VAT accounts existed could never get them.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ChartOfAccountsTemplateContract } from '../contracts'
import { GlAccount } from '../../data/entities'
import { missingChartCodes, seedChartOfAccounts } from '../chartOfAccounts'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

type FakeRow = { id: string; code: string; name: string; parentId: string | null }

function createFakeEm(existing: FakeRow[]) {
  const rows = [...existing]
  let sequence = 0
  const em = {
    find: jest.fn(async () => rows),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
      id: `generated-${++sequence}`,
      ...data,
    })),
    persist: jest.fn((entity: FakeRow) => {
      rows.push(entity)
      return em
    }),
    flush: jest.fn(async () => undefined),
  }
  return { em: em as unknown as EntityManager, rows, raw: em }
}

const template: ChartOfAccountsTemplateContract = {
  countryCode: 'SA',
  listAccounts: () => [
    { code: '1000', name: 'Cash on hand', accountClass: 'asset', normalBalance: 'debit', accountType: 'cash' },
    { code: '2100', name: 'Output VAT payable', accountClass: 'liability', normalBalance: 'credit', accountType: 'tax_payable' },
  ],
  accountCodeForTaxCode: () => null,
}

describe('missingChartCodes', () => {
  it('reports only the codes the organization does not have', () => {
    expect(missingChartCodes(template, ['1000'])).toEqual(['2100'])
    expect(missingChartCodes(template, [])).toEqual(['1000', '2100'])
    expect(missingChartCodes(template, ['1000', '2100'])).toEqual([])
  })
})

describe('seedChartOfAccounts', () => {
  it('creates every account of the template on a fresh chart', async () => {
    const { em, raw } = createFakeEm([])

    const result = await seedChartOfAccounts(em, scope, template, { currencyCode: 'SAR', countryCode: 'SA' })

    expect(result.created).toEqual(['1000', '2100'])
    expect(result.skipped).toEqual([])
    expect(result.currencyCode).toBe('SAR')
    expect(raw.create).toHaveBeenCalledTimes(2)
    expect(raw.persist).toHaveBeenCalledTimes(2)
  })

  it('is idempotent: a second run creates nothing and reports every code as skipped', async () => {
    const existing: FakeRow[] = [
      { id: 'a', code: '1000', name: 'Petty cash', parentId: null },
      { id: 'b', code: '2100', name: 'Output VAT payable', parentId: null },
    ]
    const { em, raw } = createFakeEm(existing)

    const result = await seedChartOfAccounts(em, scope, template, { currencyCode: 'SAR' })

    expect(result.created).toEqual([])
    expect(result.skipped).toEqual(['1000', '2100'])
    expect(raw.create).not.toHaveBeenCalled()
    // The operator's own name for the account survives the re-run.
    expect(existing[0].name).toBe('Petty cash')
  })

  it('adds only the accounts a template gained since the last run', async () => {
    const { em, raw } = createFakeEm([{ id: 'a', code: '1000', name: 'Cash on hand', parentId: null }])

    const result = await seedChartOfAccounts(em, scope, template, { currencyCode: 'SAR' })

    expect(result.created).toEqual(['2100'])
    expect(result.skipped).toEqual(['1000'])
    expect(raw.create).toHaveBeenCalledTimes(1)
  })

  it('stamps the jurisdiction and the currency on every account it creates', async () => {
    const { em, raw } = createFakeEm([])

    await seedChartOfAccounts(em, scope, template, { currencyCode: 'SAR', countryCode: 'SA' })

    for (const call of raw.create.mock.calls) {
      expect(call[1]).toMatchObject({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        currencyCode: 'SAR',
        countryCode: 'SA',
      })
    }
  })

  it('scopes the lookup to the organization, never the whole tenant', async () => {
    const { em, raw } = createFakeEm([])

    await seedChartOfAccounts(em, scope, template, { currencyCode: 'SAR' })

    expect(raw.find).toHaveBeenCalledWith(
      GlAccount,
      expect.objectContaining({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
    )
  })

  it('links a child to its parent within one pass even when the parent is listed later', async () => {
    const withParent: ChartOfAccountsTemplateContract = {
      countryCode: 'SA',
      listAccounts: () => [
        { code: '1150', name: 'Input VAT receivable', accountClass: 'asset', normalBalance: 'debit', parentCode: '1100' },
        { code: '1100', name: 'Accounts receivable', accountClass: 'asset', normalBalance: 'debit' },
      ],
      accountCodeForTaxCode: () => null,
    }
    const { em, rows } = createFakeEm([])

    await seedChartOfAccounts(em, scope, withParent, { currencyCode: 'SAR' })

    const child = rows.find((row) => row.code === '1150')
    const parent = rows.find((row) => row.code === '1100')
    expect(child?.parentId).toBe(parent?.id)
  })

  it('does not reparent an account that already has a parent', async () => {
    const withParent: ChartOfAccountsTemplateContract = {
      countryCode: 'SA',
      listAccounts: () => [
        { code: '1150', name: 'Input VAT receivable', accountClass: 'asset', normalBalance: 'debit', parentCode: '1100' },
        { code: '1100', name: 'Accounts receivable', accountClass: 'asset', normalBalance: 'debit' },
      ],
      accountCodeForTaxCode: () => null,
    }
    const { em, rows } = createFakeEm([
      { id: 'child', code: '1150', name: 'Input VAT receivable', parentId: 'somewhere-else' },
      { id: 'parent', code: '1100', name: 'Accounts receivable', parentId: null },
    ])

    await seedChartOfAccounts(em, scope, withParent, { currencyCode: 'SAR' })

    // An operator reorganised the chart; a re-seed must not undo that.
    expect(rows.find((row) => row.code === '1150')?.parentId).toBe('somewhere-else')
  })

  it('handles an empty template without touching the database', async () => {
    const empty: ChartOfAccountsTemplateContract = {
      countryCode: 'ZZ',
      listAccounts: () => [],
      accountCodeForTaxCode: () => null,
    }
    const { em, raw } = createFakeEm([])

    const result = await seedChartOfAccounts(em, scope, empty, { currencyCode: 'USD' })

    expect(result.created).toEqual([])
    expect(raw.create).not.toHaveBeenCalled()
  })
})
