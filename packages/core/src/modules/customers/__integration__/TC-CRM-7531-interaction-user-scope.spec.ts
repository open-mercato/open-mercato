import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const INTERACTIONS = '/api/customers/interactions'
const ACTIVITIES = '/api/customers/activities'

type Scope = { token: string; tenantId?: string; organizationId?: string }
type CreatedRecord = { path: string; id: string; scope: Scope }
type UserFixture = { id: string; name: string; email: string }
type InteractionItem = {
  id: string
  authorUserId: string | null
  ownerUserId?: string | null
  authorName: string | null
  authorEmail: string | null
  title?: string | null
  subject?: string | null
  updatedAt?: string
}
type Fixtures = {
  marker: string
  actor: Scope
  home: Scope
  local: UserFixture
  sibling: UserFixture
  foreign: UserFixture[]
  create: (scope: Scope, path: string, input: Record<string, unknown>) => Promise<string>
}

function scopedRequest(request: APIRequestContext, scope: Scope, method: string, path: string, data?: unknown) {
  const cookies = [
    scope.tenantId ? `om_selected_tenant=${scope.tenantId}` : null,
    scope.organizationId ? `om_selected_org=${scope.organizationId}` : null,
  ].filter((value): value is string => value !== null)
  return apiRequest(request, method, path, { token: scope.token, data, headers: { Cookie: cookies.join('; ') } })
}

async function withFixtures(request: APIRequestContext, run: (fixtures: Fixtures) => Promise<void>) {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const actorToken = await getAuthToken(request, 'admin')
  const context = getTokenContext(actorToken)
  expectId(context.tenantId, 'actor tenant')
  expectId(context.organizationId, 'actor organization')
  const actor: Scope = { token: actorToken, ...context }
  const root: Scope = { token: superadminToken }
  const home: Scope = { token: superadminToken, ...context }
  const marker = `tc7531-${randomUUID()}`
  const records: CreatedRecord[] = []
  const create = async (scope: Scope, path: string, input: Record<string, unknown>): Promise<string> => {
    const response = await scopedRequest(request, scope, 'POST', path, input)
    const body = await readJsonSafe<{ id?: string }>(response)
    if (typeof body?.id === 'string') records.push({ path, id: body.id, scope })
    expect(response.status(), `POST ${path} should create the fixture`).toBe(201)
    return expectId(body?.id, `${path} fixture id`)
  }
  const createUser = async (scope: Scope, suffix: string): Promise<UserFixture> => {
    const name = `${marker}-${suffix}`
    const email = `${name}@example.com`
    const id = await create(scope, '/api/auth/users', {
      name, email, password: 'StrongSecret123!', tenantId: scope.tenantId, organizationId: scope.organizationId,
    })
    return { id, name, email }
  }

  try {
    const tenantId = await create(root, '/api/directory/tenants', { name: `${marker}-tenant` })
    const siblingOrganizationId = await create(root, '/api/directory/organizations', {
      name: `${marker}-sibling`, tenantId: context.tenantId,
    })
    const foreignOrganizationId = await create(root, '/api/directory/organizations', {
      name: `${marker}-foreign`, tenantId,
    })
    const local = await createUser(home, 'local')
    const sibling = await createUser({ token: superadminToken, tenantId: context.tenantId, organizationId: siblingOrganizationId }, 'sibling')
    const foreign = await createUser({ token: superadminToken, tenantId, organizationId: foreignOrganizationId }, 'foreign')
    await run({ marker, actor, home, local, sibling, foreign: [foreign], create })
  } finally {
    const errors: string[] = []
    for (const record of records.reverse()) {
      try {
        const response = await scopedRequest(request, record.scope, 'DELETE', `${record.path}?id=${encodeURIComponent(record.id)}`, { id: record.id })
        if (response.status() !== 200 && response.status() !== 404) errors.push(`${record.path}: ${response.status()}`)
      } catch {
        errors.push(`${record.path}: transport failure`)
      }
    }
    expect(errors, 'all created fixtures should be removed').toEqual([])
  }
}

