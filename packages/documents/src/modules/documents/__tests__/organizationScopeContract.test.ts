import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const translateMock = jest.fn((key: string, fallback?: string) => fallback ?? key)

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: translateMock }),
}))

import {
  handleDocumentsRouteError,
  ORGANIZATION_SCOPE_REQUIRED_DESCRIPTION,
  routeErrorSchema,
  withDocumentsContextErrors,
} from '../api/_shared'

// `resolveDocumentsContext` answers 400 with the `organization_scope_required`
// discriminator for an unrestricted caller with no resolvable organization, and
// every documents route resolves a context. The runtime shape and the declared
// contract must agree: a generated client that only knows `{ error }` cannot
// tell that recoverable state apart from an ordinary validation rejection.
describe('documents organization-scope error contract', () => {
  it('accepts the discriminator in the shared route error schema', () => {
    const parsed = routeErrorSchema.safeParse({
      error: 'Organization context is required',
      code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
    })
    expect(parsed.success).toBe(true)
    // The code stays optional so error bodies that carry only a message keep
    // validating against the same schema.
    expect(routeErrorSchema.safeParse({ error: 'Forbidden' }).success).toBe(true)
  })

  it('serializes the route response with the declared discriminator', async () => {
    const response = await handleDocumentsRouteError(
      new CrudHttpError(400, {
        error: 'documents.errors.organizationRequired',
        code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
      }),
      'documents.test',
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toMatchObject({ code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE })
    // The serialized body must validate against the schema the routes publish.
    expect(routeErrorSchema.safeParse(body).success).toBe(true)
  })

  it('declares the 400 on a method whose own contract has none', () => {
    const doc: OpenApiRouteDoc = {
      tag: 'Documents',
      methods: {
        GET: {
          summary: 'Read',
          responses: [{ status: 200, description: 'OK', schema: z.object({ id: z.string() }) }],
          errors: [{ status: 403, description: 'Forbidden', schema: routeErrorSchema }],
        },
      },
    }

    const errors = withDocumentsContextErrors(doc).methods.GET?.errors ?? []
    const scopeError = errors.find((error) => error.status === 400)
    expect(scopeError?.description).toBe(ORGANIZATION_SCOPE_REQUIRED_DESCRIPTION)
    expect(scopeError?.schema).toBe(routeErrorSchema)
    expect(errors.filter((error) => error.status === 403)).toHaveLength(1)
  })

  it('merges into an existing 400 instead of emitting a second one', () => {
    // Responses are keyed by status when the OpenAPI document is built, so a
    // second 400 entry would silently replace the route's validation error.
    const doc: OpenApiRouteDoc = {
      tag: 'Documents',
      methods: {
        POST: {
          summary: 'Create',
          errors: [{ status: 400, description: 'Validation failed', schema: routeErrorSchema }],
        },
      },
    }

    const errors = withDocumentsContextErrors(doc).methods.POST?.errors ?? []
    expect(errors.filter((error) => error.status === 400)).toHaveLength(1)
    expect(errors[0]?.description).toBe(
      `Validation failed, or ${ORGANIZATION_SCOPE_REQUIRED_DESCRIPTION}`,
    )
  })

  it('covers every declared method and leaves the rest of the doc untouched', () => {
    const doc: OpenApiRouteDoc = {
      tag: 'Documents',
      summary: 'Document collection',
      methods: {
        GET: { summary: 'List' },
        POST: { summary: 'Create' },
        DELETE: { summary: 'Delete' },
      },
    }

    const wrapped = withDocumentsContextErrors(doc)
    expect(wrapped.tag).toBe('Documents')
    expect(wrapped.summary).toBe('Document collection')
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const errors = wrapped.methods[method]?.errors ?? []
      expect(errors.some((error) => error.status === 400)).toBe(true)
    }
    expect(doc.methods.GET?.errors).toBeUndefined()
  })

  it('names the discriminator in the published description', () => {
    expect(ORGANIZATION_SCOPE_REQUIRED_DESCRIPTION).toContain(ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE)
  })
})
