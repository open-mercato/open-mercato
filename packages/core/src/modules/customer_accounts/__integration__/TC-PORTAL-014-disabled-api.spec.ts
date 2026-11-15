import { expect, test } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { hash } from 'bcryptjs'
import { signAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { withClient, createOrganizationInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { portalLogin, portalCookieHeaders } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

export const integrationMeta = { dependsOnModules: ['customer_accounts', 'portal', 'feature_toggles'] }

test('TC-PORTAL-014: disabling one tenant portal blocks auth and existing sessions without consuming tokens', async ({ request }) => {
  expect(process.env.OM_INTEGRATION_TEST, 'Requires the isolated CLI integration runner').toBe('true')
  const disabledTenantId = randomUUID()
  const enabledTenantId = randomUUID()
  const tenantIds = [disabledTenantId, enabledTenantId]
  const password = 'PortalAccess123!'
  const passwordHash = await hash(password, 10)
  const rawSession = randomUUID()
  const sessionId = randomUUID()
  const userId = randomUUID()
  const magicToken = randomUUID()
  const emailToken = randomUUID()
  const resetToken = randomUUID()
  const invitationToken = randomUUID()
  const digest = (token: string) => createHash('sha256').update(token).digest('hex')
  let createdToggleId: string | null = null

  try {
    await withClient(async (client) => {
      for (const tenantId of tenantIds) {
        await client.query('insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())', [tenantId, `Portal API ${tenantId}`])
      }
      const created = await client.query<{ id: string }>(
        "insert into feature_toggles (id, identifier, name, type, default_value, created_at, updated_at) values (gen_random_uuid(), 'portal_enabled', 'Portal Enabled', 'boolean', 'true'::jsonb, now(), now()) on conflict (identifier) do nothing returning id",
      )
      createdToggleId = created.rows[0]?.id ?? null
      for (const tenantId of tenantIds) {
        await client.query(
          "insert into feature_toggle_overrides (id, toggle_id, tenant_id, value, created_at, updated_at) select gen_random_uuid(), id, $1, $2::jsonb, now(), now() from feature_toggles where identifier = 'portal_enabled' and deleted_at is null",
          [tenantId, JSON.stringify(tenantId === enabledTenantId)],
        )
      }
    })
    const organizationId = await createOrganizationInDb({ tenantId: disabledTenantId, name: 'Disabled portal' })
    const enabledOrganizationId = await createOrganizationInDb({ tenantId: enabledTenantId, name: 'Enabled portal' })
    const email = `disabled-${userId}@example.test`
    const enabledEmail = `enabled-${userId}@example.test`
    await withClient(async (client) => {
      for (const fixture of [
        { id: userId, tenantId: disabledTenantId, organizationId, email },
        { id: randomUUID(), tenantId: enabledTenantId, organizationId: enabledOrganizationId, email: enabledEmail },
      ]) {
        await client.query(
          'insert into customer_users (id, tenant_id, organization_id, email, email_hash, password_hash, display_name, email_verified_at, failed_login_attempts, is_active, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $4, now(), 0, true, now(), now())',
          [fixture.id, fixture.tenantId, fixture.organizationId, fixture.email, hashForLookup(fixture.email), passwordHash],
        )
      }
      await client.query("insert into customer_user_sessions (id, user_id, token_hash, expires_at, created_at) values ($1, $2, $3, now() + interval '1 hour', now())", [sessionId, userId, digest(rawSession)])
      for (const [token, purpose] of [[magicToken, 'magic_link'], [emailToken, 'email_verification']]) {
        await client.query("insert into customer_user_email_verifications (id, user_id, token, purpose, expires_at, created_at) values (gen_random_uuid(), $1, $2, $3, now() + interval '1 hour', now())", [userId, digest(token), purpose])
      }
      await client.query("insert into customer_user_password_resets (id, user_id, token, expires_at, created_at) values (gen_random_uuid(), $1, $2, now() + interval '1 hour', now())", [userId, digest(resetToken)])
      const inviteEmail = `invite-${userId}@example.test`
      await client.query("insert into customer_user_invitations (id, tenant_id, organization_id, email, email_hash, token, expires_at, created_at) values (gen_random_uuid(), $1, $2, $3, $4, $5, now() + interval '1 hour', now())", [disabledTenantId, organizationId, inviteEmail, hashForLookup(inviteEmail), digest(invitationToken)])
    })

    const credentials = { email, password, tenantId: disabledTenantId, organizationId }
    for (const [route, data] of [
      ['login', credentials],
      ['signup', { ...credentials, email: `signup-${userId}@example.test`, displayName: 'Blocked Signup' }],
      ['magic-link/request', { email, tenantId: disabledTenantId }],
      ['magic-link/verify', { token: magicToken }],
      ['invitations/accept', { token: invitationToken, password, displayName: 'Blocked Invite' }],
      ['email/verify', { token: emailToken }],
      ['password/reset-request', { email, tenantId: disabledTenantId }],
      ['password/reset-confirm', { token: resetToken, password: 'ChangedPassword123!' }],
    ] as const) {
      const response = await request.post(`/api/customer_accounts/${route}`, { data })
      expect(response.status(), `${route} must reject the disabled tenant`).toBe(403)
      expect(response.headers()['set-cookie']).toBeUndefined()
    }

    const jwt = signAudienceJwt('customer', { sub: userId, sid: sessionId, type: 'customer', tenantId: disabledTenantId, orgId: organizationId })
    const portalHeaders: Record<string, string>[] = [{ cookie: `customer_auth_token=${jwt}` }, { authorization: `Bearer ${jwt}` }]
    for (const headers of portalHeaders) {
      const response = await request.get('/api/customer_accounts/portal/profile', { headers })
      expect(response.status()).toBe(403)
    }
    const refresh = await request.post('/api/customer_accounts/portal/sessions-refresh', { headers: { cookie: `customer_session_token=${rawSession}` } })
    expect(refresh.status()).toBe(403)
    expect(refresh.headers()['set-cookie']).toBeUndefined()

    const enabledSession = await portalLogin(request, { email: enabledEmail, password, tenantId: enabledTenantId })
    const enabledResponse = await request.post('/api/customer_accounts/portal/feature-check', {
      headers: portalCookieHeaders(enabledSession), data: { features: ['portal.account.manage'] },
    })
    expect(enabledResponse.status()).toBe(200)

    await withClient(async (client) => {
      const tokens = await client.query<{ used_at: string | null }>('select used_at from customer_user_email_verifications where user_id = $1 union all select used_at from customer_user_password_resets where user_id = $1', [userId])
      expect(tokens.rows).toHaveLength(3)
      expect(tokens.rows.every((token) => token.used_at === null)).toBe(true)
      const invitation = await client.query<{ accepted_at: string | null }>('select accepted_at from customer_user_invitations where tenant_id = $1', [disabledTenantId])
      expect(invitation.rows).toEqual([{ accepted_at: null }])
      const users = await client.query<{ count: string }>('select count(*) from customer_users where tenant_id = $1', [disabledTenantId])
      expect(Number(users.rows[0].count)).toBe(1)
    })
  } finally {
    await withClient(async (client) => {
      await client.query('delete from customer_user_invitations where tenant_id = any($1::uuid[])', [tenantIds])
      for (const table of ['customer_user_sessions', 'customer_user_email_verifications', 'customer_user_password_resets']) {
        await client.query(`delete from ${table} where user_id in (select id from customer_users where tenant_id = any($1::uuid[]))`, [tenantIds])
      }
      await client.query('delete from customer_users where tenant_id = any($1::uuid[])', [tenantIds])
      await client.query('delete from feature_toggle_overrides where tenant_id = any($1::uuid[])', [tenantIds])
      await client.query('delete from organizations where tenant_id = any($1::uuid[])', [tenantIds])
      await client.query('delete from tenants where id = any($1::uuid[])', [tenantIds])
      if (createdToggleId) await client.query('delete from feature_toggles where id = $1', [createdToggleId])
    })
  }
})