async function listItems(request: APIRequestContext, scope: Scope, path: string): Promise<InteractionItem[]> {
  const response = await scopedRequest(request, scope, 'GET', path)
  expect(response.status(), `GET ${path} should succeed`).toBe(200)
  const body = await readJsonSafe<{ items: InteractionItem[] }>(response)
  expect(Array.isArray(body?.items), 'list response should expose items').toBe(true)
  return body?.items ?? []
}

for (const field of ['authorUserId', 'ownerUserId'] as const) {
  test(`TC-CRM-7531: canonical ${field} rejects foreign users and permits same-scope references and clearing`, async ({ request }) => {
    await withFixtures(request, async (fixtures) => {
      const { actor, home, marker, local, sibling, foreign, create } = fixtures
      const entityId = await create(home, '/api/customers/people', { firstName: 'Scope', lastName: marker, displayName: marker })
      const input = { entityId, interactionType: 'note', title: marker, authorUserId: local.id, ownerUserId: local.id }
      const interactionId = await create(home, INTERACTIONS, input)
      const path = `${INTERACTIONS}?entityId=${entityId}&limit=100`
      const before = (await listItems(request, actor, path)).find((item) => item.id === interactionId)
      expect(before, 'valid reference should be visible').toMatchObject({ authorUserId: local.id, ownerUserId: local.id })

      for (const userId of [...foreign.map((user) => user.id), randomUUID()]) {
        const rejectedCreate = await scopedRequest(request, actor, 'POST', INTERACTIONS, { ...input, [field]: userId })
        const createBody = await readJsonSafe<{ id?: string }>(rejectedCreate)
        if (createBody?.id) await scopedRequest(request, home, 'DELETE', `${INTERACTIONS}?id=${encodeURIComponent(createBody.id)}`, { id: createBody.id })
        expect(rejectedCreate.status(), `create should reject unavailable ${field}`).toBe(400)
        const rejectedUpdate = await scopedRequest(request, actor, 'PUT', INTERACTIONS, {
          id: interactionId, title: `${marker}-rejected`, [field]: userId,
        })
        expect(rejectedUpdate.status(), `update should reject unavailable ${field}`).toBe(400)
      }
      const after = (await listItems(request, actor, path)).find((item) => item.id === interactionId)
      expect(after, 'rejected updates should not change the interaction').toEqual(before)

      const siblingInteractionId = await create(home, INTERACTIONS, { ...input, [field]: sibling.id })
      expect((await listItems(request, actor, path)).find((item) => item.id === siblingInteractionId)?.[field], 'same-tenant cross-organization references remain valid').toBe(sibling.id)
      const siblingUpdate = await scopedRequest(request, actor, 'PUT', INTERACTIONS, { id: interactionId, [field]: sibling.id })
      expect(siblingUpdate.status(), 'same-tenant users from another organization remain assignable').toBe(200)
      expect((await listItems(request, actor, path)).find((item) => item.id === interactionId)?.[field]).toBe(sibling.id)
      const accepted = await scopedRequest(request, actor, 'PUT', INTERACTIONS, { id: interactionId, [field]: local.id })
      expect(accepted.status(), 'a same-scope user remains assignable').toBe(200)
      const cleared = await scopedRequest(request, actor, 'PUT', INTERACTIONS, { id: interactionId, [field]: null })
      expect(cleared.status(), 'an optional reference remains clearable').toBe(200)
      const current = (await listItems(request, actor, path)).find((item) => item.id === interactionId)
      expect(current?.[field]).toBeNull()
    })
  })
}

