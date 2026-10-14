import { z } from 'zod'
import { buildOpenApiDocument } from '../generator'
import type { Module } from '../../../modules/registry'

type ParameterNode = { name?: string; in?: string; required?: boolean }
type OperationNode = { operationId?: string; parameters?: ParameterNode[] }

const noopHandler = async () => new Response(null)

function imageModule(extraApis: unknown[] = [], operationId?: string): Module {
  return {
    id: 'attachments',
    apis: [
      {
        path: '/attachments/image/[id]/[[...slug]]',
        handlers: { GET: noopHandler },
        docs: {
          methods: {
            GET: {
              summary: 'Serve image',
              ...(operationId ? { operationId } : {}),
              pathParams: z.object({ id: z.string().uuid() }),
              responses: [{ status: 200, description: 'Image' }],
            },
          },
        },
      },
      ...extraApis,
    ],
  } as unknown as Module
}

function operation(doc: ReturnType<typeof buildOpenApiDocument>, path: string): OperationNode | undefined {
  return (doc.paths[path] as Record<string, OperationNode> | undefined)?.get
}

function collectPathParameterViolations(doc: ReturnType<typeof buildOpenApiDocument>): string[] {
  const violations: string[] = []
  const operationIds = new Set<string>()
  for (const [path, item] of Object.entries(doc.paths)) {
    const templateNames = Array.from(path.matchAll(/\{([^}]+)\}/g), (match) => match[1])
    for (const [method, op] of Object.entries(item as Record<string, OperationNode>)) {
      const pathParams = (op.parameters ?? []).filter((param) => param.in === 'path')
      for (const param of pathParams) {
        if (param.required !== true) violations.push(`${method} ${path}: path parameter ${param.name} is not required`)
        if (!templateNames.includes(param.name ?? '')) violations.push(`${method} ${path}: path parameter ${param.name} is not in the template`)
      }
      for (const name of templateNames) {
        if (!pathParams.some((param) => param.name === name)) violations.push(`${method} ${path}: template variable ${name} is not declared`)
      }
      if (op.operationId) {
        if (operationIds.has(op.operationId)) violations.push(`${method} ${path}: duplicate operationId ${op.operationId}`)
        operationIds.add(op.operationId)
      }
    }
  }
  return violations
}

describe('buildOpenApiDocument optional catch-all path parameters', () => {
  it('emits id-only and id-plus-slug paths with only required path parameters', () => {
    const doc = buildOpenApiDocument([imageModule()])

    expect(collectPathParameterViolations(doc)).toEqual([])

    const withSlug = operation(doc, '/attachments/image/{id}/{slug}')
    const withoutSlug = operation(doc, '/attachments/image/{id}')
    expect(withSlug?.parameters?.filter((param) => param.in === 'path').map((param) => param.name)).toEqual(['id', 'slug'])
    expect(withoutSlug?.parameters?.filter((param) => param.in === 'path').map((param) => param.name)).toEqual(['id'])
  })

  it('keeps the published operationId on the slug path and gives the id-only path a distinct one', () => {
    const doc = buildOpenApiDocument([imageModule()])

    expect(operation(doc, '/attachments/image/{id}/{slug}')?.operationId).toBe('attachments_get_attachments_image_id_slug')
    expect(operation(doc, '/attachments/image/{id}')?.operationId).toBe('attachments_get_attachments_image_id')
  })

  it('derives a distinct id-only operationId from an explicit operationId', () => {
    const doc = buildOpenApiDocument([imageModule([], 'serveImage')])

    expect(operation(doc, '/attachments/image/{id}/{slug}')?.operationId).toBe('serveImage')
    expect(operation(doc, '/attachments/image/{id}')?.operationId).toBe('serveImage_without_slug')
  })

  it('never replaces a concrete route that owns the id-only path, whichever is registered first', () => {
    const concreteRoute = {
      path: '/attachments/image/[id]',
      handlers: { GET: noopHandler },
      docs: { methods: { GET: { summary: 'Concrete', operationId: 'concreteImage', responses: [{ status: 200, description: 'OK' }] } } },
    }
    const after = buildOpenApiDocument([imageModule([concreteRoute])])
    const before = buildOpenApiDocument([
      { id: 'other', apis: [concreteRoute] } as unknown as Module,
      imageModule(),
    ])

    expect(operation(after, '/attachments/image/{id}')?.operationId).toBe('concreteImage')
    expect(operation(before, '/attachments/image/{id}')?.operationId).toBe('concreteImage')
    expect(collectPathParameterViolations(after)).toEqual([])
  })
})
