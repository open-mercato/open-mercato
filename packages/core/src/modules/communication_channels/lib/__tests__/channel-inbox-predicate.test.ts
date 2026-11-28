import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import { buildChannelInboxPredicate } from '../channel-inbox-predicate'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OPERATOR = '33333333-3333-4333-8333-333333333333'
const OTHER_USER = '44444444-4444-4444-8444-444444444444'

function makeDb(): Kysely<any> {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
}

function compile(scope: { tenantId: string; organizationId: string | null }, actor: { userId: string | null }) {
  const compiled = makeDb()
    .selectFrom('messages as m')
    .select('m.id')
    .where((eb) => buildChannelInboxPredicate(eb as never, scope, actor))
    .compile()
  return { sql: compiled.sql.replace(/\s+/g, ' '), parameters: compiled.parameters }
}

describe('buildChannelInboxPredicate (#6106)', () => {
  it('requires an inbound channel link on the message', () => {
    const { sql, parameters } = compile({ tenantId: TENANT, organizationId: ORG }, { userId: OPERATOR })

    expect(sql).toContain('from "message_channel_links" as "mcl"')
    expect(sql).toContain('"mcl"."message_id" = "m"."id"')
    expect(sql).toContain('"mcl"."direction" = $')
    expect(parameters).toContain('inbound')
  })

  it('requires the thread mapping to be unassigned', () => {
    const { sql } = compile({ tenantId: TENANT, organizationId: ORG }, { userId: OPERATOR })

    expect(sql).toContain('inner join "channel_thread_mappings" as "ctm"')
    expect(sql).toContain('"ctm"."message_thread_id" = "m"."thread_id"')
    expect(sql).toContain('"ctm"."assigned_user_id" is null')
  })

  it('authorizes the inbound link through its own conversation and channel mapping', () => {
    const { sql } = compile({ tenantId: TENANT, organizationId: ORG }, { userId: OPERATOR })

    expect(sql).toContain('"ctm"."external_conversation_id" = "mcl"."external_conversation_id"')
    expect(sql).toContain('"ctm"."tenant_id" = "mcl"."tenant_id"')
    expect(sql).toContain('"ec"."id" = "mcl"."external_conversation_id"')
    expect(sql).toContain('"ec"."channel_id" = "ctm"."channel_id"')
    expect(sql).toContain('"ec"."tenant_id" = "ctm"."tenant_id"')
  })

  it('applies the channel-owner rule: shared channels or the actor own channel, live only', () => {
    const { sql, parameters } = compile({ tenantId: TENANT, organizationId: ORG }, { userId: OPERATOR })

    expect(sql).toContain('inner join "communication_channels" as "cc" on "cc"."id" = "ctm"."channel_id"')
    expect(sql).toContain('"cc"."deleted_at" is null')
    expect(sql).toMatch(/\("cc"\."user_id" is null or "cc"\."user_id" = \$\d+\)/)
    expect(parameters).toContain(OPERATOR)
  })

  it('without an actor id only shared channels qualify', () => {
    const { sql, parameters } = compile({ tenantId: TENANT, organizationId: ORG }, { userId: null })

    expect(sql).toContain('"cc"."user_id" is null')
    expect(sql).not.toMatch(/"cc"\."user_id" = \$/)
    expect(parameters).not.toContain(OPERATOR)
  })

  it('scopes every table to the tenant and the organization like resolveChannelThreadAccess', () => {
    const { sql, parameters } = compile({ tenantId: TENANT, organizationId: ORG }, { userId: OPERATOR })

    expect(sql).toContain('"mcl"."tenant_id" = $')
    expect(sql).toContain('"ctm"."tenant_id" = $')
    expect(sql).toContain('"ec"."tenant_id" = $')
    expect(sql).toContain('"cc"."tenant_id" = $')
    // mapping: the caller organization exactly; channel: the organization or tenant-wide
    expect(sql).toContain('"ctm"."organization_id" = $')
    expect(sql).toMatch(/\("cc"\."organization_id" = \$\d+ or "cc"\."organization_id" is null\)/)
    expect(sql).toContain('"mcl"."organization_id" = $')
    expect(sql).toContain('"ec"."organization_id" = $')
    expect(parameters.filter((value) => value === TENANT)).toHaveLength(4)
    expect(parameters.filter((value) => value === ORG)).toHaveLength(4)
  })

  it('without an organization only organization-less rows qualify', () => {
    const { sql, parameters } = compile({ tenantId: TENANT, organizationId: null }, { userId: OPERATOR })

    expect(sql).toContain('"ctm"."organization_id" is null')
    expect(sql).toContain('"cc"."organization_id" is null')
    expect(sql).not.toContain('"ctm"."organization_id" = $')
    expect(parameters).not.toContain(ORG)
  })
})

type AccessCase = {
  name: string
  allowed: boolean
  owner?: string | null
  assigned?: string | null
  sibling?: boolean
  direction?: 'inbound' | 'outbound'
  wrongTenant?: 'link' | 'conversation' | 'mapping' | 'channel'
  wrongOrganization?: 'link' | 'conversation' | 'mapping' | 'channel'
  wrongConversation?: boolean
  wrongChannel?: boolean
  wrongThread?: boolean
  deleted?: boolean
  tenantWideChannel?: boolean
  nullOrganization?: boolean
  noActor?: boolean
}

