import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely'
import { resolveChannelInboxPredicate } from '../channelThreadWidening'

const SCOPE = {
  userId: 'operator-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

function makeContainer(options: {
  granted?: boolean
  build?: ((...args: unknown[]) => unknown) | null | 'missing'
  rbacMissing?: boolean
}) {
  const rbac = options.rbacMissing
    ? null
    : { userHasAllFeatures: jest.fn(async () => options.granted ?? true) }
  return {
    rbac,
    resolve: (name: string) => {
      if (name === 'rbacService') return rbac
      if (name === 'communicationChannelsBuildChannelInboxPredicate') {
        if (options.build === 'missing') throw new Error('not registered')
        return options.build
      }
      throw new Error(`unexpected ${name}`)
    },
  } as any
}

describe('resolveChannelInboxPredicate (#6106)', () => {
  it('binds the caller scope and actor into the hub predicate when the caller holds messages.view', async () => {
    const build = jest.fn(() => sql`true`)
    const container = makeContainer({ build })

    const predicate = await resolveChannelInboxPredicate(container, SCOPE)

    expect(predicate).toEqual(expect.any(Function))
    expect(container.rbac.userHasAllFeatures).toHaveBeenCalledWith('operator-1', ['messages.view'], {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    // The hub is only consulted when the predicate is embedded in a query.
    expect(build).not.toHaveBeenCalled()
    const eb = { marker: 'eb' } as never
    predicate!(eb)
    expect(build).toHaveBeenCalledWith(eb, { tenantId: 'tenant-1', organizationId: 'org-1' }, { userId: 'operator-1' })
  })

  it('returns an embeddable SQL fragment', async () => {
    const db = new Kysely<any>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createQueryCompiler: () => new PostgresQueryCompiler(),
        createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
      },
    })
    const predicate = await resolveChannelInboxPredicate(makeContainer({ build: () => sql`hub_predicate(m.id)` }), SCOPE)

    const compiled = db
      .selectFrom('messages as m')
      .select('m.id')
      .where((eb) => predicate!(eb as never))
      .compile()

    expect(compiled.sql).toContain('hub_predicate(m.id)')
  })

  it('widens nothing without messages.view, and never reaches the hub', async () => {
    const build = jest.fn(() => sql`true`)
    const container = makeContainer({ granted: false, build })
    const resolveSpy = jest.spyOn(container, 'resolve')

    await expect(resolveChannelInboxPredicate(container, SCOPE)).resolves.toBeNull()
    expect(resolveSpy).not.toHaveBeenCalledWith('communicationChannelsBuildChannelInboxPredicate')
  })

  it('widens nothing when RBAC is unavailable', async () => {
    await expect(
      resolveChannelInboxPredicate(makeContainer({ rbacMissing: true, build: () => sql`true` }), SCOPE),
    ).resolves.toBeNull()
  })

  it('widens nothing when the channels hub is not installed', async () => {
    await expect(resolveChannelInboxPredicate(makeContainer({ build: 'missing' }), SCOPE)).resolves.toBeNull()
  })

  it('widens nothing when the hub service is not callable', async () => {
    await expect(resolveChannelInboxPredicate(makeContainer({ build: null }), SCOPE)).resolves.toBeNull()
  })
})
