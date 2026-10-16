import { randomUUID } from 'node:crypto'
import type { MikroORM } from '@mikro-orm/postgresql'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { MarketingCampaignRun } from '../../data/entities'
import { applyTransition, claimRun, createRun, failRun } from '../runs'
import { PG_URL, SCOPE, createPgOrm, maybe } from '../../__tests__/pg-helpers'

/**
 * M1 against a real column, not a map-declaration assertion: `nativeUpdate` bypasses MikroORM's
 * encryption subscriber, so the fix has to actually land ciphertext on disk for `applyTransition`
 * and `failRun`, not just call a mocked encryption service with the right arguments.
 */
maybe('trigger_context encryption against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM
  const originalFallback = process.env.ALLOW_DERIVED_KMS_FALLBACK
  const originalEnabled = process.env.TENANT_DATA_ENCRYPTION

  beforeAll(async () => {
    process.env.ALLOW_DERIVED_KMS_FALLBACK = 'true'
    process.env.TENANT_DATA_ENCRYPTION = 'true'
    orm = await createPgOrm([MarketingCampaignRun, EncryptionMap])
    // A system-wide map: tenant/organization null matches every scope in loadPolicy's SQL.
    const em = orm.em.fork()
    em.create(EncryptionMap, {
      entityId: 'marketing_automation:marketing_campaign_run',
      tenantId: null,
      organizationId: null,
      fieldsJson: [{ field: 'trigger_context' }],
      isActive: true,
    })
    await em.flush()
  }, 30_000)

  afterAll(async () => {
    process.env.ALLOW_DERIVED_KMS_FALLBACK = originalFallback
    process.env.TENANT_DATA_ENCRYPTION = originalEnabled
    await orm?.close(true)
  })

  async function rawTriggerContext(runId: string): Promise<string | null> {
    const rows = await orm.em.fork().getConnection().execute<Array<{ trigger_context: unknown }>>(
      'select trigger_context from marketing_campaign_runs where id = ?',
      [runId],
    )
    const value = rows[0]?.trigger_context
    return value == null ? null : String(value)
  }

  async function seedRun(): Promise<string> {
    const run = await createRun(orm.em.fork(), {
      campaignId: randomUUID(),
      scope: SCOPE,
      subjectEntityId: randomUUID(),
      triggerEventId: 'evt-1',
      context: { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, eventId: 'evt-1', occurredAt: new Date().toISOString(), dispatchDepth: 1 } as never,
    })
    return run!.id
  }

  it('applyTransition leaves ciphertext on disk, decryptable back to the original payload', async () => {
    const runId = await seedRun()
    const secret = { email: 'buyer@example.com', note: 'VIP — handle personally' }
    const claimToken = await claimRun(orm.em.fork(), runId, SCOPE, new Date())
    expect(claimToken).not.toBeNull()

    const applied = await applyTransition(orm.em.fork(), runId, SCOPE, claimToken!, {
      kind: 'waiting',
      resumeAt: new Date(),
      nextStepIndex: 1,
      nextStepId: 'step-2',
      stepLog: [],
      context: { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, eventId: 'evt-1', occurredAt: new Date().toISOString(), dispatchDepth: 1, trigger: secret } as never,
    }, new Date())
    expect(applied).toBe(true)

    const raw = await rawTriggerContext(runId)
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('buyer@example.com')
    expect(raw).not.toContain('VIP')

    const service = new TenantDataEncryptionService(orm.em.fork())
    const decrypted = await service.decryptEntityPayload(
      'marketing_automation:marketing_campaign_run',
      { triggerContext: raw },
      SCOPE.tenantId,
      SCOPE.organizationId,
    )
    expect(JSON.parse(decrypted.triggerContext as string)).toEqual(secret)
  })

  it('failRun leaves ciphertext on disk too', async () => {
    const runId = await seedRun()
    const secret = { phone: '+1-555-0100' }
    const claimToken = await claimRun(orm.em.fork(), runId, SCOPE, new Date())
    expect(claimToken).not.toBeNull()

    await failRun(orm.em.fork(), runId, SCOPE, claimToken!, {
      attempts: 0,
      error: new Error('[internal] transport refused'),
      stepLog: [],
      resumeStepIndex: 0,
      context: { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, eventId: 'evt-1', occurredAt: new Date().toISOString(), dispatchDepth: 1, trigger: secret } as never,
    }, new Date())

    const raw = await rawTriggerContext(runId)
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('555-0100')

    const service = new TenantDataEncryptionService(orm.em.fork())
    const decrypted = await service.decryptEntityPayload(
      'marketing_automation:marketing_campaign_run',
      { triggerContext: raw },
      SCOPE.tenantId,
      SCOPE.organizationId,
    )
    expect(JSON.parse(decrypted.triggerContext as string)).toEqual(secret)
  })
})
