import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { crudFormSectionPolicyHeaderNames as policyHeaders } from '@open-mercato/shared/lib/crud/form-sections/policy-headers'
import type { CrudFormSectionClientMutationFact } from '@open-mercato/shared/modules/form-section-facts'
import { withScopedApiHeaders } from '../api'
import { apiCall, withScopedApiRequestHeaders } from '../apiCall'
import { createCrudFormSectionMutationClient } from '../crudFormSectionMutation'

const hostKind = 'test.product'
const childKind = 'test.offer'
const parentVersion = '2026-11-20T09:00:00.000Z'
const childVersion = '2026-11-20T10:00:00.000Z'
const otherVersion = '2026-11-20T11:00:00.000Z'
const routes: CrudFormSectionClientMutationFact[] = [
  { id: 'test.product-update', kind: 'parent-submit', guardedFacade: { method: 'PUT', routePattern: '/products/section-policy' },
    requestOperation: 'update', hostResourceKind: hostKind, mutationResourceKind: hostKind, optimisticLock: 'target-required' },
  { id: 'test.product-delete', kind: 'parent-delete', guardedFacade: { method: 'DELETE', routePattern: '/products/section-policy' },
    requestOperation: 'delete', hostResourceKind: hostKind, mutationResourceKind: hostKind, optimisticLock: 'target-required' },
  ...(['create', 'update', 'delete', 'retry'] as const).map((requestOperation): CrudFormSectionClientMutationFact => ({
    id: 'test.offer-' + requestOperation, kind: 'section-action',
    guardedFacade: { method: requestOperation === 'update' ? 'PATCH' : requestOperation === 'delete' ? 'DELETE' : 'POST',
      routePattern: requestOperation === 'create' ? '/products/[productId]/offers'
        : '/products/[productId]/offers/[offerId]' + (requestOperation === 'retry' ? '/retry' : '') },
    requestOperation, hostResourceKind: hostKind, mutationResourceKind: childKind,
    optimisticLock: ['update', 'delete'].includes(requestOperation) ? 'target-required' : 'none',
  })),
]
const create: CrudFormSectionClientMutationFact = {
  id: 'test.product-create', kind: 'parent-submit', guardedFacade: { method: 'POST', routePattern: '/products/section-policy' },
  requestOperation: 'create', hostResourceKind: hostKind, mutationResourceKind: hostKind, optimisticLock: 'none',
}

function policy(formOperation: 'create' | 'update') {
  const clientMutationSurfaces = formOperation === 'create' ? [create] : routes
  const base = { hostId: 'test.product', formVariant: 'showcase' }
  return {
    identity: formOperation === 'create' ? { ...base, formOperation } : { ...base, formOperation, resourceId: 'product-1' },
    hostResourceKind: hostKind, policyToken: 'Ab1', fingerprint: 'a'.repeat(64),
    surface: { ...base, formOperation, id: 'test.configured', orderedSectionIds: [], callerIds: [], contributionIds: [],
      ownershipFacts: [], dependencies: [], mutationSurfaceIds: clientMutationSurfaces.map(({ id }) => id), clientMutationSurfaces },
  }
}

const options = (operation: 'create' | 'update' | 'delete') => ({
  operation, requestOperation: operation, mutationSurfaceId: 'test.offer-' + operation,
  mutationResourceKind: childKind,
  ...(operation !== 'create' ? { mutationResourceId: 'offer-1', expectedUpdatedAt: childVersion } : {}),
})

const createPath = '/api/products/section-policy'
const parentPath = createPath + '?id=product-1'
const childPath = '/api/products/product-1/offers/offer-1'
const originalFetch = globalThis.fetch

afterEach(() => { globalThis.fetch = originalFetch })

