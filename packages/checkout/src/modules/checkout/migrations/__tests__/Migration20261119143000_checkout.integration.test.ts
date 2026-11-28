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
  const sameTenantOtherOrganization = { tenantId: originalScope.tenantId, organizationId: randomUUID() }
  const originalLinkId = randomUUID()
  const ambiguousLiveLinkId = randomUUID()
  const ambiguousOrganizationLiveLinkId = randomUUID()
  let postgres: StartedTestContainer | undefined
  let db: Client
  let config: ClientConfig
  let orm: MikroORM

  async function addLink(slug: string, scope: typeof originalScope, options: { id?: string; retired?: boolean } = {}) {
    await db.query(
      'insert into checkout_links (id, slug, tenant_id, organization_id, deleted_at) values ($1, $2, $3, $4, $5)',
      [options.id ?? randomUUID(), slug, scope.tenantId, scope.organizationId, options.retired ? new Date() : null],
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
      create table checkout_links (id uuid primary key, slug text not null, tenant_id uuid not null, organization_id uuid not null, deleted_at timestamptz);
      create unique index checkout_links_slug_index on checkout_links (slug) where deleted_at is null;
    `)
    await addLink('retired', originalScope, { id: originalLinkId, retired: true })
    await addLink('ambiguous', originalScope, { retired: true })
    await addLink('ambiguous', otherScope, { id: ambiguousLiveLinkId })
    await addLink('organization-history', originalScope, { retired: true })
    await addLink('organization-history', sameTenantOtherOrganization, { id: ambiguousOrganizationLiveLinkId })

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

  it('provides stable UUID record IDs for tenant-scoped query indexing', async () => {
    const reservations = await db.query(
      'select id, slug from checkout_link_slug_owners where tenant_id = $1 and organization_id = $2 order by id',
      [originalScope.tenantId, originalScope.organizationId],
    )
    expect(reservations.rows).toEqual([
      { id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f-]{27}$/), slug: 'retired' },
    ])
    const reservation = await orm.em.fork().findOneOrFail(CheckoutLinkSlugOwner, { slug: 'retired' })
    expect(reservation.id).toBe(reservations.rows[0].id)
  })

  it('reserves a previously deleted link for its original scope and allows restore', async () => {
    const otherSlug = await allocate('retired', otherScope)
    expect(otherSlug).toBe('retired-2')
    await addLink(otherSlug, otherScope)
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

  it('blocks a sibling organization from taking ownership when creating, restoring or renaming a link', async () => {
    const retainedId = randomUUID()
    await addLink('organization-owned', originalScope, { id: retainedId, retired: true })
    const siblingId = randomUUID()
    await addLink('sibling-link', sameTenantOtherOrganization, { id: siblingId })
    const ownershipError = { code: '23505', constraint: 'checkout_link_slug_owners_slug_unique' }

    await expect(allocate('organization-owned', sameTenantOtherOrganization)).resolves.toBe('organization-owned-2')
    await expect(addLink('organization-owned', sameTenantOtherOrganization)).rejects.toMatchObject(ownershipError)
    await expect(db.query(
      'update checkout_links set deleted_at = null, organization_id = $1 where id = $2',
      [sameTenantOtherOrganization.organizationId, retainedId],
    )).rejects.toMatchObject(ownershipError)
    await expect(db.query(
      'update checkout_links set slug = $1 where id = $2',
      ['organization-owned', siblingId],
    )).rejects.toMatchObject(ownershipError)
    await expect(db.query('update checkout_links set deleted_at = null where id = $1', [retainedId]))
      .resolves.toMatchObject({ rowCount: 1 })
    await expect(db.query(
      'update checkout_links set organization_id = $1 where id = $2',
      [sameTenantOtherOrganization.organizationId, retainedId],
    )).rejects.toMatchObject(ownershipError)
  })

  it('keeps an existing live slug with ambiguous same-tenant history until retirement', async () => {
    await expect(allocate('organization-history', sameTenantOtherOrganization, ambiguousOrganizationLiveLinkId))
      .resolves.toBe('organization-history')
    await db.query('update checkout_links set deleted_at = now() where id = $1', [ambiguousOrganizationLiveLinkId])
    await expect(allocate('organization-history', originalScope)).resolves.toBe('organization-history-2')
    await expect(allocate('organization-history', sameTenantOtherOrganization)).resolves.toBe('organization-history-2')
  })

  it('allows the owning organization to create a replacement for a retired link', async () => {
    await addLink('replacement', originalScope)
    await db.query("update checkout_links set deleted_at = now() where slug = 'replacement'")
    const slug = await allocate('replacement', originalScope)
    expect(slug).toBe('replacement')
    await addLink(slug, originalScope)
    await expect(allocate('replacement', originalScope)).resolves.toBe('replacement-2')
  })

  it('reserves both slugs when a link is renamed', async () => {
    await addLink('before-rename', originalScope)
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
        'insert into checkout_links (id, slug, tenant_id, organization_id, deleted_at) values ($1, $2, $3, $4, now())',
        [randomUUID(), 'competing', originalScope.tenantId, originalScope.organizationId],
      )
      const staleCandidate = await allocate('competing', otherScope)
      expect(staleCandidate).toBe('competing')
      await writer.query('commit')

      await expect(addLink(staleCandidate, otherScope)).rejects.toMatchObject({
        code: '23505',
        constraint: 'checkout_link_slug_owners_slug_unique',
      })
      await expect(allocate('competing', otherScope)).resolves.toBe('competing-2')
    } finally {
      await writer.end()
    }
  })
  it('rolls back reservations without deleting checkout links', async () => {
    const before = await db.query('select id, slug, tenant_id, organization_id, deleted_at from checkout_links order by id')
    const statements: string[] = []
    const migration = Object.create(Migration20261119143000_checkout.prototype) as Migration20261119143000_checkout
    Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
    await migration.down()
    for (const statement of statements) await db.query(statement)
    const after = await db.query('select id, slug, tenant_id, organization_id, deleted_at from checkout_links order by id')
    expect(after.rows).toEqual(before.rows)
    await expect(db.query('select * from checkout_link_slug_owners')).rejects.toMatchObject({ code: '42P01' })
    await expect(addLink('after-rollback', otherScope)).resolves.toBeUndefined()
  })
})
