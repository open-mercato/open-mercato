/**
 * Behavioural cover for the trigger-context encryption fix against a real PostgreSQL.
 *
 * `applyTransition`/`failRun` write through `em.nativeUpdate`, which MikroORM documents as having
 * no side effects on the context — including the ORM lifecycle hooks the tenant-encryption
 * subscriber listens on. Before `encryptTriggerContextForNativeWrite` existed, completing or
 * failing a run overwrote the `trigger_context` column — declared encrypted in `encryption.ts` —
 * with plaintext. A map-declaration assertion cannot prove this: it has to look at what actually
 * lands in the column.
 *
 * Uses the deterministic `DerivedKmsService` fallback (`TENANT_DATA_ENCRYPTION_KEY`) so the test
 * needs no Vault. Gated on OM_MARKETING_AUTOMATION_PG_URL — a throwaway database, since the suite
 * creates and drops its own tables. Run it with, for example:
 *
 *   docker run -d --rm --name om-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54372:5432 postgres:18-alpine
 *   OM_MARKETING_AUTOMATION_PG_URL=postgres://postgres:postgres@127.0.0.1:54372/om \
 *   TENANT_DATA_ENCRYPTION_KEY=test-only-derived-key \
 *     yarn workspace @open-mercato/marketing-automation jest trigger-context-encryption.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { MarketingCampaignRun } from '../../data/entities'
import { applyTransition, failRun, type RunScope } from '../runs'

const PG_URL = process.env.OM_MARKETING_AUTOMATION_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN_ENTITY_ID = 'marketing_automation:marketing_campaign_run'

maybe('trigger_context encryption survives applyTransition/failRun against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM
  let em: EntityManager
  const originalKey = process.env.TENANT_DATA_ENCRYPTION_KEY
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeAll(async () => {
    process.env.TENANT_DATA_ENCRYPTION_KEY = 'test-only-derived-key-trigger-context'
    delete process.env.TENANT_DATA_ENCRYPTION

    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [MarketingCampaignRun],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
    })
    await orm.schema.refresh()
    const connection = orm.em.getConnection()
    await connection.execute(`
      create table if not exists "encryption_maps" (
        "id" uuid not null default gen_random_uuid(),
        "entity_id" text not null,
        "tenant_id" uuid null,
        "organization_id" uuid null,
        "fields_json" jsonb null,
        "is_active" boolean not null default true,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "encryption_maps_pkey" primary key ("id")
      )
    `)
    await connection.execute(
      `insert into "encryption_maps" ("entity_id", "tenant_id", "organization_id", "fields_json")
       values (?, ?, null, ?)`,
      [RUN_ENTITY_ID, TENANT, JSON.stringify([{ field: 'trigger_context' }])],
    )
  }, 60_000)

  afterAll(async () => {
    if (originalKey === undefined) delete process.env.TENANT_DATA_ENCRYPTION_KEY
    else process.env.TENANT_DATA_ENCRYPTION_KEY = originalKey
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
    await orm?.close(true)
  })

  beforeEach(async () => {
    em = orm.em.fork()
    await em.getConnection().execute('truncate table "marketing_campaign_runs"')
    await em.getConnection().execute('truncate table "encryption_maps"')
    await em.getConnection().execute(
      `insert into "encryption_maps" ("entity_id", "tenant_id", "organization_id", "fields_json")
       values (?, ?, null, ?)`,
      [RUN_ENTITY_ID, TENANT, JSON.stringify([{ field: 'trigger_context' }])],
    )
  })

  const scope: RunScope = { tenantId: TENANT, organizationId: ORG }

  async function insertRunRow(claimToken: string): Promise<string> {
    const run = em.create(MarketingCampaignRun, {
      campaignId: randomUUID(),
      organizationId: ORG,
      tenantId: TENANT,
      subjectEntityId: null,
      triggerEventId: 'order.created',
      context: {},
      currentStepIndex: 0,
      stepLog: [],
      status: 'running',
      attempts: 0,
      claimToken,
    })
    await em.persistAndFlush(run)
    return run.id
  }

  async function rawTriggerContext(runId: string): Promise<string | null> {
    const rows = await em.getConnection().execute<{ trigger_context: string | null }[]>(
      'select trigger_context from "marketing_campaign_runs" where id = ?',
      [runId],
    )
    return rows[0]?.trigger_context ?? null
  }

  const PLAINTEXT_TRIGGER = { email: 'partner@example.com', orderId: 'ORD-9000' }

  it('applyTransition stores ciphertext, and it decrypts back to the original payload', async () => {
    const claimToken = randomUUID()
    const runId = await insertRunRow(claimToken)

    const affected = await applyTransition(em, runId, scope, claimToken, {
      kind: 'completed',
      stepLog: [],
      context: { trigger: PLAINTEXT_TRIGGER } as never,
    }, new Date())
    expect(affected).toBe(true)

    const stored = await rawTriggerContext(runId)
    expect(stored).not.toBeNull()
    expect(stored).not.toContain('partner@example.com')
    expect(stored).not.toContain('ORD-9000')

    const service = new TenantDataEncryptionService(em)
    const decrypted = await service.decryptEntityPayload(
      RUN_ENTITY_ID,
      { triggerContext: JSON.parse(stored as string) },
      TENANT,
      ORG,
    )
    expect(decrypted.triggerContext).toEqual(PLAINTEXT_TRIGGER)
  })

  it('failRun stores ciphertext, and it decrypts back to the original payload', async () => {
    const claimToken = randomUUID()
    const runId = await insertRunRow(claimToken)

    await failRun(em, runId, scope, claimToken, {
      attempts: 0,
      error: new Error('boom'),
      stepLog: [],
      resumeStepIndex: 0,
      context: { trigger: PLAINTEXT_TRIGGER } as never,
    }, new Date())

    const stored = await rawTriggerContext(runId)
    expect(stored).not.toBeNull()
    expect(stored).not.toContain('partner@example.com')
    expect(stored).not.toContain('ORD-9000')

    const service = new TenantDataEncryptionService(em)
    const decrypted = await service.decryptEntityPayload(
      RUN_ENTITY_ID,
      { triggerContext: JSON.parse(stored as string) },
      TENANT,
      ORG,
    )
    expect(decrypted.triggerContext).toEqual(PLAINTEXT_TRIGGER)
  })

  it('leaves trigger_context null when the transition carries no trigger payload', async () => {
    const claimToken = randomUUID()
    const runId = await insertRunRow(claimToken)

    await applyTransition(em, runId, scope, claimToken, {
      kind: 'completed',
      stepLog: [],
      context: {} as never,
    }, new Date())

    expect(await rawTriggerContext(runId)).toBeNull()
  })
})
