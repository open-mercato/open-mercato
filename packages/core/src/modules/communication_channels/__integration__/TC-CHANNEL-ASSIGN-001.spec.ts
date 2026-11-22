import { randomUUID } from 'node:crypto'
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  purgeSeededInboundMessage,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['messages'] }

const password = 'ChannelFixture1!'
const channelReader = ['messages.view', 'communication_channels.view', 'communication_channels.connect_user_channel']
const channelAssigner = [...channelReader, 'communication_channels.assign']
const directoryAssigner = [...channelAssigner, 'auth.users.list']
const usersPath = '/api/auth/users'
const firstPagePath = `${usersPath}?page=1&pageSize=50`
const assignedTo = 'Assigned to'

type Scope = { tenantId: string; organizationId: string }
type Actor = { id: string; email: string; token: string; roleId: string; scope: Scope }
type SeededMessage = Awaited<ReturnType<typeof seedInboundMessage>>
type Thread = SeededMessage & { assignmentId: string }
type NamedUser = { id: string; name: string }
type AssignmentRow = Record<string, unknown> & { assigned_user_id: string | null; updated_at: string }
type AssignmentSnapshot = {
  message: Record<string, unknown>
  conversation: AssignmentRow
  mapping: AssignmentRow
}

const test = base.extend<{
  fixtures: {
    createScope: () => Promise<Scope>
    createActor: (scope: Scope, label: string, features: string[]) => Promise<Actor>
    createDirectory: (actor: Actor, page: Page) => Promise<{ firstPageUser: NamedUser; offPageUser: NamedUser }>
    seedMessage: (actor: Actor, threaded?: boolean) => Promise<Thread>
    purgeMessage: (actor: Actor, thread: Thread) => Promise<void>
    setFeatures: (actor: Actor, features: string[]) => Promise<void>
  }
}>({
  fixtures: async ({ request }, use) => {
    const adminToken = await getAuthToken(request, 'superadmin')
    test.skip(!await isChannelSeedingAvailable(request, adminToken), 'Channel test seeding is disabled.')

    const scopes: Array<Partial<Scope>> = []
    const roleIds: string[] = []
    const userIds: string[] = []
    const channels = new Map<string, { channelId: string; token: string; messages: SeededMessage[] }>()
    const runId = randomUUID()
    const createScope = async () => {
      const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: adminToken,
        data: { name: `Channel assignment ${runId} ${scopes.length}` },
      })
      expect(response.status(), 'Create a disposable tenant').toBe(201)
      const tenantId = expectId((await response.json()).id, 'Tenant creation returns its id')
      const created: Partial<Scope> = { tenantId }
      scopes.push(created)
      const organizationId = await createOrganizationFixture(request, adminToken, {
        tenantId,
        name: `Channel assignment organization ${runId}`,
      })
      created.organizationId = organizationId
      return { tenantId, organizationId }
    }

    const setFeatures = (actor: Pick<Actor, 'roleId' | 'scope'>, features: string[]) =>
      setRoleAclFeatures(request, adminToken, {
        roleId: actor.roleId,
        features,
        organizations: [actor.scope.organizationId],
      })

    const createUser = async (scope: Scope, roleId: string, label: string, name: string) => {
      const email = `qa-${label}-${runId}@example.invalid`
      const id = await createUserFixture(request, adminToken, {
        email,
        password,
        name,
        organizationId: scope.organizationId,
        roles: [roleId],
      })
      userIds.push(id)
      return { id, email, name }
    }

    try {
      await use({
        createScope,
        setFeatures,
        purgeMessage: async (actor, thread) => {
          const channel = channels.get(actor.id)
          if (!channel) throw new Error('[internal] Fixture channel is missing')
          await purgeSeededInboundMessage(request, actor.token, channel.channelId, thread)
        },
        createActor: async (scope, label, features) => {
          const roleId = await createRoleFixture(request, adminToken, {
            name: `channel-assignment-${label}-${runId}`,
            tenantId: scope.tenantId,
          })
          roleIds.push(roleId)
          await setFeatures({ roleId, scope }, features)
          const user = await createUser(scope, roleId, label, `Channel assignment ${label}`)
          const token = await getAuthToken(request, user.email, password)
          return { ...user, roleId, scope, token }
        },
        createDirectory: async (actor, page) => {
          const users: NamedUser[] = []
          for (let start = 0; start < 52; start += 8) {
            const batch = await Promise.allSettled(
              Array.from({ length: Math.min(8, 52 - start) }, (_, offset) => {
                const index = start + offset
                return createUser(actor.scope, actor.roleId, `colleague-${index}`,
                  `Channel assignment colleague ${index} with a long display name for narrow screens`)
              }),
            )
            for (const result of batch) {
              if (result.status === 'rejected') throw result.reason
              users.push(result.value)
            }
          }
          const response = await apiRequest(page.request, 'GET', firstPagePath, { token: actor.token })
          expect(response.status()).toBe(200)
          const { items, total } = await response.json() as { items: NamedUser[]; total: number }
          expect(items).toHaveLength(50)
          expect(total).toBeGreaterThan(50)
          const firstPageIds = new Set(items.map(({ id }) => id))
          const nextPage = await apiRequest(page.request, 'GET', `${usersPath}?page=2&pageSize=50`, { token: actor.token })
          expect(nextPage.status()).toBe(200)
          const nextPageIds = new Set(((await nextPage.json()) as { items: NamedUser[] }).items.map(({ id }) => id))
          const firstPageUser = users.find(({ id }) => firstPageIds.has(id))
          const offPageUser = users.reverse().find(({ id }) => nextPageIds.has(id) && !firstPageIds.has(id))
          if (!firstPageUser || !offPageUser) throw new Error('[internal] Expected fixture users on and off the first page')
          return { firstPageUser, offPageUser }
        },
        seedMessage: async (actor, threaded = true) => {
          let channel = channels.get(actor.id)
          if (!channel) {
            const channelId = await seedConnectedChannel(request, actor.token)
            channel = { channelId, token: actor.token, messages: [] }
            channels.set(actor.id, channel)
          }
          const threadId = threaded ? randomUUID() : undefined
          const seeded = await seedInboundMessage(request, actor.token, {
            channelId: channel.channelId,
            subject: `Channel assignment ${randomUUID()}`,
            bodyText: 'Assignment regression fixture',
            messageThreadId: threadId,
            createThreadMapping: true,
          })
          channel.messages.push(seeded)
          return { ...seeded, assignmentId: threadId ?? seeded.messageId }
        },
      })
    } finally {
      for (const { channelId, token, messages } of channels.values()) {
        for (const seeded of messages) await purgeSeededInboundMessage(request, token, channelId, seeded)
        await deleteChannelIfExists(request, token, channelId)
      }
      await Promise.all(userIds.map((id) => deleteUserIfExists(request, adminToken, id)))
      await Promise.all(roleIds.map((id) => deleteRoleIfExists(request, adminToken, id)))
      const tenantCleanup = await Promise.allSettled(scopes.map(async ({ tenantId, organizationId }) => {
        await deleteOrganizationIfExists(request, adminToken, organizationId ?? null)
        if (tenantId) {
          const response = await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${tenantId}`, { token: adminToken })
          expect(response.status(), 'Delete the disposable tenant').toBe(200)
        }
      }))
      for (const result of tenantCleanup) {
        if (result.status === 'rejected') throw result.reason
      }
    }
  },
})

const detailPath = ({ messageId }: Thread) => `/backend/messages/${messageId}`
const assignPath = ({ assignmentId }: Thread) => `/api/communication_channels/threads/${assignmentId}/assign`
const selectedUserPath = (userId: string) => `${usersPath}?ids=${userId}&pageSize=1`
const channelInfo = (page: Page, name = 'Channel info') => page.getByRole('complementary', { name })
const picker = (page: Page) => channelInfo(page).getByRole('combobox', { name: assignedTo })
const pathWithQuery = (url: string) => {
  const parsed = new URL(url)
  return parsed.pathname + parsed.search
}

async function loginAs(page: Page, actor: Actor) {
  const response = await postForm(page.request, '/api/auth/login', { email: actor.email, password })
  expect(response.status()).toBe(200)
}

function directoryRequests(page: Page) {
  const requests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === usersPath) requests.push(url.pathname + url.search)
  })
  return requests
}

async function assign(request: APIRequestContext, actor: Actor, thread: Thread, assignedUserId: string | null) {
  return apiRequest(request, 'PUT', assignPath(thread), { token: actor.token, data: { assignedUserId } })
}

async function snapshot(scope: Scope, thread: Thread): Promise<AssignmentSnapshot> {
  return withClient(async (client) => {
    const result = await client.query<AssignmentSnapshot>(
      `select to_jsonb(message) as message, to_jsonb(conversation) as conversation, to_jsonb(mapping) as mapping
         from messages as message
         join external_conversations as conversation on conversation.id = $2
           and conversation.tenant_id = message.tenant_id and conversation.organization_id = message.organization_id
         join channel_thread_mappings as mapping on mapping.external_conversation_id = conversation.id
           and mapping.tenant_id = message.tenant_id and mapping.organization_id = message.organization_id
        where message.id = $1 and message.tenant_id = $3 and message.organization_id = $4
          and mapping.message_thread_id = $5`,
      [thread.messageId, thread.conversationId, scope.tenantId, scope.organizationId, thread.assignmentId],
    )
    expect(result.rows).toHaveLength(1)
    return result.rows[0]
  })
}

function expectAssignmentOnly(before: AssignmentSnapshot, after: AssignmentSnapshot, id: string | null) {
  expect(after.message).toEqual(before.message)
  for (const target of ['conversation', 'mapping'] as const) {
    expect(after[target].updated_at).not.toBe(before[target].updated_at)
    expect(after[target]).toEqual({ ...before[target], assigned_user_id: id, updated_at: after[target].updated_at })
  }
}

async function selectAssignee(page: Page, thread: Thread, label: string, id: string | null) {
  await picker(page).press('Enter')
  const option = page.getByRole('option', { name: label, exact: true })
  const saved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === assignPath(thread) && response.request().method() === 'PUT')
  await option.focus()
  await option.press('Enter')
  const response = await saved
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ assignedUserId: id })
  await expect(picker(page)).toHaveText(label)
}

test('resolves an off-page assignee on cold loads and changes only the assignment', async ({ page, request, fixtures }) => {
  test.slow()
  const scope = await fixtures.createScope()
  const operator = await fixtures.createActor(scope, 'operator', directoryAssigner)
  await loginAs(page, operator)
  const { firstPageUser, offPageUser } = await fixtures.createDirectory(operator, page)
  const thread = await fixtures.seedMessage(operator)
  expect((await assign(request, operator, thread, offPageUser.id)).status()).toBe(200)

  const requests = directoryRequests(page)
  const lookupPath = selectedUserPath(offPageUser.id)
  const expectedPaths = new Set([firstPagePath, lookupPath])
  await page.goto(detailPath(thread))
  await expect(picker(page)).toHaveText(offPageUser.name)
  expect(new Set(requests)).toEqual(expectedPaths)

  for (let attempt = 1; attempt <= 10; attempt++) {
    await test.step(`Cold reload ${attempt}`, async () => {
      const start = requests.length
      await page.reload()
      await expect(picker(page)).toHaveText(offPageUser.name)
      expect(new Set(requests.slice(start))).toEqual(expectedPaths)
    })
  }

  const beforeOpening = requests.length
  await picker(page).press('Enter')
  await expect(page.getByRole('option', { name: offPageUser.name, exact: true })).toBeVisible()
  await page.getByRole('option', { name: offPageUser.name, exact: true }).press('Escape')
  await expect(picker(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(picker(page)).toBeFocused()
  expect(requests).toHaveLength(beforeOpening)

  const before = await snapshot(scope, thread)
  await selectAssignee(page, thread, 'Unassigned', null)
  const unassigned = await snapshot(scope, thread)
  expectAssignmentOnly(before, unassigned, null)
  const repeatedUnassign = await assign(request, operator, thread, null)
  expect(repeatedUnassign.status()).toBe(200)
  expect(await repeatedUnassign.json()).toMatchObject({ assignedUserId: null, unchanged: true })
  expect(await snapshot(scope, thread)).toEqual(unassigned)

  await selectAssignee(page, thread, firstPageUser.name, firstPageUser.id)
  expectAssignmentOnly(unassigned, await snapshot(scope, thread), firstPageUser.id)
  await page.reload()
  await expect(picker(page)).toHaveText(firstPageUser.name)
})

test('recovers from a failed selected lookup and preserves localized narrow and threadless states', async ({ page, request, fixtures, baseURL }) => {
  test.slow()
  const scope = await fixtures.createScope()
  const operator = await fixtures.createActor(scope, 'operator', directoryAssigner)
  await loginAs(page, operator)
  const { offPageUser } = await fixtures.createDirectory(operator, page)
  const thread = await fixtures.seedMessage(operator)
  const threadless = await fixtures.seedMessage(operator, false)
  for (const message of [thread, threadless]) {
    expect((await assign(request, operator, message, offPageUser.id)).status()).toBe(200)
  }

  const lookupPath = selectedUserPath(offPageUser.id)
  const lookup = (url: URL) => pathWithQuery(url.href) === lookupPath
  await page.route(lookup, (route) => route.fulfill({ status: 503, json: { error: 'Fixture lookup unavailable' } }))
  const refused = page.waitForResponse((response) => lookup(new URL(response.url())))
  await page.goto(detailPath(thread))
  expect((await refused).status()).toBe(503)
  await picker(page).press('Enter')
  await page.getByRole('option', { name: offPageUser.id, exact: true }).press('Escape')
  await expect(picker(page)).toHaveText(offPageUser.id)
  await expect(page).toHaveURL((url) => url.pathname === detailPath(thread))

  await page.unroute(lookup)
  const recovered = page.waitForResponse((response) => lookup(new URL(response.url())))
  await page.reload()
  expect((await recovered).status()).toBe(200)
  await expect(picker(page)).toHaveText(offPageUser.name)

  if (!baseURL) throw new Error('[internal] The browser runner must supply a baseURL')
  const desktopViewport = page.viewportSize()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.context().addCookies([{ name: 'locale', value: 'pl', url: baseURL }])
  await page.reload()
  const polishPicker = channelInfo(page, 'Informacje o kanale').getByRole('combobox', { name: 'Przypisane do' })
  await expect(polishPicker).toHaveText(offPageUser.name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  const bounds = await polishPicker.boundingBox()
  expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 375).toBe(true)
  await polishPicker.press('Enter')
  await expect(page.getByRole('option', { name: 'Nieprzypisane' })).toBeVisible()
  await page.getByRole('option', { name: offPageUser.name, exact: true }).press('Escape')

  await page.goto(detailPath(threadless))
  await expect(polishPicker).toBeDisabled()
  await expect(polishPicker).toHaveText(offPageUser.name)
  if (desktopViewport) await page.setViewportSize(desktopViewport)
  await page.context().addCookies([{ name: 'locale', value: 'en', url: baseURL }])
  await page.goto(detailPath(thread))
  await expect(picker(page)).toHaveText(offPageUser.name)
  await page.getByRole('button', { name: 'Conversation actions' }).hover()
  await expect(page.getByRole('menuitem', { name: 'Forward all', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'Forward all', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Actions', exact: true }).hover()
  await expect(page.getByRole('menuitem', { name: 'Forward', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('link', { name: 'Back to messages' }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/backend/messages')
  await fixtures.purgeMessage(operator, thread)
  await page.goBack()
  await expect(page.getByText('This message is no longer available.')).toBeVisible()
  await expect(channelInfo(page)).toHaveCount(0)
})

test('keeps read-only, directory-denied and foreign actors within their permissions', async ({ page, browser, baseURL, request, fixtures }) => {
  const scope = await fixtures.createScope()
  const reader = await fixtures.createActor(scope, 'reader', channelAssigner)
  const withoutDirectory = await fixtures.createActor(scope, 'without-directory', channelAssigner)
  const foreign = await fixtures.createActor(await fixtures.createScope(), 'foreign', directoryAssigner)
  const readOnlyThread = await fixtures.seedMessage(reader)
  const noDirectoryThread = await fixtures.seedMessage(withoutDirectory)
  expect((await assign(request, reader, readOnlyThread, withoutDirectory.id)).status()).toBe(200)
  expect((await assign(request, withoutDirectory, noDirectoryThread, reader.id)).status()).toBe(200)
  const readOnlyBefore = await snapshot(scope, readOnlyThread)
  await fixtures.setFeatures(reader, channelReader)

  await loginAs(page, reader)
  const requests = directoryRequests(page)
  await page.goto(detailPath(readOnlyThread))
  await expect(channelInfo(page).getByText(withoutDirectory.id, { exact: true })).toBeVisible()
  await expect(picker(page)).toHaveCount(0)
  expect(requests).toEqual([])
  expect((await assign(request, reader, readOnlyThread, null)).status()).toBe(403)

  const noDirectoryBefore = await snapshot(scope, noDirectoryThread)
  const foreignLookup = await apiRequest(request, 'GET', selectedUserPath(reader.id), { token: foreign.token })
  expect(foreignLookup.status()).toBe(200)
  expect(await foreignLookup.json()).toMatchObject({ items: [] })
  expect((await assign(request, foreign, readOnlyThread, foreign.id)).status()).toBe(404)
  expect(await snapshot(scope, readOnlyThread)).toEqual(readOnlyBefore)

  const directoryDeniedPage = await browser.newPage({ baseURL })
  try {
    await loginAs(directoryDeniedPage, withoutDirectory)
    const deniedResponses = [firstPagePath, selectedUserPath(reader.id)].map((path) =>
      directoryDeniedPage.waitForResponse((response) => pathWithQuery(response.url()) === path))
    await directoryDeniedPage.goto(detailPath(noDirectoryThread))
    expect((await Promise.all(deniedResponses)).map((response) => response.status())).toEqual([403, 403])
    await picker(directoryDeniedPage).press('Enter')
    await directoryDeniedPage.getByRole('option', { name: reader.id, exact: true }).press('Escape')
    await expect(picker(directoryDeniedPage)).toHaveText(reader.id)
    await expect(directoryDeniedPage).toHaveURL((url) => url.pathname === detailPath(noDirectoryThread))
    expect(await snapshot(scope, noDirectoryThread)).toEqual(noDirectoryBefore)
  } finally {
    await directoryDeniedPage.close()
  }
})
