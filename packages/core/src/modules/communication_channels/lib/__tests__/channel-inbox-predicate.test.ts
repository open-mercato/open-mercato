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

    expect(sql).toContain('from "channel_thread_mappings" as "ctm"')
    expect(sql).toContain('"ctm"."message_thread_id" = "m"."thread_id"')
    expect(sql).toContain('"ctm"."assigned_user_id" is null')
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
    expect(sql).toContain('"cc"."tenant_id" = $')
    // mapping: the caller organization exactly; channel: the organization or tenant-wide
    expect(sql).toContain('"ctm"."organization_id" = $')
    expect(sql).toMatch(/\("cc"\."organization_id" = \$\d+ or "cc"\."organization_id" is null\)/)
    expect(parameters.filter((value) => value === TENANT)).toHaveLength(3)
    expect(parameters.filter((value) => value === ORG)).toHaveLength(2)
  })

  it('without an organization only organization-less rows qualify', () => {
    const { sql, parameters } = compile({ tenantId: TENANT, organizationId: null }, { userId: OPERATOR })

    expect(sql).toContain('"ctm"."organization_id" is null')
    expect(sql).toContain('"cc"."organization_id" is null')
    expect(sql).not.toContain('"ctm"."organization_id" = $')
    expect(parameters).not.toContain(ORG)
  })
})
