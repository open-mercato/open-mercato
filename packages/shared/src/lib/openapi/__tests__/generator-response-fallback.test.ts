import { z } from 'zod'
import { buildOpenApiDocument } from '../generator'
import type { Module } from '../../../modules/registry'

type SchemaNode = {
  type?: string
  description?: string
  properties?: Record<string, SchemaNode>
}

type OperationNode = {
  responses?: Record<string, { content?: Record<string, { schema?: SchemaNode }> }>
}

const noopHandler = async () => new Response(null)

function makeModules(): Module[] {
  return [
    {
      id: 'example',
      apis: [
        {
          path: '/example/undeclared',
          handlers: { GET: noopHandler },
          docs: {
            methods: {
              GET: {
                summary: 'Undeclared schema',
                responses: [{ status: 200, description: 'Success' }],
              },
            },
          },
        },
        {
          path: '/example/declared',
          handlers: { GET: noopHandler },
          docs: {
            methods: {
              GET: {
                summary: 'Declared schema',
                responses: [
                  { status: 200, description: 'Success', schema: z.object({ ok: z.boolean() }) },
                ],
              },
            },
          },
        },
      ],
    } as unknown as Module,
  ]
}

function responseSchema(doc: ReturnType<typeof buildOpenApiDocument>, path: string): SchemaNode | undefined {
  const pathItem = doc.paths[path] as Record<string, OperationNode> | undefined
  return pathItem?.get?.responses?.['200']?.content?.['application/json']?.schema
}

describe('buildOpenApiDocument response schema fallback', () => {
  it('marks responses without a declared schema with an advisory description', () => {
    const doc = buildOpenApiDocument(makeModules())
    expect(responseSchema(doc, '/example/undeclared')).toEqual({
      type: 'object',
      description: 'Schema not declared',
    })
  })

  it('leaves declared schemas untouched', () => {
    const doc = buildOpenApiDocument(makeModules())
    const schema = responseSchema(doc, '/example/declared')
    expect(schema?.description).toBeUndefined()
    expect(schema?.properties?.ok?.type).toBe('boolean')
  })
})
