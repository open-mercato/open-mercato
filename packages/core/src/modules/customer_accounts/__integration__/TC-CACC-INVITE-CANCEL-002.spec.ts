import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/postgresql'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { createCustomerRoleFixture, customerTestPassword, deleteCustomerRoleFixture, uniqueSuffix } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { deleteUserAclInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { importFromAppRuntime } from '@open-mercato/core/helpers/integration/appRuntime'
import { withNextRuntime } from './helpers/nextRuntime'

const endpoint = '/api/customer_accounts/admin/users-invite'
const eventId = 'customer_accounts.invitation.cancelled'

async function capturedToken(email: string): Promise<string> {
  let token: string | null = null
  await expect.poll(async () => {
    const capturePath = process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim() || join(process.cwd(), '.ai', 'qa', 'email-capture.jsonl')
    const entries = (await readFile(capturePath, 'utf8')).split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { to?: string; links?: string[] })
    const link = entries.filter((entry) => entry.to === email).flatMap((entry) => entry.links ?? [])
      .find((value) => value.includes('/portal/invite?token='))
    token = link ? new URL(link).searchParams.get('token') : null
    return Boolean(token)
  }).toBe(true)
  if (!token) throw new Error('[internal] Invitation token was not captured')
  return token
}

async function runtime() {
  return withNextRuntime(async () => {
    const { bootstrapFromAppRoot } = await importFromAppRuntime<typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')>('@open-mercato/shared/lib/bootstrap/dynamicLoader')
    await bootstrapFromAppRoot(resolveAppRoot())
    const [route, events, bus, telemetry, container, tokens, commandInterceptors, auditEntities, encryption] = await Promise.all([
      importFromAppRuntime<typeof import('../api/admin/users-invite')>('@open-mercato/core/modules/customer_accounts/api/admin/users-invite'),
      importFromAppRuntime<typeof import('@open-mercato/shared/modules/events')>('@open-mercato/shared/modules/events'),
      importFromAppRuntime<typeof import('@open-mercato/events/bus')>('@open-mercato/events/bus'),
      importFromAppRuntime<typeof import('@open-mercato/shared/lib/telemetry/runtime')>('@open-mercato/shared/lib/telemetry/runtime'),
      importFromAppRuntime<typeof import('@open-mercato/shared/lib/di/container')>('@open-mercato/shared/lib/di/container'),
      importFromAppRuntime<typeof import('../lib/tokenGenerator')>('@open-mercato/core/modules/customer_accounts/lib/tokenGenerator'),
      importFromAppRuntime<typeof import('@open-mercato/shared/lib/commands/command-interceptor-store')>('@open-mercato/shared/lib/commands/command-interceptor-store'),
      importFromAppRuntime<typeof import('@open-mercato/core/modules/audit_logs/data/entities')>('@open-mercato/core/modules/audit_logs/data/entities'),
      importFromAppRuntime<typeof import('@open-mercato/shared/lib/encryption/find')>('@open-mercato/shared/lib/encryption/find'),
    ])
    const requestContainer = await container.createRequestContainer()
    return { route, events, bus, telemetry, container, tokens, commandInterceptors, auditEntities, encryption, requestContainer }
  })
}

