/** @jest-environment node */
// EP-12 / EP-13 — the hand-rolled time-tracking routes now run the same API
// interceptor passes the CRUD factory runs. Four properties are pinned here because
// each one fails silently:
//
//  1. the route path an interceptor targets is the pathname WITHOUT `/api/`, the same
//     string `normalizeInterceptorRoutePath` builds for a factory route;
//  2. a `before` rewrite reaches the route's own parsing, and a `before` denial
//     short-circuits with the interceptor's status;
//  3. `after` sees the metadata its own `before` returned;
//  4. the context fails closed without a resolved tenant, so no interceptor ever runs
//     — and no route body is ever handed to one — outside a tenant scope.

import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { runTimesheetInterceptors, readSearchParamsRecord } from '../withTimesheetInterceptors'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'

type ContainerLike = { resolve: (name: string) => unknown }

function container(features: string[] = []): ContainerLike {
  return {
    resolve: (name: string) => {
      if (name === 'em') return { fork: () => ({}) }
      if (name === 'rbacService') return { getGrantedFeatures: async () => features }
      return null
    },
  }
}

function scopeFor(features: string[] = []) {
  return {
    container: container(features) as never,
    userId: USER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  }
}

function request(url: string, method = 'POST'): Request {
  return new Request(url, { method, headers: { 'x-om-ext-jira-token': 'abc' } })
}

afterEach(() => {
  registerApiInterceptors([])
})