test('TC-CRM-7531: legacy activity create and update reject foreign authors', async ({ request }) => {
  await withFixtures(request, async ({ actor, home, marker, local, sibling, foreign, create }) => {
    const entityId = await create(home, '/api/customers/people', { firstName: 'Scope', lastName: marker, displayName: marker })
    const input = { entityId, activityType: 'note', subject: marker, authorUserId: local.id }
    const interactionId = await create(home, ACTIVITIES, input)
    const path = `${ACTIVITIES}?entityId=${entityId}&pageSize=100`
    const before = (await listItems(request, actor, path)).find((item) => item.id === interactionId)
    expect(before).toMatchObject({ authorUserId: local.id, authorName: local.name, authorEmail: local.email })
    for (const userId of [...foreign.map((user) => user.id), randomUUID()]) {
      const rejectedCreate = await scopedRequest(request, actor, 'POST', ACTIVITIES, { ...input, authorUserId: userId })
      const created = await readJsonSafe<{ id?: string }>(rejectedCreate)
      if (created?.id) await scopedRequest(request, home, 'DELETE', `${ACTIVITIES}?id=${encodeURIComponent(created.id)}`, { id: created.id })
      expect(rejectedCreate.status(), 'legacy create should reject an unavailable author').toBe(400)
      const rejectedUpdate = await scopedRequest(request, actor, 'PUT', ACTIVITIES, {
        id: interactionId, subject: `${marker}-rejected`, authorUserId: userId,
      })
      expect(rejectedUpdate.status(), 'legacy update should reject an unavailable author').toBe(400)
    }
    expect((await listItems(request, actor, path)).find((item) => item.id === interactionId)).toEqual(before)
    const siblingInteractionId = await create(home, ACTIVITIES, { ...input, authorUserId: sibling.id })
    expect((await listItems(request, actor, path)).find((item) => item.id === siblingInteractionId)).toMatchObject({ authorName: sibling.name, authorEmail: sibling.email })
    const siblingUpdate = await scopedRequest(request, actor, 'PUT', ACTIVITIES, { id: interactionId, authorUserId: sibling.id })
    expect(siblingUpdate.status(), 'legacy updates should accept a same-tenant author from another organization').toBe(200)
    const accepted = await scopedRequest(request, actor, 'PUT', ACTIVITIES, { id: interactionId, authorUserId: local.id })
    expect(accepted.status(), 'legacy updates should accept a same-scope author').toBe(200)
  })
})