const accessCases: AccessCase[] = [
  { name: 'shared unassigned conversation', allowed: true },
  { name: 'own personal unassigned conversation', owner: OPERATOR, allowed: true },
  { name: 'private conversation cannot borrow a shared sibling mapping', owner: OTHER_USER, sibling: true, allowed: false },
  { name: 'assigned conversation cannot borrow an unassigned sibling mapping', assigned: OTHER_USER, sibling: true, allowed: false },
  { name: 'outbound message', direction: 'outbound', allowed: false },
  { name: 'different linked conversation', wrongConversation: true, allowed: false },
  { name: 'conversation channel differs from mapping channel', wrongChannel: true, allowed: false },
  { name: 'different mapped message thread', wrongThread: true, allowed: false },
  ...(['link', 'conversation', 'mapping', 'channel'] as const).map((table) => ({ name: `${table} from another tenant`, wrongTenant: table, allowed: false })),
  ...(['link', 'conversation', 'mapping', 'channel'] as const).map((table) => ({ name: `${table} from another organization`, wrongOrganization: table, allowed: false })),
  { name: 'deleted channel', deleted: true, allowed: false },
  { name: 'tenant-wide channel in selected organization', tenantWideChannel: true, allowed: true },
  { name: 'organization-less conversation', nullOrganization: true, allowed: true },
  { name: 'shared conversation without an actor', noActor: true, allowed: true },
  { name: 'personal conversation without an actor', noActor: true, owner: OPERATOR, allowed: false },
]

const describeWithPostgres = process.env.OM_CHANNEL_INBOX_PG_URL ? describe : describe.skip

describeWithPostgres('buildChannelInboxPredicate PostgreSQL authorization', () => {
  const schema = `channel_inbox_${randomUUID().replaceAll('-', '')}`
  let client: Client
  let created = false

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.OM_CHANNEL_INBOX_PG_URL, connectionTimeoutMillis: 5000, query_timeout: 5000 })
    await client.connect()
    await client.query(`create schema "${schema}"`)
    created = true
    await client.query(`set search_path to "${schema}"`)
    await client.query(`
      create table messages (id uuid primary key, thread_id uuid);
      create table communication_channels (id uuid primary key, tenant_id uuid, organization_id uuid, user_id uuid, deleted_at timestamptz);
      create table external_conversations (id uuid primary key, channel_id uuid, tenant_id uuid, organization_id uuid);
      create table channel_thread_mappings (id uuid primary key, external_conversation_id uuid, message_thread_id uuid, channel_id uuid, tenant_id uuid, organization_id uuid, assigned_user_id uuid);
      create table message_channel_links (id uuid primary key, message_id uuid, external_conversation_id uuid, direction text, tenant_id uuid, organization_id uuid);
    `)
  })

  afterAll(async () => {
    try {
      if (created) await client.query(`drop schema "${schema}" cascade`)
    } finally {
      await client?.end()
    }
  })

  it.each(accessCases)('$name', async (scenario) => {
    await client.query('truncate message_channel_links, channel_thread_mappings, external_conversations, communication_channels, messages')
    const messageId = randomUUID()
    const threadId = randomUUID()
    const channelId = randomUUID()
    const conversationId = randomUUID()
    const otherTenant = randomUUID()
    const otherOrganization = randomUUID()
    const organizationId = scenario.nullOrganization ? null : ORG
    const tenant = (table: AccessCase['wrongTenant']) => scenario.wrongTenant === table ? otherTenant : TENANT
    const organization = (table: AccessCase['wrongOrganization']) => scenario.wrongOrganization === table ? otherOrganization : organizationId
    await client.query('insert into messages values ($1, $2)', [messageId, threadId])
    await client.query('insert into communication_channels values ($1,$2,$3,$4,$5)', [channelId, tenant('channel'), scenario.tenantWideChannel ? null : organization('channel'), scenario.owner ?? null, scenario.deleted ? new Date() : null])
    await client.query('insert into external_conversations values ($1,$2,$3,$4)', [conversationId, scenario.wrongChannel ? randomUUID() : channelId, tenant('conversation'), organization('conversation')])
    await client.query('insert into channel_thread_mappings values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), conversationId, scenario.wrongThread ? randomUUID() : threadId, channelId, tenant('mapping'), organization('mapping'), scenario.assigned ?? null])
    await client.query('insert into message_channel_links values ($1,$2,$3,$4,$5,$6)', [randomUUID(), messageId, scenario.wrongConversation ? randomUUID() : conversationId, scenario.direction ?? 'inbound', tenant('link'), organization('link')])
    const expected = scenario.allowed ? [messageId] : []
    if (scenario.sibling) {
      const siblingMessageId = randomUUID()
      const siblingChannelId = randomUUID()
      const siblingConversationId = randomUUID()
      await client.query('insert into messages values ($1,$2)', [siblingMessageId, threadId])
      await client.query('insert into communication_channels values ($1,$2,$3,null,null)', [siblingChannelId, TENANT, organizationId])
      await client.query('insert into external_conversations values ($1,$2,$3,$4)', [siblingConversationId, siblingChannelId, TENANT, organizationId])
      await client.query('insert into channel_thread_mappings values ($1,$2,$3,$4,$5,$6,null)', [randomUUID(), siblingConversationId, threadId, siblingChannelId, TENANT, organizationId])
      await client.query('insert into message_channel_links values ($1,$2,$3,\'inbound\',$4,$5)', [randomUUID(), siblingMessageId, siblingConversationId, TENANT, organizationId])
      expected.push(siblingMessageId)
    }
    const query = compile({ tenantId: TENANT, organizationId }, { userId: scenario.noActor ? null : OPERATOR })
    const result = await client.query<{ id: string }>(query.sql, [...query.parameters])
    expect(result.rows.map((row) => row.id).sort()).toEqual(expected.sort())
  })
})
