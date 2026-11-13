import { randomUUID } from 'node:crypto'
import { test, expect, request as http, type APIRequestContext } from '@playwright/test'
import { startRlsLiveRuntime } from './helpers/liveRuntime'
import { createPublicCapabilityFixtures } from './helpers/publicCapabilityFixtures'

test.describe('TC-RLS-004: persisted public capabilities under restricted FORCE RLS', () => {
  test('signup links only own CRM person; reset capability ignores foreign cookies and is consumed once', async () => {
    const previousDelivery = process.env.OM_EVENTS_SINGLE_DELIVERY
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'false'
    const runtime = await startRlsLiveRuntime().finally(() => {
      if (previousDelivery === undefined) delete process.env.OM_EVENTS_SINGLE_DELIVERY
      else process.env.OM_EVENTS_SINGLE_DELIVERY = previousDelivery
    })
    let fixtures: Awaited<ReturnType<typeof createPublicCapabilityFixtures>> | undefined
    const contexts: APIRequestContext[] = []
    try {
      fixtures = await createPublicCapabilityFixtures(runtime)
      const fixture = fixtures
      const anonymous = await http.newContext({ baseURL: runtime.baseUrl })
      contexts.push(anonymous)
      const foreign = await http.newContext({ baseURL: runtime.baseUrl, extraHTTPHeaders: {
        Cookie: `auth_token=${runtime.second.token}; customer_auth_token=${runtime.customerToken}; om_selected_tenant=${runtime.second.tenantId}; om_selected_org=${runtime.second.orgId}`,
      } })
      contexts.push(foreign)
      const baseline = await fixture.retainedPeople()
      const signup = { email: fixture.email, password: fixture.password, displayName: 'RLS public account', tenantId: runtime.first.tenantId, organizationId: runtime.first.orgId }
      const forged = await anonymous.post('/api/customer_accounts/signup', { data: { ...signup, organizationId: runtime.second.orgId } })
      expect(forged.status()).toBe(400)
      expect(await fixture.users()).toEqual([])
      const accepted = await foreign.post('/api/customer_accounts/signup', { data: signup })
      expect(accepted.status()).toBe(202)
      await expect.poll(async () => (await fixture.users()).map((user) => user.person_entity_id)).toEqual([fixture.personIds[0]])
      const [user] = await fixture.users()
      expect(user).toMatchObject({ tenant_id: runtime.first.tenantId, organization_id: runtime.first.orgId, email_verified_at: null })
      expect((await anonymous.post('/api/customer_accounts/login', { data: { ...signup } })).status()).toBe(401)
      expect(await fixture.sessions()).toEqual([])

      const issue = await anonymous.post(`/api/customer_accounts/admin/users/${user.id}/send-reset-link`, { headers: { Authorization: `Bearer ${runtime.first.token}` } })
      expect(issue.status()).toBe(200)
      const issued: unknown = await issue.json()
      if (!issued || typeof issued !== 'object' || !('resetLink' in issued) || typeof issued.resetLink !== 'string') throw new Error('[internal] Reset link response missing')
      const rawToken = new URL(issued.resetLink, runtime.baseUrl).searchParams.get('token')
      if (!rawToken) throw new Error('[internal] Reset capability missing')
      expect(await fixture.tokenState(rawToken)).toEqual([{ user_id: user.id, used_at: null }])
      const invalid = await foreign.post('/api/customer_accounts/password/reset-confirm', { data: { token: randomUUID(), password: fixture.nextPassword, tenantId: runtime.first.tenantId, organizationId: runtime.first.orgId } })
      expect(invalid.status()).toBe(400)
      expect(await fixture.tokenState(rawToken)).toEqual([{ user_id: user.id, used_at: null }])
      const confirmed = await foreign.post('/api/customer_accounts/password/reset-confirm', { data: { token: rawToken, password: fixture.nextPassword, tenantId: runtime.second.tenantId, organizationId: runtime.second.orgId } })
      expect(confirmed.status()).toBe(200)
      const consumed = await fixture.tokenState(rawToken)
      expect(consumed).toEqual([{ user_id: user.id, used_at: expect.any(Date) }])
      expect(await fixture.users()).toEqual([{ ...user, email_verified_at: expect.any(Date) }])
      const replay = await anonymous.post('/api/customer_accounts/password/reset-confirm', { data: { token: rawToken, password: fixture.password } })
      expect(replay.status()).toBe(400)
      expect(await fixture.tokenState(rawToken)).toEqual(consumed)
      const foreignLogin = await anonymous.post('/api/customer_accounts/login', { data: { email: fixture.email, password: fixture.nextPassword, tenantId: runtime.second.tenantId, organizationId: runtime.second.orgId } })
      expect(foreignLogin.status()).toBe(401)
      const login = await anonymous.post('/api/customer_accounts/login', { data: { email: fixture.email, password: fixture.nextPassword, tenantId: runtime.first.tenantId, organizationId: runtime.first.orgId } })
      expect(login.status()).toBe(200)
      expect(await login.json()).toMatchObject({ ok: true, user: { id: user.id, emailVerified: true }, resolvedFeatures: expect.arrayContaining(['portal.account.manage']) })
      expect(await fixture.sessions()).toEqual([{ user_id: user.id }])
      expect(await fixture.retainedPeople()).toEqual(baseline)
    } finally {
      try { await Promise.all(contexts.map((context) => context.dispose())) } finally {
        try { await fixtures?.cleanup() } finally { await runtime.stop() }
      }
    }
  })
})
