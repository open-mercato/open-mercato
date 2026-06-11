/** @jest-environment node */

import { describe, expect, it } from '@jest/globals'
import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'
import { redactOpenApiSecurityMetadata } from '../redact-openapi-security'

describe('redactOpenApiSecurityMetadata', () => {
  it('removes ACL lines and x-require-* extensions from operations', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/api/example': {
          get: {
            summary: 'List',
            description: 'Base text\n\nRequires features: example.view\n\nRequires roles: admin',
            'x-require-features': ['example.view'],
            'x-require-roles': ['admin'],
            'x-require-auth': true,
          },
        },
      },
    } satisfies OpenApiDocument

    const redacted = redactOpenApiSecurityMetadata(doc)
    const operation = redacted.paths?.['/api/example']?.get as Record<string, unknown>

    expect(operation.description).toBe('Base text')
    expect(operation['x-require-features']).toBeUndefined()
    expect(operation['x-require-roles']).toBeUndefined()
    expect(operation['x-require-auth']).toBeUndefined()
  })

  it('drops description when only ACL lines were present', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/api/example': {
          post: {
            description: 'Requires features: example.manage',
          },
        },
      },
    } satisfies OpenApiDocument

    const redacted = redactOpenApiSecurityMetadata(doc)
    const operation = redacted.paths?.['/api/example']?.post as Record<string, unknown>
    expect(operation.description).toBeUndefined()
  })
})
