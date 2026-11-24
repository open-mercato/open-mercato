import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  chromeWindows, createActivityFixture, enqueueActivityJob, expectActivityCount, expectLoginToken,
  fixtureIp, getActivity, getOwnActivity, signIn,
} from './helpers/signInActivityFixtures'
import { decodeJwtPayload, enrollTotp, verifyTotpChallenge } from './helpers/securityFixtures'

test('TC-SEC-022: projects verification before queued insert and ignores duplicate, legacy and expired jobs', async ({ request }) => {
  test.skip(parseBooleanWithDefault(process.env.AUTO_SPAWN_WORKERS ?? process.env.OM_AUTO_SPAWN_WORKERS, true),
    'Requires the isolated local queue runner with managed workers disabled to control delivery order.')
  test.skip(parseBooleanWithDefault(process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS, false),
    'Requires MFA challenge enforcement.')

  const fixture = await createActivityFixture(request)
  try {
    const actor = await fixture.createActor()
    const token = expectLoginToken(await signIn(actor))
    const { secret } = await enrollTotp(request, token)
    const query = { userId: actor.userId, result: 'success' }
    await expectActivityCount(request, fixture.adminToken, query, 1)

    const login = await signIn(actor, { userAgent: chromeWindows })
    expect(login.mfa_required).toBe(true)
    const pendingToken = expectLoginToken(login)
    expect((await getActivity(request, fixture.adminToken, query)).total).toBe(1)
    const verification = await withCredentialIsolatedRequest((isolated) =>
      verifyTotpChallenge(isolated, pendingToken, login.challenge_id ?? '', secret),
    )
    expect(verification.status).toBe(200)
    expect(verification.body.token).toEqual(expect.any(String))
    const rows = await expectActivityCount(request, fixture.adminToken, query, 2)
    const verified = rows.find((row) => row.browserName === 'Chrome')
    expect(verified?.mfaStatus).toBe('verified')
    expect((await getOwnActivity(request, verification.body.token ?? '')).items)
      .toContainEqual(expect.objectContaining({ id: verified?.id, mfaStatus: 'verified' }))

    const claims = decodeJwtPayload(pendingToken) as ReturnType<typeof decodeJwtPayload> & { sid: string }
    const scope = { tenantId: claims.tenantId, organizationId: claims.orgId ?? null }
    const payload = {
      id: actor.userId,
      email: actor.email,
      ...scope,
      ip: fixtureIp,
      userAgent: chromeWindows,
      occurredAt: new Date().toISOString(),
    }
    async function enqueueLogin(data: Record<string, unknown>) {
      await enqueueActivityJob('events', {
        event: 'auth.login.success',
        payload: data,
        options: { ...scope, persistent: true, skipPersistentSubscribersInline: true },
        persistentDeliveredInline: false,
      })
    }
    await enqueueLogin({ ...payload, attemptId: claims.sid })
    await enqueueLogin(payload)
    await enqueueLogin({ ...payload, attemptId: randomUUID(), occurredAt: new Date(0).toISOString() })
    await drainIntegrationQueue('events')

    expect((await getActivity(request, fixture.adminToken, query)).total).toBe(2)
    const intents = await withClient((client) => client.query(
      'select id from security_sign_in_notification_intents where tenant_id = $1 and user_id = $2 and source_attempt_id = $3',
      [scope.tenantId, actor.userId, claims.sid],
    ))
    expect(intents.rows).toHaveLength(1)
  } finally {
    await fixture.dispose()
  }
})

test('TC-SEC-022: rolls back a failed intent write and recovers an interrupted acknowledgement', async ({ request }) => {
  test.skip(parseBooleanWithDefault(process.env.AUTO_SPAWN_WORKERS ?? process.env.OM_AUTO_SPAWN_WORKERS, true),
    'Requires an isolated database and manual local queue processing for fault injection.')
  const fixture = await createActivityFixture(request)
  try {
    const actor = await fixture.createActor()
    const fullToken = expectLoginToken(await signIn(actor))
    const scope = decodeJwtPayload(fullToken)
    const first = await expectActivityCount(request, fixture.adminToken, { userId: actor.userId }, 1)
    const nextIp = '203.0.113.20'
    const constraintName = `qa_sign_in_${randomUUID().replaceAll('-', '')}`
    const table = 'security_sign_in_notification_intents'
    expect(actor.userId).toMatch(/^[0-9a-f-]{36}$/i)
    const actorMatch = `user_id = '${actor.userId}'::uuid`
    const stored = async () => withClient(async (client) => ({
      devices: (await client.query('select id from security_known_devices where tenant_id = $1 and user_id = $2',
        [scope.tenantId, actor.userId])).rows.length,
      intents: (await client.query<{ status: string }>(`select status from ${table} where tenant_id = $1 and user_id = $2`,
        [scope.tenantId, actor.userId])).rows.map((row) => row.status),
      notifications: (await client.query('select id from notifications where tenant_id = $1 and recipient_user_id = $2 and type = $3',
        [scope.tenantId, actor.userId, 'security.sign_in.new_device'])).rows.length,
    }))
    async function withConstraint(condition: string, exercise: () => Promise<void>) {
      await withClient((client) => client.query(`alter table ${table} add constraint ${constraintName} check (${condition}) not valid`))
      try {
        await exercise()
      } finally {
        await withClient((client) => client.query(`alter table ${table} drop constraint if exists ${constraintName}`))
      }
    }

    await withConstraint(`not (${actorMatch})`, async () => {
      await signIn(actor, { userAgent: chromeWindows, ip: nextIp })
      await drainIntegrationQueue('events')
      expect((await getActivity(request, fixture.adminToken, { userId: actor.userId })).items)
        .toEqual([expect.objectContaining({ id: first[0].id })])
      expect(await stored()).toEqual({ devices: 1, intents: [], notifications: 0 })
    })

    await expect.poll(async () => {
      await drainIntegrationQueue('events')
      return (await getActivity(request, fixture.adminToken, { userId: actor.userId })).total
    }, { timeout: 10_000 }).toBe(2)
    expect(await stored()).toEqual({ devices: 2, intents: ['pending'], notifications: 0 })

    const sweep = async () => {
      await enqueueActivityJob('security-sign-in-notification', {})
      await drainIntegrationQueue('security-sign-in-notification')
    }
    await withConstraint(`not (${actorMatch} and status = 'delivered')`, async () => {
      await sweep()
      expect(await stored()).toEqual({ devices: 2, intents: ['pending'], notifications: 1 })
    })
    await sweep()
    expect(await stored()).toEqual({ devices: 2, intents: ['delivered'], notifications: 1 })
  } finally {
    await fixture.dispose()
  }
})