for (const entityKind of ['people', 'companies'] as const) {
  test(`TC-CRM-7531: ${entityKind} reads hide foreign profiles on poisoned canonical and historical activity rows`, async ({ request }) => {
    await withFixtures(request, async ({ actor, home, marker, local, sibling, foreign, create }) => {
      const entityId = await create(home, `/api/customers/${entityKind}`, {
        displayName: marker, ...(entityKind === 'people' ? { firstName: 'Scope', lastName: marker } : {}),
      })
      const legacyIds: string[] = []
      const poisonedIds: string[] = []
      const validId = await create(home, ACTIVITIES, { entityId, activityType: 'note', subject: `${marker}-valid`, authorUserId: local.id })
      const siblingId = await create(home, ACTIVITIES, { entityId, activityType: 'note', subject: `${marker}-sibling`, authorUserId: sibling.id })
      const offboarded = { name: `${marker}-offboarded`, email: `${marker}-offboarded@example.com` }
      const offboardedUserId = await create(home, '/api/auth/users', { ...offboarded, password: 'StrongSecret123!', tenantId: actor.tenantId, organizationId: actor.organizationId })
      const offboardedId = await create(home, ACTIVITIES, { entityId, activityType: 'note', subject: `${marker}-history`, authorUserId: offboardedUserId })

      try {
        await withClient(async (client) => {
          const offboardedUser = await client.query<{ id: string; deleted_at: Date | null }>(
            'update users set deleted_at = now() where id = $1 and tenant_id = $2 and organization_id = $3 and deleted_at is null returning id, deleted_at',
            [offboardedUserId, actor.tenantId, actor.organizationId],
          )
          expect(offboardedUser.rowCount, 'exactly the owned author fixture should be soft-deleted').toBe(1)
          expect(offboardedUser.rows[0]?.id).toBe(offboardedUserId)
          expect(offboardedUser.rows[0]?.deleted_at).toBeTruthy()
        })
        for (const user of foreign) {
          const canonicalId = await create(home, ACTIVITIES, { entityId, activityType: 'note', subject: marker, authorUserId: local.id })
          const legacyId = randomUUID()
          legacyIds.push(legacyId)
          poisonedIds.push(canonicalId, legacyId)
          await withClient(async (client) => {
            const updated = await client.query(
              'update customer_interactions set author_user_id = $1, owner_user_id = $1 where id = $2 and tenant_id = $3 and organization_id = $4',
              [user.id, canonicalId, actor.tenantId, actor.organizationId],
            )
            expect(updated.rowCount, 'only the owned canonical fixture should be poisoned').toBe(1)
            await client.query(
              'insert into customer_activities (id, tenant_id, organization_id, entity_id, activity_type, subject, author_user_id, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, now(), now())',
              [legacyId, actor.tenantId, actor.organizationId, entityId, 'note', marker, user.id],
            )
          })
        }
        const canonical = await listItems(request, actor, `${INTERACTIONS}?entityId=${entityId}&limit=100`)
        const activities = await listItems(request, actor, `${ACTIVITIES}?entityId=${entityId}&pageSize=100`)
        const detailResponse = await scopedRequest(request, actor, 'GET', `/api/customers/${entityKind}/${entityId}?include=activities,interactions`)
        expect(detailResponse.status(), 'entity detail should remain readable').toBe(200)
        const detail = await readJsonSafe<{ activities: InteractionItem[]; interactions: InteractionItem[] }>(detailResponse)
        for (const rows of [canonical, activities, detail?.activities ?? [], detail?.interactions ?? []]) {
          expect(rows.find((item) => item.id === validId), 'same-scope profile enrichment remains available').toMatchObject({
            authorName: local.name, authorEmail: local.email,
          })
          expect(rows.find((item) => item.id === siblingId), 'same-tenant cross-organization attribution remains readable').toMatchObject({ authorName: sibling.name, authorEmail: sibling.email })
          expect(rows.find((item) => item.id === offboardedId), 'offboarded authors retain historical attribution').toMatchObject({ authorName: offboarded.name, authorEmail: offboarded.email })
          for (const item of rows.filter((item) => poisonedIds.includes(item.id))) {
            expect(item, `foreign profile on ${item.id} should be unavailable`).toMatchObject({ authorName: null, authorEmail: null })
          }
        }
        for (const id of poisonedIds) {
          expect(activities.some((item) => item.id === id), 'compatibility list should retain every historical item').toBe(true)
          expect(detail?.activities.some((item) => item.id === id), 'entity detail should retain every historical item').toBe(true)
        }
        for (const id of poisonedIds.filter((id) => !legacyIds.includes(id))) {
          expect(canonical.some((item) => item.id === id), 'canonical list should retain poisoned canonical rows').toBe(true)
          expect(detail?.interactions.some((item) => item.id === id), 'detail interactions should retain canonical rows').toBe(true)
        }
      } finally {
        await withClient(async (client) => {
          const restoredUser = await client.query(
            'update users set deleted_at = null where id = $1 and tenant_id = $2 and organization_id = $3',
            [offboardedUserId, actor.tenantId, actor.organizationId],
          )
          expect(restoredUser.rowCount, 'the owned author fixture should remain available for API cleanup').toBe(1)
          await client.query(
            'delete from customer_activities where id = any($1::uuid[]) and tenant_id = $2 and organization_id = $3',
            [legacyIds, actor.tenantId, actor.organizationId],
          )
        })
      }
    })
  })
}
