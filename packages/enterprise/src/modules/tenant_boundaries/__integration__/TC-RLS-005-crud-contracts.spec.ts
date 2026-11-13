import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { z } from 'zod'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { startRlsLiveRuntime } from './helpers/liveRuntime'
import { createCrudContractFixtures } from './helpers/crudContractFixtures'

const detailSchema = z.object({
  person: z.object({ id: z.string().uuid(), displayName: z.string(), updatedAt: z.string(), tenantId: z.string().uuid(), organizationId: z.string().uuid() }),
  customFields: z.record(z.string(), z.unknown()),
})

async function detail(context: APIRequestContext, id: string) {
  const response = await context.get(`/api/customers/people/${id}`)
  expect(response.status()).toBe(200)
  return detailSchema.parse(await response.json())
}

test('TC-RLS-005: People HTTP preserves custom fields, encryption, guards and command audit under FORCE RLS', async ({ playwright }) => {
  test.setTimeout(240_000)
  expect(isTenantDataEncryptionEnabled(), 'Required encryption acceptance: use TENANT_DATA_ENCRYPTION=yes').toBe(true)
  expect(Boolean(process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY?.trim() || process.env.TENANT_DATA_ENCRYPTION_KEY?.trim() || (process.env.VAULT_ADDR && process.env.VAULT_TOKEN)),
    'Production next start requires an explicit TENANT_DATA_ENCRYPTION_FALLBACK_KEY or healthy VAULT_ADDR/VAULT_TOKEN; ALLOW_DERIVED_KMS_FALLBACK alone is insufficient').toBe(true)
  const runtime = await startRlsLiveRuntime()
  const contexts: APIRequestContext[] = []
  let fixtures: Awaited<ReturnType<typeof createCrudContractFixtures>> | undefined
  try {
    fixtures = await createCrudContractFixtures(runtime)
    expect(runtime.configuration.rlsEnabled).toBe(true)
    const definitions = await fixtures.definitions()
    expect(definitions).toHaveLength(4)
    for (const actor of [runtime.first, runtime.second]) {
      expect(definitions.filter((definition) => definition.tenant_id === actor.tenantId)).toEqual(expect.arrayContaining([
        expect.objectContaining({ organization_id: actor.orgId, key: fixtures.key, config_json: expect.objectContaining({ encrypted: false }) }),
        expect.objectContaining({ organization_id: actor.orgId, key: fixtures.secretKey, config_json: expect.objectContaining({ encrypted: true }) }),
      ]))
      contexts.push(await playwright.request.newContext({ baseURL: runtime.baseUrl, extraHTTPHeaders: { Authorization: `Bearer ${actor.token}` }, timeout: 30_000 }))
    }
    const anonymous = await playwright.request.newContext({ baseURL: runtime.baseUrl, timeout: 30_000 })
    contexts.push(anonymous)
    const records: { id: string; name: string; secret: string }[] = []
    for (const [index, actor] of [runtime.first, runtime.second].entries()) {
      const name = `RLS contract ${randomUUID()}`
      const secret = `private-${randomUUID()}`
      const created = await contexts[index].post('/api/customers/people', { data: {
        firstName: name, lastName: 'Contract', displayName: name,
        customFields: { [fixtures.key]: `tenant-${index}`, [fixtures.secretKey]: secret },
      } })
      expect(created.status()).toBe(201)
      const { id } = z.object({ id: z.string().uuid() }).parse(await created.json())
      records.push({ id, name, secret })
      const own = await detail(contexts[index], id)
      expect(own.person).toMatchObject({ id, displayName: name, tenantId: actor.tenantId, organizationId: actor.orgId })
      expect(own.customFields).toMatchObject({ [fixtures.key]: `tenant-${index}`, [fixtures.secretKey]: secret })
      const listed = await contexts[index].get(`/api/customers/people?id=${id}&pageSize=100`)
      expect(listed.status()).toBe(200)
      expect(z.object({ items: z.array(z.object({ id: z.string() })) }).parse(await listed.json()).items).toEqual([{ id }])
      const values = await fixtures.values(actor.tenantId)
      expect(values).toHaveLength(2)
      expect(values).toEqual(expect.arrayContaining([expect.objectContaining({ tenant_id: actor.tenantId, organization_id: actor.orgId, field_key: fixtures.key, value_text: `tenant-${index}` })]))
      const ciphertext = values.find((value) => value.field_key === fixtures!.secretKey)?.value_text
      expect(ciphertext).toBeTruthy()
      expect(ciphertext).not.toBe(secret)
      expect(isEncryptedPayloadShape(ciphertext)).toBe(true)
    }
    for (const [index, actor] of [runtime.first, runtime.second].entries()) {
      const context = contexts[index]
      const own = records[index]
      const foreign = records[1 - index]
      const beforeForeign = await fixtures.person(foreign.id)
      const foreignTenantId = index === 0 ? runtime.second.tenantId : runtime.first.tenantId
      const foreignValues = await fixtures.values(foreignTenantId)
      const foreignCommands = await fixtures.commands(foreignTenantId, foreign.id)
      const foreignDetail = await context.get(`/api/customers/people/${foreign.id}`)
      expect([403, 404]).toContain(foreignDetail.status())
      expect(await foreignDetail.text()).not.toContain(foreign.secret)
      const foreignList = await context.get(`/api/customers/people?id=${foreign.id}`)
      expect(foreignList.status()).toBe(200)
      expect(z.object({ items: z.array(z.unknown()) }).parse(await foreignList.json()).items).toEqual([])
      expect([403, 404]).toContain((await context.put('/api/customers/people', { data: { id: foreign.id, displayName: 'Forbidden', customFields: { [fixtures.key]: 'forbidden' } } })).status())
      expect([403, 404]).toContain((await context.delete(`/api/customers/people?id=${foreign.id}`)).status())
      expect(await fixtures.person(foreign.id)).toEqual(beforeForeign)
      expect(await fixtures.values(foreignTenantId)).toEqual(foreignValues)
      expect(await fixtures.commands(foreignTenantId, foreign.id)).toEqual(foreignCommands)
      const initial = await detail(context, own.id)
      const beforeGuard = await fixtures.person(own.id)
      const auditBeforeGuard = await fixtures.commands(actor.tenantId, own.id)
      const denied = await anonymous.put('/api/customers/people', { data: { id: own.id, displayName: 'Unauthenticated' } })
      expect(denied.status()).toBe(401)
      expect(await fixtures.person(own.id)).toEqual(beforeGuard)
      expect(await fixtures.commands(actor.tenantId, own.id)).toEqual(auditBeforeGuard)
      const updatedSecret = `${own.secret}-updated`
      const updated = await context.put('/api/customers/people', { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: initial.person.updatedAt }, data: {
        id: own.id, displayName: `${own.name} updated`, customFields: { [fixtures.key]: `updated-${index}`, [fixtures.secretKey]: updatedSecret },
      } })
      expect(updated.status()).toBe(200)
      const winner = await detail(context, own.id)
      expect(winner.person.displayName).toBe(`${own.name} updated`)
      expect(winner.customFields).toMatchObject({ [fixtures.key]: `updated-${index}`, [fixtures.secretKey]: updatedSecret })
      const updatedValues = await fixtures.values(actor.tenantId)
      expect(updatedValues).toHaveLength(2)
      expect(updatedValues.find((value) => value.field_key === fixtures!.key)?.value_text).toBe(`updated-${index}`)
      const updatedCiphertext = updatedValues.find((value) => value.field_key === fixtures!.secretKey)?.value_text
      expect(updatedCiphertext).not.toBe(updatedSecret)
      expect(isEncryptedPayloadShape(updatedCiphertext)).toBe(true)
      const beforeStale = await fixtures.person(own.id)
      const auditBeforeStale = await fixtures.commands(actor.tenantId, own.id)
      for (const method of ['PUT', 'DELETE'] as const) {
        const response = await context.fetch(`/api/customers/people${method === 'DELETE' ? `?id=${own.id}` : ''}`, {
          method, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: initial.person.updatedAt },
          ...(method === 'PUT' ? { data: { id: own.id, displayName: 'Stale loser' } } : {}),
        })
        expect(response.status()).toBe(409)
        expect(await response.json()).toMatchObject({ code: 'optimistic_lock_conflict', expectedUpdatedAt: initial.person.updatedAt })
      }
      expect(await fixtures.person(own.id)).toEqual(beforeStale)
      expect(await fixtures.commands(actor.tenantId, own.id)).toEqual(auditBeforeStale)
      expect((await detail(context, own.id)).customFields).toEqual(winner.customFields)
    }
    for (const [index, actor] of [runtime.first, runtime.second].entries()) {
      const context = contexts[index]
      const own = records[index]
      const winner = await detail(context, own.id)
      const deleted = await context.delete(`/api/customers/people?id=${own.id}`, { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: winner.person.updatedAt } })
      expect(deleted.ok()).toBe(true)
      expect((await context.get(`/api/customers/people/${own.id}`)).status()).toBe(404)
      const afterDelete = await context.get(`/api/customers/people?id=${own.id}`)
      expect(afterDelete.status()).toBe(200)
      expect(z.object({ items: z.array(z.unknown()) }).parse(await afterDelete.json()).items).toEqual([])
      expect(await fixtures.person(own.id)).toEqual([])
      const commands = await fixtures.commands(actor.tenantId, own.id)
      for (const command of ['create', 'update', 'delete']) {
        expect(commands.filter((entry) => entry.command_id === `customers.people.${command}` && entry.execution_state === 'done' && entry.actor_user_id === actor.userId)).toHaveLength(1)
      }
    }
  } finally {
    try { await Promise.all(contexts.map((context) => context.dispose())) } finally {
      try { await fixtures?.cleanup() } finally { await runtime.stop() }
    }
  }
})
