/** @jest-environment node */

import { setup } from '../setup'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: () => unknown }) => em.find(),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'

type SeedContext = Parameters<NonNullable<typeof setup.seedDefaults>>[0]
type SeedOrganization = { name: string; slug: string | null }

function makeSetupContext() {
  const organizations: SeedOrganization[][] = []
  const allocations = new Set<string>()
  const transactional = jest.fn(async (backfill: (em: unknown) => Promise<void>, _options: { clear: boolean }) => {
    const rows = [{ name: 'Depot', slug: null }, { name: 'Depot', slug: null }]
    organizations.push(rows)
    await backfill({
      find: async () => rows,
      count: async (_entity: unknown, query: Record<symbol, string>) => Number(
        Object.getOwnPropertySymbols(query).some((key) => allocations.has(query[key])),
      ),
    })
    if (organizations.length === 1) {
      allocations.add('depot')
      throw { code: '23505', constraint: 'organizations_live_slug_uniq' }
    }
  })
  const context = { tenantId, em: { transactional } } as unknown as SeedContext
  return { context, organizations, transactional }
}

it('reallocates portal slugs in a fresh setup transaction after a concurrent reservation', async () => {
  const { context, organizations, transactional } = makeSetupContext()

  await setup.seedDefaults?.(context)

  expect(transactional).toHaveBeenCalledTimes(2)
  expect(transactional.mock.calls.every(([, options]) => options?.clear)).toBe(true)
  expect(organizations.map((rows) => rows.map((row) => row.slug))).toEqual([
    ['depot', 'depot-1'],
    ['depot-1', 'depot-2'],
  ])
})
