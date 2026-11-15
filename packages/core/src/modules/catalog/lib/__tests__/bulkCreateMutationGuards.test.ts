/** @jest-environment node */

import type { AwilixContainer } from 'awilix'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard, MutationGuardInput } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { runBulkCreateMutationGuards } from '../bulkCreateMutationGuards'

const container = {
  resolve: () => undefined,
} as unknown as AwilixContainer

function guard(overrides: Partial<MutationGuard> & Pick<MutationGuard, 'validate'>): MutationGuard {
  return {
    id: 'test.guard',
    targetEntity: 'catalog.product',
    operations: ['create'],
    ...overrides,
  }
}

function run(resourceKind: string, auth: unknown = { features: [] }) {
  return runBulkCreateMutationGuards({
    container,
    auth,
    request: new Request('http://localhost/api/catalog/products/bulk-create', {
      method: 'POST',
      headers: { 'x-test': '1' },
    }),
    tenantId: 'tenant-1',
    organizationId: 'org-b',
    userId: 'user-1',
    resourceKind,
    itemCount: 3,
  })
}

describe('runBulkCreateMutationGuards', () => {
  afterEach(() => {
    registerMutationGuards([])
  })

  it('passes the batch envelope to a matching create guard', async () => {
    const validate = jest.fn(async (_input: MutationGuardInput) => ({ ok: true }))
    registerMutationGuards([{ moduleId: 'test', guards: [guard({ validate })] }])

    await expect(run('catalog.product')).resolves.toEqual({ ok: true })

    expect(validate).toHaveBeenCalledTimes(1)
    const input = validate.mock.calls[0][0]
    expect(input).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-b',
      userId: 'user-1',
      resourceKind: 'catalog.product',
      resourceId: null,
      operation: 'create',
      requestMethod: 'POST',
      mutationPayload: { bulk: true, itemCount: 3 },
    })
    expect(input.requestHeaders.get('x-test')).toBe('1')
  })

  it('blocks the batch with the guard status and body when a guard rejects', async () => {
    registerMutationGuards([
      {
        moduleId: 'test',
        guards: [guard({ validate: async () => ({ ok: false, status: 423, body: { error: 'Locked' } }) })],
      },
    ])

    await expect(run('catalog.product')).resolves.toEqual({
      ok: false,
      status: 423,
      body: { error: 'Locked' },
    })
  })

  it('ignores guards registered for another entity', async () => {
    const validate = jest.fn(async () => ({ ok: false }))
    registerMutationGuards([{ moduleId: 'test', guards: [guard({ validate })] }])

    await expect(run('catalog.category')).resolves.toEqual({ ok: true })
    expect(validate).not.toHaveBeenCalled()
  })

  it('applies feature-gated guards only to callers holding the feature', async () => {
    const validate = jest.fn(async () => ({ ok: false, message: 'Blocked' }))
    registerMutationGuards([
      { moduleId: 'test', guards: [guard({ validate, features: ['catalog.bulk.restricted'] })] },
    ])

    await expect(run('catalog.product', { features: [] })).resolves.toEqual({ ok: true })
    await expect(run('catalog.product', { features: ['catalog.bulk.restricted'] })).resolves.toEqual({
      ok: false,
      status: 422,
      body: { error: 'Blocked', guardId: 'test.guard' },
    })
  })
})
