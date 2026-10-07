import { hasCatalog, hasSales, readCapabilities, resetCapabilityCache } from '../capabilities'

/**
 * The probe behind `optionalRequires`.
 *
 * `index.ts` declares `sales` and `catalog` as optional, and this is what makes that declaration true rather
 * than decorative: the module reads their tables directly, so without this check an installation that lacks
 * them would answer 500 on the audience screen instead of simply offering fewer fields.
 */
type Execute = (sql: string) => Promise<unknown>

function fakeEm(rows: Array<Record<string, boolean>>, spy?: { sql: string[] }) {
  return {
    execute: ((sql: string) => {
      spy?.sql.push(sql)
      return Promise.resolve(rows)
    }) as Execute,
  } as never
}

beforeEach(() => resetCapabilityCache())

describe('readCapabilities', () => {
  it('reports both present when both tables resolve', async () => {
    expect(await readCapabilities(fakeEm([{ sales: true, catalog: true }]))).toEqual({ sales: true, catalog: true })
  })

  it('reports absence per module, not as all-or-nothing', async () => {
    // A CRM-and-catalogue installation with no sales is a real shape, and it can still target categories.
    expect(await readCapabilities(fakeEm([{ sales: false, catalog: true }]))).toEqual({ sales: false, catalog: true })
  })

  it('treats anything but true as absent', async () => {
    // A driver that answers null, undefined or a string must not be read as "present".
    expect(await readCapabilities(fakeEm([{} as Record<string, boolean>]))).toEqual({ sales: false, catalog: false })
  })

  it('treats an empty result as absent rather than throwing', async () => {
    expect(await readCapabilities(fakeEm([]))).toEqual({ sales: false, catalog: false })
  })

  it('asks the database, in one statement, through to_regclass', async () => {
    const spy = { sql: [] as string[] }
    await readCapabilities(fakeEm([{ sales: true, catalog: true }], spy))
    expect(spy.sql).toHaveLength(1)
    expect(spy.sql[0]).toContain('to_regclass')
    // `to_regclass` respects the search path, so it answers for the schema the failing query would have used.
    expect(spy.sql[0]).not.toContain('information_schema')
  })

  it('probes once, however many callers ask', async () => {
    const spy = { sql: [] as string[] }
    const em = fakeEm([{ sales: true, catalog: false }], spy)
    await Promise.all([readCapabilities(em), hasSales(em), hasCatalog(em), readCapabilities(em)])
    // The hottest path in the module evaluates an audience; a round trip per evaluation would be the cost.
    expect(spy.sql).toHaveLength(1)
  })

  it('does not cache a FAILED probe', async () => {
    /**
     * A connection that was down when the first request arrived must not leave the module permanently convinced
     * that sales does not exist — that would silently empty every order audience until somebody restarted it,
     * with nothing on any screen saying why.
     */
    let attempt = 0
    const em = {
      execute: (() => {
        attempt += 1
        return attempt === 1 ? Promise.reject(new Error('connection refused')) : Promise.resolve([{ sales: true, catalog: true }])
      }) as Execute,
    } as never
    await expect(readCapabilities(em)).rejects.toThrow('connection refused')
    expect(await readCapabilities(em)).toEqual({ sales: true, catalog: true })
  })
})
