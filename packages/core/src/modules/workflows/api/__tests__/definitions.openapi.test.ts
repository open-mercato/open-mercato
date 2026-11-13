/**
 * Workflow Definitions OpenAPI Tests (#4230)
 *
 * Asserts the generated OpenAPI document for the definitions routes carries
 * typed response schemas (with `definition` as an object schema exposing
 * steps/transitions) instead of the bare `{ type: 'object' }` fallback.
 */

import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi/generator'
import type { Module } from '@open-mercato/shared/modules/registry'
import { openApi as definitionsOpenApi } from '../definitions/route'
import { openApi as definitionDetailOpenApi } from '../definitions/[id]/route'
import { openApi as customizeOpenApi } from '../definitions/[id]/customize/route'
import { openApi as resetToCodeOpenApi } from '../definitions/[id]/reset-to-code/route'
import { openApi as contextSchemaOpenApi } from '../definitions/[id]/context-schema/route'
import { openApi as testStepOpenApi } from '../definitions/[id]/test-step/route'

type SchemaNode = {
  type?: string
  description?: string
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  anyOf?: SchemaNode[]
  oneOf?: SchemaNode[]
  required?: string[]
  additionalProperties?: SchemaNode | boolean
  enum?: Array<string | boolean>
}

type MediaTypeNode = { schema?: SchemaNode; example?: unknown }
type OperationNode = {
  responses?: Record<string, { content?: Record<string, MediaTypeNode> }>
}

const noopHandler = async () => new Response(null)

function buildDoc() {
  const modules = [
    {
      id: 'workflows',
      apis: [
        {
          path: '/workflows/definitions',
          handlers: { GET: noopHandler, POST: noopHandler },
          docs: definitionsOpenApi,
        },
        {
          path: '/workflows/definitions/[id]',
          handlers: { GET: noopHandler, PUT: noopHandler, DELETE: noopHandler },
          docs: definitionDetailOpenApi,
        },
        {
          path: '/workflows/definitions/[id]/customize',
          handlers: { POST: noopHandler },
          docs: customizeOpenApi,
        },
        {
          path: '/workflows/definitions/[id]/reset-to-code',
          handlers: { POST: noopHandler },
          docs: resetToCodeOpenApi,
        },
        {
          path: '/workflows/definitions/[id]/context-schema',
          handlers: { GET: noopHandler },
          docs: contextSchemaOpenApi,
        },
        {
          path: '/workflows/definitions/[id]/test-step',
          handlers: { POST: noopHandler },
          docs: testStepOpenApi,
        },
      ],
    } as unknown as Module,
  ]
  return buildOpenApiDocument(modules)
}

function mediaTypeFor(path: string, method: string, status: string): MediaTypeNode {
  const doc = buildDoc()
  const pathItem = doc.paths[path] as Record<string, OperationNode> | undefined
  const operation = pathItem?.[method]
  const media = operation?.responses?.[status]?.content?.['application/json']
  expect(media).toBeDefined()
  return media as MediaTypeNode
}

function schemaFor(path: string, method: string, status: string): SchemaNode {
  const media = mediaTypeFor(path, method, status)
  expect(media.schema).toBeDefined()
  return media.schema as SchemaNode
}

function expectTypedDefinition(itemSchema: SchemaNode | undefined) {
  expect(itemSchema?.type).toBe('object')
  expect(itemSchema?.description).not.toBe('Schema not declared')
  const definition = itemSchema?.properties?.definition
  expect(definition?.type).toBe('object')
  expect(definition?.properties?.steps?.type).toBe('array')
  expect(definition?.properties?.transitions?.type).toBe('array')
}

describe('Workflow Definitions OpenAPI response schemas', () => {
  it('types the list GET 200 response and keeps the example', () => {
    const media = mediaTypeFor('/workflows/definitions', 'get', '200')
    const schema = media.schema as SchemaNode
    expect(schema.type).toBe('object')
    expect(schema.properties?.data?.type).toBe('array')
    expectTypedDefinition(schema.properties?.data?.items)
    expect(['integer', 'number']).toContain(schema.properties?.pagination?.properties?.total?.type)
    expect(media.example).toBeDefined()
  })

  it('types the create POST 201 response', () => {
    const schema = schemaFor('/workflows/definitions', 'post', '201')
    expectTypedDefinition(schema.properties?.data)
    expect(schema.properties?.message?.type).toBe('string')
  })

  it('types the detail GET 200 response', () => {
    const schema = schemaFor('/workflows/definitions/{id}', 'get', '200')
    expectTypedDefinition(schema.properties?.data)
  })

  it('types the update PUT 200 response', () => {
    const schema = schemaFor('/workflows/definitions/{id}', 'put', '200')
    expectTypedDefinition(schema.properties?.data)
    expect(schema.properties?.message?.type).toBe('string')
  })

  it('types the customize POST 200 response', () => {
    const schema = schemaFor('/workflows/definitions/{id}/customize', 'post', '200')
    expectTypedDefinition(schema.properties?.data)
    expect(schema.properties?.message?.type).toBe('string')
  })

  it('types the reset-to-code POST 200 response with a nullable data payload', () => {
    const schema = schemaFor('/workflows/definitions/{id}/reset-to-code', 'post', '200')
    const dataSchema = schema.properties?.data
    expect(dataSchema?.anyOf).toBeDefined()
    const objectBranch = dataSchema?.anyOf?.find((branch) => branch.type === 'object')
    expectTypedDefinition(objectBranch)
    expect(schema.properties?.message?.type).toBe('string')
  })

  it('types the context-schema GET 200 response as a per-step ledger map', () => {
    const schema = schemaFor('/workflows/definitions/{id}/context-schema', 'get', '200')
    expect(schema.type).toBe('object')
    expect(schema.description).not.toBe('Schema not declared')
    const steps = schema.properties?.steps
    expect(steps?.type).toBe('object')
    const stepSchema = steps?.additionalProperties
    expect(typeof stepSchema).toBe('object')
    const entries = (stepSchema as SchemaNode).properties?.entries
    expect(entries?.type).toBe('array')
    const entry = entries?.items
    expect(entry?.properties?.path?.type).toBe('string')
    expect(entry?.properties?.type?.enum).toContain('unknown')
    expect(entry?.properties?.presence?.enum).toEqual(['always', 'maybe'])
    expect(entry?.properties?.source?.properties?.kind?.enum).toContain('asyncResult')
  })

  it('types the test-step POST 200 response as a simulated/refused union', () => {
    const schema = schemaFor('/workflows/definitions/{id}/test-step', 'post', '200')
    expect(schema.description).not.toBe('Schema not declared')
    const branches = schema.oneOf ?? schema.anyOf
    expect(branches).toBeDefined()
    const simulatedBranch = branches?.find((branch) => branch.properties?.simulated)
    expect(simulatedBranch?.properties?.interpolatedConfig?.type).toBe('object')
    expect(simulatedBranch?.properties?.activityType?.type).toBe('string')
    const refusedBranch = branches?.find((branch) => branch.properties?.refused)
    expect(refusedBranch?.properties?.reason?.enum).toEqual(['refused', 'noMock'])
  })

  it('types the error responses with the shared error schema', () => {
    const schema = schemaFor('/workflows/definitions/{id}', 'get', '404')
    expect(schema.properties?.error?.type).toBe('string')
    expect(schema.description).not.toBe('Schema not declared')
  })
})
