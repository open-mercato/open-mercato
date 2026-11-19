import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import { Client, type ClientConfig } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { CheckoutLink, CheckoutLinkSlugOwner, CheckoutLinkTemplate } from '../../data/entities'
import { ensureUniqueSlug } from '../../lib/utils'
import { Migration20261119143000_checkout } from '../Migration20261119143000_checkout'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('checkout link slug ownership on PostgreSQL', () => {
  const originalScope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const otherScope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const originalLinkId = randomUUID()
  const ambiguousLiveLinkId = randomUUID()
  let postgres: StartedTestContainer | undefined
  let db: Client
  let config: ClientConfig
  let orm: MikroORM

  async function addLink(slug: string, tenantId: string, options: { id?: string; retired?: boolean } = {}) {
    await db.query(
      'insert into checkout_links (id, slug, tenant_id, deleted_at) values ($1, $2, $3, $4)',
      [options.id ?? randomUUID(), slug, tenantId, options.retired ? new Date() : null],
    )
  }

  async function allocate(
    slug: string,
    scope: typeof originalScope,
    excludeId?: string,
  ): Promise<string> {
    return ensureUniqueSlug(orm.em.fork(), scope, slug, slug, excludeId)
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'checkout_slug_test', POSTGRES_USER: 'checkout_test', POSTGRES_PASSWORD: 'checkout_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(110_000)
      .start()
    const connection = {
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'checkout_test',
      password: 'checkout_test',
    }
    config = { ...connection, database: 'checkout_slug_test' }
    db = new Client(config)
    await db.connect()
    await db.query(`
      create table checkout_links (id uuid primary key, slug text not null, tenant_id uuid not null, deleted_at timestamptz);
      create unique index checkout_links_slug_index on checkout_links (slug) where deleted_at is null;
    `)
    await addLink('retired', originalScope.tenantId, { id: originalLinkId, retired: true })
    await addLink('ambiguous', originalScope.tenantId, { retired: true })
    await addLink('ambiguous', otherScope.tenantId, { id: ambiguousLiveLinkId })

    const statements: string[] = []
    const migration = Object.create(Migration20261119143000_checkout.prototype) as Migration20261119143000_checkout
    Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
    await migration.up()
    await db.query('begin')
    try {
      for (const statement of statements) await db.query(statement)
      await db.query('commit')
    } catch (error) {
      await db.query('rollback')
      throw error
    }

    orm = await MikroORM.init({
      ...connection,
      dbName: 'checkout_slug_test',
      entities: [CheckoutLinkTemplate, CheckoutLink, CheckoutLinkSlugOwner],
    })
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close()
      await db?.end()
    } finally {
      await postgres?.stop()
    }
  }, 120_000)

  it('reserves a previously deleted link for its original tenant and allows restore', async () => {
    const otherSlug = await allocate('retired', otherScope)
    expect(otherSlug).toBe('retired-2')
    await addLink(otherSlug, otherScope.tenantId)
    await expect(allocate('retired', originalScope)).resolves.toBe('retired')
    await expect(allocate('retired', originalScope, originalLinkId)).resolves.toBe('retired')
    await expect(db.query(
      'update checkout_links set deleted_at = null where id = $1',
      [originalLinkId],
    )).resolves.toMatchObject({ rowCount: 1 })
  })

  it('keeps a legacy live slug until retirement when multiple tenants used it', async () => {
    await expect(allocate('ambiguous', otherScope, ambiguousLiveLinkId)).resolves.toBe('ambiguous')
    await db.query('update checkout_links set deleted_at = now() where id = $1', [ambiguousLiveLinkId])
    await expect(allocate('ambiguous', originalScope)).resolves.toBe('ambiguous-2')
    await expect(allocate('ambiguous', otherScope)).resolves.toBe('ambiguous-2')
  })

  it('allows the owning tenant to create a replacement for a retired link', async () => {
    await addLink('replacement', originalScope.tenantId)
    await db.query("update checkout_links set deleted_at = now() where slug = 'replacement'")
    const slug = await allocate('replacement', originalScope)
    expect(slug).toBe('replacement')
    await addLink(slug, originalScope.tenantId)
    await expect(allocate('replacement', originalScope)).resolves.toBe('replacement-2')
  })

  it('reserves both slugs when a link is renamed', async () => {
    await addLink('before-rename', originalScope.tenantId)
    await db.query("update checkout_links set slug = 'after-rename' where slug = 'before-rename'")
    await expect(allocate('before-rename', otherScope)).resolves.toBe('before-rename-2')
    await expect(allocate('before-rename', originalScope)).resolves.toBe('before-rename')
    await db.query("update checkout_links set deleted_at = now() where slug = 'after-rename'")
    await expect(allocate('after-rename', otherScope)).resolves.toBe('after-rename-2')
  })

  it('rejects a competing write based on an allocation made before the reservation commits', async () => {
    const writer = new Client(config)
    await writer.connect()
    try {
      await writer.query('begin')
      await writer.query(
        'insert into checkout_links (id, slug, tenant_id, deleted_at) values ($1, $2, $3, now())',
        [randomUUID(), 'competing', originalScope.tenantId],
      )
      const staleCandidate = await allocate('competing', otherScope)
      expect(staleCandidate).toBe('competing')
      await writer.query('commit')

      await expect(addLink(staleCandidate, otherScope.tenantId)).rejects.toMatchObject({
        code: '23505',
        constraint: 'checkout_link_slug_owners_pkey',
      })
      await expect(allocate('competing', otherScope)).resolves.toBe('competing-2')
    } finally {
      await writer.end()
    }
  })
})
