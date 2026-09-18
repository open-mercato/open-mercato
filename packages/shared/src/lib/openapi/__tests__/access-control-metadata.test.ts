import { buildOpenApiDocument, generateMarkdownFromOpenApi } from '../generator'
import type { Module, ModuleApiRouteFile } from '../../../modules/registry'

const routePath = '/example/records'

function makeModule(): Module {
  const api: ModuleApiRouteFile = {
    path: routePath,
    metadata: {
      GET: {
        requireAuth: true,
        requireFeatures: ['example.records.view'],
        requireRoles: ['admin'],
      },
    },
    handlers: { GET: async () => new Response(null) },
    docs: {
      tag: 'Example',
      methods: { GET: { description: 'List records', responses: [{ status: 200, description: 'Records' }] } },
    },
  }
  return { id: 'example', apis: [api] }
}

function buildOperation(includeAccessControlMetadata?: boolean) {
  const doc = buildOpenApiDocument([makeModule()], { includeAccessControlMetadata })
  return { doc, operation: doc.paths[routePath]?.get as Record<string, unknown> }
}

describe('buildOpenApiDocument access-control metadata', () => {
  it('exposes feature and role identifiers by default', () => {
    const { operation } = buildOperation()

    expect(operation.description).toContain('Requires features: example.records.view')
    expect(operation.description).toContain('Requires roles: admin')
    expect(operation['x-require-features']).toEqual(['example.records.view'])
    expect(operation['x-require-roles']).toEqual(['admin'])
  })

  it('strips feature and role identifiers when access-control metadata is excluded', () => {
    const { operation } = buildOperation(false)

    expect(operation.description).toBe('List records')
    expect(operation['x-require-features']).toBeUndefined()
    expect(operation['x-require-roles']).toBeUndefined()
  })

  it('keeps the authentication requirement and security scheme when identifiers are stripped', () => {
    const { operation } = buildOperation(false)

    expect(operation['x-require-auth']).toBe(true)
    expect(operation.security).toBeDefined()
    expect((operation.responses as Record<string, unknown>)['401']).toBeDefined()
  })

  it('keeps the identifiers out of the generated markdown', () => {
    const { doc: publicDoc } = buildOperation(false)
    const { doc: privateDoc } = buildOperation()

    const publicMarkdown = generateMarkdownFromOpenApi(publicDoc)
    const privateMarkdown = generateMarkdownFromOpenApi(privateDoc)

    expect(publicMarkdown).not.toContain('example.records.view')
    expect(publicMarkdown).not.toContain('**Roles:**')
    expect(publicMarkdown).toContain('Requires authentication.')
    expect(privateMarkdown).toContain('example.records.view')
    expect(privateMarkdown).toContain('**Roles:** admin')
  })
})