test.describe('TC-CACC-INVITE-CANCEL-002: real route, command persistence and lifecycle delivery', () => {
  for (const mode of ['new-cancelled', 'reused-cancelled', 'reused-resend'] as const) {
    test(`preserves ${mode} state when in-flight email delivery fails`, async ({ request }) => {
      test.slow()
      const adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenScope(adminToken)
      let roleId: string | null = null
      let invitationId: string | null = null
      try {
        roleId = (await createCustomerRoleFixture(request, adminToken, { customerAssignable: true })).id
        const email = `qa-invite-compensation-${uniqueSuffix()}@test.local`
        const created = await apiRequest(request, 'POST', endpoint, { token: adminToken, data: { email, roleIds: [roleId] } })
        expect(created.status()).toBe(201)
        invitationId = (await created.json() as { invitation: { id: string } }).invitation.id
        const rawToken = await capturedToken(email)
        const app = await runtime()
        const container = await app.container.createRequestContainer()
        const service = container.resolve('customerInvitationService') as import('../services/customerInvitationService').CustomerInvitationService
        const issued = mode === 'new-cancelled'
          ? { invitation: await service.findByToken(rawToken), rawToken, rollbackState: null }
          : await service.createInvitation(email, scope, { roleIds: [roleId], displayName: 'Replacement' })
        if (!issued.invitation) throw new Error('[internal] Created invitation is missing')
        const invitation = issued.invitation
        const expectedToken = app.tokens.hashToken(issued.rawToken)
        let failDelivery!: (error: Error) => void
        const delivery = new Promise<void>((_resolve, reject) => { failDelivery = reject })
        const compensation = delivery.catch(() => service.rollbackInvitation(invitation, issued.rollbackState, expectedToken))
        try {
          if (mode === 'reused-resend') {
            const newer = await service.createInvitation(email, scope, { roleIds: [roleId], displayName: 'Newer resend' })
            expect(app.tokens.hashToken(newer.rawToken) === expectedToken, 'new resend rotates the verifier').toBe(false)
          } else {
            expect((await apiRequest(request, 'DELETE', `${endpoint}?id=${invitationId}`, { token: adminToken })).status()).toBe(200)
          }
          const before = await withClient((client) => client.query<Record<string, unknown>>(
            'select token, cancelled_at, accepted_at, expires_at, display_name, role_ids_json from customer_user_invitations where id = $1', [invitationId],
          ))
          expect(before.rows).toHaveLength(1)
          expect(before.rows[0].cancelled_at === null).toBe(mode === 'reused-resend')
          failDelivery(new Error('[internal] Injected email failure after concurrent transition'))
          await compensation
          const after = await withClient((client) => client.query<Record<string, unknown>>(
            'select token, cancelled_at, accepted_at, expires_at, display_name, role_ids_json from customer_user_invitations where id = $1', [invitationId],
          ))
          expect(after.rows).toEqual(before.rows)
        } finally {
          failDelivery(new Error('[internal] Finish delivery simulation'))
          await compensation
        }
      } finally {
        if (invitationId) await withClient(async (client) => {
          await client.query('delete from action_logs where command_id = $1 and resource_id = $2', ['customer_accounts.invitation.cancel', invitationId])
          await client.query('delete from customer_user_invitations where id = $1', [invitationId])
        })
        await deleteCustomerRoleFixture(request, adminToken, roleId)
      }
    })
  }

  for (const failure of ['none', 'event', 'event-and-reporting'] as const) {
    test(`persists one non-replayable audit entry with ${failure} failure`, async ({ request }) => {
      test.slow()
      const adminToken = await getAuthToken(request, 'admin')
      const adminScope = getTokenScope(adminToken)
      let staffId: string | null = null
      let roleId: string | null = null
      let invitationId: string | null = null
      let restoreRuntime: (() => void) | undefined
      let stopTap: (() => void) | undefined
      try {
        const staffEmail = `qa-invite-audit-staff-${uniqueSuffix()}@test.local`
        const password = customerTestPassword()
        staffId = await createUserFixture(request, adminToken, { email: staffEmail, password, organizationId: adminScope.organizationId, roles: [] })
        await setUserAclInDb({ userId: staffId, tenantId: adminScope.tenantId, features: ['customer_accounts.*'], organizations: [adminScope.organizationId] })
        const staffToken = await getAuthToken(request, staffEmail, password)
        const scope = getTokenScope(staffToken)
        roleId = (await createCustomerRoleFixture(request, adminToken, { customerAssignable: true })).id
        const email = `qa-invite-audit-${uniqueSuffix()}@test.local`
        const created = await apiRequest(request, 'POST', endpoint, { token: adminToken, data: { email, roleIds: [roleId] } })
        expect(created.status()).toBe(201)
        invitationId = (await created.json() as { invitation: { id: string } }).invitation.id
        const rawToken = await capturedToken(email)
        const { rows: [before] } = await withClient((client) => client.query<{ token: string }>(
          'select token from customer_user_invitations where id = $1', [invitationId],
        ))
        const app = await runtime()
        const originalBus = app.events.getGlobalEventBus()
        expect(originalBus).not.toBeNull()
        if (!originalBus) throw new Error('[internal] Bootstrapped event bus is missing')
        const originalInterceptors = app.commandInterceptors.getAllCommandInterceptors()
          .map(({ moduleId, interceptor }) => ({ moduleId, interceptors: [interceptor] }))
        const originalTelemetry = app.telemetry.getTelemetryRuntime()
        const deliveries: unknown[] = []
        let attempts = 0
        let reports = 0
        stopTap = app.bus.registerGlobalEventTap((event, payload, options) => {
          if (event === eventId) deliveries.push({ payload, tenantId: options?.tenantId, organizationId: options?.organizationId })
        })
        const unregisterTelemetry = app.telemetry.registerTelemetryRuntime({
          canUseGlobalTracePropagation: () => false,
          captureTraceContext: () => ({}),
          continueTrace: (_carrier, _name, operation) => operation(),
          recordHttpDuration: () => undefined,
          reportError: (_error, context) => {
            if (context?.code !== 'customer_accounts.invitation_cancel_event_failed') return
            reports += 1
            if (failure === 'event-and-reporting') throw new Error('[internal] Injected reporting failure')
          },
          shutdown: async () => undefined,
        })
        app.commandInterceptors.registerCommandInterceptors([
          ...originalInterceptors,
          {
            moduleId: 'customer_accounts',
            interceptors: [{
              id: 'customer_accounts.test.cancel-event-failure',
              targetCommand: 'customer_accounts.invitation.cancel',
              async beforeExecute() {
                app.events.setGlobalEventBus({
                  async emit(event, payload, options) {
                    if (event === eventId) {
                      attempts += 1
                      if (failure !== 'none') throw new Error('[internal] Injected event transport failure')
                    }
                    await originalBus.emit(event, payload, options)
                  },
                })
              },
            }],
          },
        ])
        restoreRuntime = () => {
          app.commandInterceptors.registerCommandInterceptors(originalInterceptors)
          app.events.setGlobalEventBus(originalBus)
          unregisterTelemetry()
          if (originalTelemetry) app.telemetry.registerTelemetryRuntime(originalTelemetry)
        }

        for (let occurrence = 0; occurrence < 2; occurrence += 1) {
          const response = await app.route.DELETE(new Request(`http://localhost${endpoint}?id=${invitationId}`, {
            method: 'DELETE', headers: { authorization: `Bearer ${staffToken}`, cookie: `om_selected_org=${randomUUID()}` },
          }))
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ ok: true })
          const entries = await app.encryption.findWithDecryption(
            app.requestContainer.resolve<EntityManager>('em').fork(),
            app.auditEntities.ActionLog,
            { resourceId: invitationId, tenantId: scope.tenantId, organizationId: scope.organizationId },
            undefined,
            scope,
          )
          const rows = entries.filter((entry) => entry.commandId === 'customer_accounts.invitation.cancel')
          expect(rows).toHaveLength(1)
          expect(rows[0]).toMatchObject({
            tenantId: scope.tenantId, organizationId: scope.organizationId, actorUserId: scope.userId,
            resourceKind: 'customer_accounts:customer_user_invitation', resourceId: invitationId,
            undoToken: null, commandPayload: null, snapshotBefore: null, snapshotAfter: null,
            executionState: 'done',
          })
          expect(rows[0].actionLabel).toBeTruthy()
          expect(attempts).toBe(1)
          expect(reports).toBe(failure === 'none' ? 0 : 1)
          expect(deliveries).toEqual(failure === 'none' ? [{
            payload: { invitationId, tenantId: scope.tenantId, organizationId: scope.organizationId },
            tenantId: scope.tenantId, organizationId: scope.organizationId,
          }] : [])
          const serialized = JSON.stringify({ rows, deliveries })
          expect(serialized.includes(email), 'audit and event omit the recipient').toBe(false)
          expect(serialized.includes(before.token), 'audit and event omit the stored token verifier').toBe(false)
          expect(serialized.includes(rawToken), 'audit and event omit the emailed token').toBe(false)
        }
        const { rows: [after] } = await withClient((client) => client.query<{ cancelled_at: Date | null }>(
          'select cancelled_at from customer_user_invitations where id = $1', [invitationId],
        ))
        expect(after.cancelled_at).not.toBeNull()
      } finally {
        restoreRuntime?.()
        stopTap?.()
        if (staffId) await deleteUserAclInDb(staffId)
        await deleteUserIfExists(request, adminToken, staffId)
        if (invitationId) await withClient(async (client) => {
          await client.query('delete from action_logs where resource_id = $1 and tenant_id = $2 and organization_id = $3', [invitationId, adminScope.tenantId, adminScope.organizationId])
          await client.query('delete from customer_user_invitations where id = $1', [invitationId])
        })
        await deleteCustomerRoleFixture(request, adminToken, roleId)
      }
    })
  }
})