it('isolates explicit create, parent, child and legacy headers with both request stacks active', async () => {
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  const transport = jest.fn(async (_input: string, _init: RequestInit) => {
    await pending
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
  })
  globalThis.fetch = transport as typeof fetch
  const edit = createCrudFormSectionMutationClient(policy('update'), parentVersion)
  const add = createCrudFormSectionMutationClient(policy('create'))
  const all = withScopedApiHeaders({ [OPTIMISTIC_LOCK_HEADER_NAME]: otherVersion, 'x-legacy-inner': 'inner' }, () =>
    withScopedApiRequestHeaders({ [OPTIMISTIC_LOCK_HEADER_NAME]: otherVersion, 'x-legacy-outer': 'outer' }, () => Promise.all([
      add.parent('create')!.write(createPath, { name: 'test' }),
      edit.parent('update')!.write(parentPath, { name: 'edited' }),
      edit.parent('delete', { 'x-sudo-token': 'delete-only', [OPTIMISTIC_LOCK_HEADER_NAME]: otherVersion })!.request(parentPath),
      edit.section(options('update')).request(childPath),
      edit.section(options('delete')).request(childPath),
      edit.section(options('create')).request('/api/products/product-1/offers'),
      edit.section({ ...options('update'), mutationSurfaceId: 'test.offer-retry', requestOperation: 'retry', expectedUpdatedAt: undefined }).request(childPath + '/retry'),
      apiCall('/api/legacy'),
    ])))
  expect(transport).toHaveBeenCalledTimes(8)
  const calls = transport.mock.calls.map(([, init]) => new Headers(init.headers))
  expect(calls.map((headers) => headers.get(OPTIMISTIC_LOCK_HEADER_NAME)))
    .toEqual([null, parentVersion, otherVersion, childVersion, childVersion, null, null, otherVersion])
  expect(calls.map((headers) => headers.get(policyHeaders.hostResourceId)))
    .toEqual([null, 'product-1', 'product-1', 'product-1', 'product-1', 'product-1', 'product-1', null])
  expect(calls.map((headers) => headers.get(policyHeaders.mutationResourceId)))
    .toEqual([null, 'product-1', 'product-1', 'offer-1', 'offer-1', null, 'offer-1', null])
  expect(calls.map((headers) => headers.get('x-sudo-token'))).toEqual([null, null, 'delete-only', null, null, null, null, null])
  for (const headers of calls.slice(0, -1)) {
    expect(headers.has('x-legacy-inner')).toBe(false)
    expect(headers.has('x-legacy-outer')).toBe(false)
  }
  expect(calls[7].get('x-legacy-inner')).toBe('inner')
  expect(calls[7].get('x-legacy-outer')).toBe('outer')
  expect(transport.mock.calls[6][1]).toMatchObject({ method: 'POST', redirect: 'error', mode: 'same-origin' })
  release()
  await all
})

it('checks endpoint, method, IDs, and explicit headers before calling the API', async () => {
  const transport = jest.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }))
  globalThis.fetch = transport
  const add = createCrudFormSectionMutationClient(policy('create'))
  const edit = createCrudFormSectionMutationClient(policy('update'), parentVersion)
  const bound = edit.parent('update')!
  await expect(bound.request('/api/products/other')).rejects.toThrow(/Invalid bound/)
  await expect(bound.request('/api/products/section-policy?id=different')).rejects.toThrow(/Invalid bound/)
  await expect(bound.request(parentPath, { method: 'PATCH' })).rejects.toThrow(/Invalid bound/)
  await expect(bound.request('//test.invalid/api/products/section-policy')).rejects.toThrow(/Invalid bound/)
  await expect(bound.request(parentPath, { headers: [[policyHeaders.policyToken.toUpperCase(), 'spoof']] })).rejects.toThrow(/Invalid bound/)
  await expect(bound.request(parentPath, { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: otherVersion } })).rejects.toThrow(/Invalid bound/)
  await expect(add.parent('create')!.request(createPath, { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: parentVersion } })).rejects.toThrow(/Invalid bound/)
  expect(() => createCrudFormSectionMutationClient(policy('create'), otherVersion).parent('create')).toThrow(/Invalid bound/)
  expect(() => edit.section({ ...options('create'), expectedUpdatedAt: parentVersion })).toThrow(/Invalid bound/)
  expect(() => edit.section({ ...options('update'), expectedUpdatedAt: undefined })).toThrow(/Invalid bound/)
  expect(transport).not.toHaveBeenCalled()
  await bound.request('/api/Products/Section-Policy/?id=product-1', { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: parentVersion } })
  expect(transport).toHaveBeenCalledTimes(1)
})

it('passes through abort signals and the existing structured conflict error', async () => {
  const controller = new AbortController()
  const body = { error: 'record_modified', code: 'optimistic_lock_conflict', currentUpdatedAt: childVersion, expectedUpdatedAt: parentVersion }
  const transport = jest.fn(async () => new Response(JSON.stringify(body), { status: 409, headers: { 'content-type': 'application/json' } }))
  globalThis.fetch = transport
  const bound = createCrudFormSectionMutationClient(policy('update'), parentVersion).parent('update')!
  await expect(bound.request(parentPath, { signal: controller.signal })).rejects.toMatchObject({ status: 409, ...body })
  expect(transport).toHaveBeenCalledWith(parentPath, expect.objectContaining({ signal: controller.signal }))
})
