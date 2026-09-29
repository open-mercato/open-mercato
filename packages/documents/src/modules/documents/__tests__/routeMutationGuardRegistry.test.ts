import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DocumentsRouteContext } from '../api/_shared'
import { runMutationGuardAfterSuccess, validateMutationGuard } from '../api/_shared'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'

// Registry-only by design: the legacy DI guard resolves to `undefined` so the
// bridge disables itself and every assertion below is about registry guards.
function makeContext(
  registrations: Record<string, unknown> = { crudMutationGuardService: undefined },
): DocumentsRouteContext {
  return {
    container: {
      resolve: (name: string) => {
        if (Object.prototype.hasOwnProperty.call(registrations, name)) return registrations[name]
        throw new Error(`[test] no registration for ${name}`)
      },
    } as unknown as AwilixContainer,
    em: {} as DocumentsRouteContext['em'],
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      features: ['documents.edit'],
    } as unknown as DocumentsRouteContext['auth'],
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    request: new Request('https://example.test/api/documents', { method: 'PUT' }),
  }
}

afterEach(() => {
  registerMutationGuards([])
  jest.restoreAllMocks()
})

// `validateCrudMutationGuard()`/`runCrudMutationGuardAfterSuccess()` only ever
// invoked the single DI-registered `crudMutationGuardService`, so every guard a
// module contributed through the registry was silently skipped on Documents
// writes. These cases pin the three behaviours a registry-only guard must have.
describe('documents route mutation guards run the registry', () => {
  it('blocks the write when a registry-only guard rejects', async () => {
    const guard: MutationGuard = {
      id: 'documents-block-guard',
      targetEntity: 'documents.document',
      operations: ['update'],
      validate: jest.fn().mockResolvedValue({ ok: false, status: 422, body: { error: 'blocked-by-registry' } }),
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    const error = await validateMutationGuard(makeContext(), {
      resourceKind: 'documents.document',
      resourceId: DOCUMENT_ID,
      operation: 'update',
      mutationPayload: { title: 'Original' },
    }).catch((caught) => caught)

    expect(guard.validate).toHaveBeenCalledTimes(1)
    expect(isCrudHttpError(error)).toBe(true)
    expect(error).toMatchObject({ status: 422, body: { error: 'blocked-by-registry' } })
  })

  it('applies a registry guard payload transformation before the command runs', async () => {
    const guard: MutationGuard = {
      id: 'documents-transform-guard',
      targetEntity: 'documents.document',
      operations: ['update'],
      validate: jest.fn().mockResolvedValue({
        ok: true,
        modifiedPayload: { title: 'Rewritten by guard' },
      }),
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    const payload: Record<string, unknown> = { title: 'Original' }
    const result = await validateMutationGuard(makeContext(), {
      resourceKind: 'documents.document',
      resourceId: DOCUMENT_ID,
      operation: 'update',
      mutationPayload: payload,
      mutationPayloadSchema: z.object({ title: z.string().min(1) }),
    })

    expect(result.ok).toBe(true)
    // The route reads the same object it handed in, so the transformation has to
    // land there — not only on the guard result.
    expect(payload).toEqual({ title: 'Rewritten by guard' })
  })

  it('rejects a registry transformation that violates the route payload schema', async () => {
    const guard: MutationGuard = {
      id: 'documents-bad-transform-guard',
      targetEntity: 'documents.document',
      operations: ['update'],
      validate: jest.fn().mockResolvedValue({ ok: true, modifiedPayload: { title: '' } }),
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    await expect(validateMutationGuard(makeContext(), {
      resourceKind: 'documents.document',
      resourceId: DOCUMENT_ID,
      operation: 'update',
      mutationPayload: { title: 'Original' },
      mutationPayloadSchema: z.object({ title: z.string().min(1) }),
    })).rejects.toBeInstanceOf(z.ZodError)
  })

  it('runs the registry guard cleanup after the write commits', async () => {
    const afterSuccess = jest.fn().mockResolvedValue(undefined)
    const guard: MutationGuard = {
      id: 'documents-cleanup-guard',
      targetEntity: 'documents.document',
      operations: ['update'],
      validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true }),
      afterSuccess,
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    const ctx = makeContext()
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: 'documents.document',
      resourceId: DOCUMENT_ID,
      operation: 'update',
      mutationPayload: { title: 'Original' },
    })
    expect(afterSuccess).not.toHaveBeenCalled()

    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: 'documents.document',
      resourceId: DOCUMENT_ID,
      operation: 'update',
    })

    expect(afterSuccess).toHaveBeenCalledTimes(1)
  })
})
