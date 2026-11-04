import type { APIRequestContext, APIResponse, BrowserContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { test as recoveryTest, type RecoveryFixture } from '../__integration__/helpers/actionConflictFixtures'

jest.mock('@playwright/test', () => ({
  expect: (actual: unknown) => expect(actual),
  test: { extend: (fixtures: unknown) => fixtures },
}))
jest.mock('@open-mercato/core/helpers/integration/api', () => ({
  apiRequest: jest.fn(),
  getAuthToken: jest.fn(),
}))

type FixtureCallback = (
  input: { request: APIRequestContext; bootstrapRequest: APIRequestContext; recoveryAction: 'label'; context: BrowserContext; baseURL: string },
  use: (fixture: RecoveryFixture) => Promise<void>,
) => Promise<void>
const runFixture = (recoveryTest as unknown as { recovery: FixtureCallback }).recovery
const requestMock = jest.mocked(apiRequest)
const loginMock = jest.mocked(getAuthToken)

type Actor = ReturnType<typeof createActor>
function createActor(name: string, failReadback = false) {
  return {
    name,
    request: {} as APIRequestContext,
    context: { addCookies: jest.fn().mockResolvedValue(undefined) } as unknown as BrowserContext,
    organizationId: `organization-${name}`,
    organizationExists: false,
    users: new Set<string>(),
    acl: new Map<string, { organizations: string[]; features: string[] }>(),
    claim: null as { id: string; status: string; updatedAt: string } | null,
    lines: [] as Array<{ id: string; updatedAt: string }>,
    failReadback,
    failAcl: false,
    history: [] as string[],
  }
}

function response(status: number, body: unknown): APIResponse {
  return { status: () => status, text: async () => JSON.stringify(body) } as APIResponse
}

function token(actor: Actor) {
  return `header.${Buffer.from(JSON.stringify({ tenantId: 'owned-tenant', orgId: actor.organizationId })).toString('base64url')}.signature`
}

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function installHttp(actors: Actor[]) {
  const globalSettings = { enabled: true }
  const globalWrites: unknown[] = []
  for (const actor of actors) {
    actor.request.fetch = jest.fn(async (path, options) => requestMock(actor.request, options!.method!, String(path), {
      token: options!.headers!.Authorization.replace('Bearer ', ''), data: options!.data,
    }))
  }
  loginMock.mockImplementation(async (request) => token(actors.find((actor) => actor.request === request)!))
  requestMock.mockImplementation(async (request, method, path, options) => {
    const actor = actors.find((candidate) => candidate.request === request)!
    const url = new URL(path, 'http://fixture.invalid')
    const data = options.data as Record<string, unknown> | undefined
    actor.history.push(`${method} ${path}`)
    if (url.pathname === '/api/record_locks/settings') {
      if (method === 'POST') {
        globalWrites.push(options.data)
        globalSettings.enabled = data!.enabled as boolean
      }
      return response(200, { settings: { ...globalSettings } })
    }
    if (url.pathname === '/api/directory/organizations') {
      if (method === 'POST') {
        expect(data?.tenantId).toBe('owned-tenant')
        actor.organizationExists = true
        return response(201, { id: actor.organizationId })
      }
      expect(data?.id).toBe(actor.organizationId)
      actor.organizationExists = false
      return response(200, { ok: true })
    }
    if (url.pathname === '/api/auth/users') {
      if (method === 'POST') {
        expect(data?.organizationId).toBe(actor.organizationId)
        const userId = `${actor.name}-user-${actor.users.size}`
        actor.users.add(userId)
        return response(201, { id: userId })
      }
      if (method === 'DELETE') {
        expect(actor.users.has(url.searchParams.get('id')!)).toBe(true)
        actor.users.delete(url.searchParams.get('id')!)
        return response(200, { ok: true })
      }
      return response(200, { items: [] })
    }
    if (url.pathname === '/api/auth/users/acl') {
      if (actor.failAcl) return response(500, { error: 'injected ACL failure' })
      expect(actor.users.has(data!.userId as string)).toBe(true)
      actor.acl.set(data!.userId as string, {
        organizations: data!.organizations as string[], features: data!.features as string[],
      })
      return response(200, { ok: true })
    }
    expect(options.token).toBe(token(actor))
    if (url.pathname === '/api/warranty_claims/settings-general') {
      return response(200, { result: { updatedAt: 'settings-version', quarantineGrades: [] } })
    }
    if (url.pathname === '/api/warranty_claims') {
      if (method === 'POST') {
        actor.claim = { id: `claim-${actor.name}`, status: 'draft', updatedAt: 'claim-created' }
        actor.lines = [{ id: `line-${actor.name}`, updatedAt: 'line-created' }]
        return response(201, { id: actor.claim.id })
      }
      if (method === 'PUT') {
        actor.claim!.updatedAt = 'claim-updated'
        return response(200, { ok: true })
      }
      if (method === 'DELETE') {
        expect(url.searchParams.get('id')).toBe(actor.claim!.id)
        expect(actor.lines).toEqual([])
        actor.claim = null
        return response(200, { ok: true })
      }
      if (actor.failReadback) {
        actor.failReadback = false
        actor.history.push('injected GET 500 after POST 201')
        return response(500, { error: 'injected readback failure' })
      }
      return response(200, { items: actor.claim ? [actor.claim] : [] })
    }
    if (url.pathname === '/api/warranty_claims/lines') {
      if (method === 'DELETE') {
        expect(url.searchParams.get('id')).toBe(actor.lines[0].id)
        actor.lines = []
        return response(200, { ok: true })
      }
      expect(url.searchParams.get('claimId')).toBe(`claim-${actor.name}`)
      return response(200, { items: actor.lines })
    }
    if (url.pathname === '/api/warranty_claims/submit') {
      actor.claim!.status = 'submitted'
      return response(200, { ok: true })
    }
    if (url.pathname === '/api/warranty_claims/transition') {
      actor.claim!.status = data!.toStatus as string
      return response(200, { ok: true })
    }
    throw new Error(`[internal] Unexpected fixture request: ${method} ${path}`)
  })
  return { globalSettings, globalWrites }
}

function invoke(actor: Actor, use: (fixture: RecoveryFixture) => Promise<void>) {
  return runFixture({
    request: actor.request, bootstrapRequest: actor.request, recoveryAction: 'label',
    context: actor.context, baseURL: 'http://fixture.invalid',
  }, async (fixture) => {
    expect(actor.context.addCookies).toHaveBeenCalledWith([
      { name: 'om_selected_tenant', value: 'owned-tenant', url: 'http://fixture.invalid', sameSite: 'Lax' },
      { name: 'om_selected_org', value: actor.organizationId, url: 'http://fixture.invalid', sameSite: 'Lax' },
    ])
    await use(fixture)
  })
}

function expectClean(actor: Actor) {
  expect(actor.claim).toBeNull()
  expect(actor.lines).toEqual([])
  expect(actor.users.size).toBe(0)
  expect(actor.organizationExists).toBe(false)
}

beforeEach(() => jest.resetAllMocks())

test('overlapping fixtures never mutate global locking and retain separate ownership', async () => {
  const first = createActor('first')
  const second = createActor('second')
  const { globalSettings, globalWrites } = installHttp([first, second])
  const firstEntered = deferred()
  const secondEntered = deferred()
  const finishFirst = deferred()
  const finishSecond = deferred()
  const firstRun = invoke(first, async () => { firstEntered.resolve(); await finishFirst.promise })
  const secondRun = firstEntered.promise.then(() => invoke(second, async () => {
    secondEntered.resolve()
    await finishSecond.promise
  }))
  try {
    await Promise.race([secondEntered.promise, firstRun, secondRun])
    expect(first.claim).not.toBeNull()
    expect(second.claim).not.toBeNull()
    finishFirst.resolve()
    await firstRun
    expectClean(first)
    expect(second.claim).not.toBeNull()
    expect(second.users.size).toBe(2)
    expect(globalSettings.enabled).toBe(true)
    for (const actor of [first, second]) {
      expect(actor.acl.size).toBe(2)
      for (const acl of actor.acl.values()) {
        expect(acl.organizations).toEqual([actor.organizationId])
        expect(acl.features).toEqual(['warranty_claims.*', 'sales.orders.view', 'catalog.products.view', 'attachments.view'])
      }
    }
  } finally {
    firstEntered.resolve()
    finishFirst.resolve()
    finishSecond.resolve()
    await Promise.all([firstRun, secondRun])
  }
  expectClean(second)
  expect(globalSettings.enabled).toBe(true)
  expect(globalWrites).toEqual([])
})

test('POST 201 followed by GET 500 still deletes the created claim and lines before users and organization', async () => {
  const actor = createActor('failed-readback', true)
  installHttp([actor])
  const use = jest.fn()
  await expect(invoke(actor, use)).rejects.toThrow()
  expect(use).not.toHaveBeenCalled()
  expect(actor.history).toContain('injected GET 500 after POST 201')
  expect(actor.history.filter((entry) => entry.startsWith('DELETE '))).toEqual([
    `DELETE /api/warranty_claims/lines?id=line-${actor.name}`,
    `DELETE /api/warranty_claims?id=claim-${actor.name}`,
    `DELETE /api/auth/users?id=${actor.name}-user-1`,
    `DELETE /api/auth/users?id=${actor.name}-user-0`,
    'DELETE /api/directory/organizations',
  ])
  expectClean(actor)
})

test('a failed per-user ACL setup cleans the user already created and its organization', async () => {
  const actor = createActor('failed-acl')
  actor.failAcl = true
  installHttp([actor])
  const use = jest.fn()
  await expect(invoke(actor, use)).rejects.toThrow()
  expect(use).not.toHaveBeenCalled()
  expect(actor.history).toContain(`DELETE /api/auth/users?id=${actor.name}-user-0`)
  expectClean(actor)
})

test('a failing test body still cleans all owned fixtures', async () => {
  const actor = createActor('failed-body')
  installHttp([actor])
  await expect(invoke(actor, async () => { throw new Error('injected test failure') })).rejects.toThrow('injected test failure')
  expectClean(actor)
})

test('a failed browser scope setup cleans all owned fixtures before the test starts', async () => {
  const actor = createActor('failed-browser-scope')
  jest.mocked(actor.context.addCookies).mockRejectedValue(new Error('injected browser scope failure'))
  installHttp([actor])
  const use = jest.fn()
  await expect(invoke(actor, use)).rejects.toThrow('injected browser scope failure')
  expect(use).not.toHaveBeenCalled()
  expectClean(actor)
})