describe('runTimesheetInterceptors', () => {
  it('targets a custom route by its pathname without the /api/ prefix', async () => {
    const seen: string[] = []
    const interceptor: ApiInterceptor = {
      id: 'test.bulk',
      targetRoute: 'staff/timesheets/time-entries/bulk',
      methods: ['POST'],
      async before(req) {
        seen.push(req.url)
        return { ok: true, body: { ...req.body, entries: [] } }
      },
    }
    registerApiInterceptors([{ moduleId: 'test', interceptors: [interceptor] }])

    const run = await runTimesheetInterceptors({
      request: request('https://app.test/api/staff/timesheets/time-entries/bulk'),
      method: 'POST',
      scope: scopeFor(),
      body: { entries: [{ id: 'x' }] },
    })

    expect(run.ok).toBe(true)
    expect(seen).toHaveLength(1)
    if (!run.ok) throw new Error('[internal] expected the run to succeed')
    expect(run.session.body).toEqual({ entries: [] })
  })

  it('matches a dynamic route through the registry prefix wildcard', async () => {
    const interceptor: ApiInterceptor = {
      id: 'test.duplicate',
      targetRoute: 'staff/timesheets/time-entries/*',
      methods: ['POST'],
      async before() {
        return { ok: true, body: { stamped: true } }
      },
    }
    registerApiInterceptors([{ moduleId: 'test', interceptors: [interceptor] }])

    const run = await runTimesheetInterceptors({
      request: request(
        'https://app.test/api/staff/timesheets/time-entries/44444444-4444-4444-8444-444444444444/duplicate',
      ),
      method: 'POST',
      scope: scopeFor(),
      body: {},
    })

    if (!run.ok) throw new Error('[internal] expected the run to succeed')
    expect(run.session.body).toEqual({ stamped: true })
  })

  it('short-circuits with the denial status a before-pass returns', async () => {
    const interceptor: ApiInterceptor = {
      id: 'test.deny',
      targetRoute: 'staff/timesheets/time-entries/bulk',
      methods: ['POST'],
      async before() {
        return { ok: false, statusCode: 409, message: 'Period closed' }
      },
    }
    registerApiInterceptors([{ moduleId: 'test', interceptors: [interceptor] }])

    const run = await runTimesheetInterceptors({
      request: request('https://app.test/api/staff/timesheets/time-entries/bulk'),
      method: 'POST',
      scope: scopeFor(),
      body: {},
    })

    expect(run.ok).toBe(false)
    if (run.ok) throw new Error('[internal] expected the run to be denied')
    expect(run.response.status).toBe(409)
    await expect(run.response.json()).resolves.toMatchObject({ error: 'Period closed' })
  })

  it('threads before-pass metadata into the after-pass and merges its response', async () => {
    const interceptor: ApiInterceptor = {
      id: 'test.metadata',
      targetRoute: 'staff/timesheets/my-work',
      methods: ['GET'],
      async before() {
        return { ok: true, metadata: { traceId: 'trace-1' } }
      },
      async after(_req, _res, context) {
        return { merge: { _test: { traceId: context.metadata?.traceId ?? null } } }
      },
    }
    registerApiInterceptors([{ moduleId: 'test', interceptors: [interceptor] }])

    const run = await runTimesheetInterceptors({
      request: request('https://app.test/api/staff/timesheets/my-work', 'GET'),
      method: 'GET',
      scope: scopeFor(),
    })

    if (!run.ok) throw new Error('[internal] expected the run to succeed')
    const response = await run.session.respond(200, { today: '2026-08-24' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      today: '2026-08-24',
      _test: { traceId: 'trace-1' },
    })
  })

  it('shapes an export descriptor rather than the file bytes', async () => {
    const interceptor: ApiInterceptor = {
      id: 'test.export',
      targetRoute: 'staff/timesheets/reports/*',
      methods: ['GET'],
      async after() {
        return { merge: { filename: 'invoice.csv' } }
      },
    }
    registerApiInterceptors([{ moduleId: 'test', interceptors: [interceptor] }])

    const run = await runTimesheetInterceptors({
      request: request('https://app.test/api/staff/timesheets/reports/r-1/export', 'GET'),
      method: 'GET',
      scope: scopeFor(),
    })

    if (!run.ok) throw new Error('[internal] expected the run to succeed')
    const shaped = await run.session.respondWithDescriptor({ filename: 'report.csv', rowCount: 3 })
    expect(shaped).toEqual({ ok: true, descriptor: { filename: 'invoice.csv', rowCount: 3 } })
  })

  it('skips a feature-gated interceptor the caller cannot trigger', async () => {
    const before = jest.fn(async () => ({ ok: true }))
    const interceptor: ApiInterceptor = {
      id: 'test.gated',
      targetRoute: 'staff/timesheets/my-work',
      methods: ['GET'],
      features: ['jira.sync'],
      before,
    }
    registerApiInterceptors([{ moduleId: 'test', interceptors: [interceptor] }])

    const run = await runTimesheetInterceptors({
      request: request('https://app.test/api/staff/timesheets/my-work', 'GET'),
      method: 'GET',
      scope: scopeFor(['staff.timesheets.view']),
    })

    expect(run.ok).toBe(true)
    expect(before).not.toHaveBeenCalled()
  })

  it('fails closed when the request resolved no tenant', async () => {
    registerApiInterceptors([
      {
        moduleId: 'test',
        interceptors: [
          {
            id: 'test.scope',
            targetRoute: 'staff/timesheets/my-work',
            methods: ['GET'],
            async before() {
              return { ok: true }
            },
          },
        ],
      },
    ])

    const run = await runTimesheetInterceptors({
      request: request('https://app.test/api/staff/timesheets/my-work', 'GET'),
      method: 'GET',
      scope: { ...scopeFor(), tenantId: null },
    })

    expect(run.ok).toBe(false)
    if (run.ok) throw new Error('[internal] expected the run to be denied')
    expect(run.response.status).toBe(400)
  })

  it('fails closed on an org-scoped route that resolved no organization', async () => {
    const run = await runTimesheetInterceptors({
      request: request('https://app.test/api/staff/timesheets/my-work', 'GET'),
      method: 'GET',
      scope: { ...scopeFor(), organizationId: null },
    })

    expect(run.ok).toBe(false)
  })

  it('lets a tenant-global route run without an organization', async () => {
    const run = await runTimesheetInterceptors({
      request: request('https://app.test/api/staff/timesheets/settings', 'GET'),
      method: 'GET',
      scope: { ...scopeFor(), organizationId: null, tenantGlobal: true },
    })

    expect(run.ok).toBe(true)
  })
})

describe('readSearchParamsRecord', () => {
  it('collapses repeated keys into an array so a rewrite round-trips', () => {
    expect(readSearchParamsRecord('https://app.test/api/x?tagIds=a&tagIds=b&page=2')).toEqual({
      tagIds: ['a', 'b'],
      page: '2',
    })
  })

  it('answers with an empty record for an unparseable url', () => {
    expect(readSearchParamsRecord('not-a-url')).toEqual({})
  })
})
