import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  extractNamedObjectLiteralExport,
  hasNamedExport,
  resolveNamedObjectExport,
} from '../module-registry'

let tmpDir: string

function writeSource(fileName: string, source: string): string {
  const fullPath = path.join(tmpDir, fileName)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, source)
  return fullPath
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-extraction-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('extractNamedObjectLiteralExport', () => {
  it('resolves a direct object literal export', () => {
    const file = writeSource('route.ts', `
      export const metadata = {
        GET: { requireAuth: true, requireFeatures: ['auth.users.view'] },
        POST: { requireAuth: true, requireFeatures: ['auth.users.manage'] },
      }
    `)
    expect(extractNamedObjectLiteralExport(file, 'metadata')).toEqual({
      GET: { requireAuth: true, requireFeatures: ['auth.users.view'] },
      POST: { requireAuth: true, requireFeatures: ['auth.users.manage'] },
    })
  })

  it('resolves an object literal containing a local identifier value', () => {
    const file = writeSource('route.ts', `
      const FEATURE = 'dashboards.admin.assign-widgets'
      export const metadata = {
        GET: { requireAuth: true, requireFeatures: [FEATURE] },
        PUT: { requireAuth: true, requireFeatures: [FEATURE] },
      }
    `)
    expect(extractNamedObjectLiteralExport(file, 'metadata')).toEqual({
      GET: { requireAuth: true, requireFeatures: ['dashboards.admin.assign-widgets'] },
      PUT: { requireAuth: true, requireFeatures: ['dashboards.admin.assign-widgets'] },
    })
  })

  it('resolves an identifier reference export (export const metadata = routeMetadata)', () => {
    const file = writeSource('route.ts', `
      const routeMetadata = {
        GET: { requireAuth: true, requireFeatures: ['auth.roles.list'] },
        POST: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
      }
      export const metadata = routeMetadata
    `)
    expect(extractNamedObjectLiteralExport(file, 'metadata')).toEqual({
      GET: { requireAuth: true, requireFeatures: ['auth.roles.list'] },
      POST: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
    })
  })

  it('resolves property access on a factory call (export const metadata = crud.metadata)', () => {
    const file = writeSource('route.ts', `
      const routeMetadata = {
        GET: { requireAuth: true, requireFeatures: ['webhooks.view'] },
        POST: { requireAuth: true, requireFeatures: ['webhooks.manage'] },
      }
      const crud = makeCrudRoute({
        metadata: routeMetadata,
        orm: { entity: Thing, idField: 'id' },
      })
      export const metadata = crud.metadata
    `)
    expect(extractNamedObjectLiteralExport(file, 'metadata')).toEqual({
      GET: { requireAuth: true, requireFeatures: ['webhooks.view'] },
      POST: { requireAuth: true, requireFeatures: ['webhooks.manage'] },
    })
  })

  it('resolves a destructured export (export const { metadata } = makeCrudRoute(...))', () => {
    const file = writeSource('route.ts', `
      export const { metadata, GET, POST } = makeCrudRoute({
        metadata: {
          GET: { requireAuth: true, requireFeatures: ['example.todos.view'] },
          POST: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
        },
        orm: { entity: Todo, idField: 'id' },
      })
    `)
    expect(extractNamedObjectLiteralExport(file, 'metadata')).toEqual({
      GET: { requireAuth: true, requireFeatures: ['example.todos.view'] },
      POST: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
    })
  })

  it('resolves const-destructuring combined with re-export (export { metadata })', () => {
    const file = writeSource('route.ts', `
      const { GET, metadata, openApi } = makeDashboardWidgetRoute({
        metadata: {
          GET: { requireAuth: true, requireFeatures: ['dashboards.view'] },
        },
      })
      export { GET, metadata, openApi }
    `)
    expect(extractNamedObjectLiteralExport(file, 'metadata')).toEqual({
      GET: { requireAuth: true, requireFeatures: ['dashboards.view'] },
    })
  })

  it('unwraps as-expressions and type assertions', () => {
    const file = writeSource('route.ts', `
      const routeMetadata = {
        GET: { requireAuth: true },
      } as const
      export const metadata = routeMetadata as Record<string, unknown>
    `)
    expect(extractNamedObjectLiteralExport(file, 'metadata')).toEqual({
      GET: { requireAuth: true },
    })
  })

  it('handles spread assignments inside nested objects', () => {
    const file = writeSource('route.ts', `
      const base = { requireAuth: true, requireFeatures: ['x.view'] }
      export const metadata = {
        GET: { ...base },
        POST: { ...base, requireFeatures: ['x.manage'] },
      }
    `)
    expect(extractNamedObjectLiteralExport(file, 'metadata')).toEqual({
      GET: { requireAuth: true, requireFeatures: ['x.view'] },
      POST: { requireAuth: true, requireFeatures: ['x.manage'] },
    })
  })

  it('returns null when no metadata export exists', () => {
    const file = writeSource('route.ts', `
      export async function GET() { return new Response('ok') }
    `)
    expect(resolveNamedObjectExport(file, 'metadata')).toBeNull()
  })

  it('returns null when destructured source cannot be resolved (factory without literal arg)', () => {
    const file = writeSource('route.ts', `
      const route = makeStatusDictionaryRoute({ kind: 'order-status' })
      export const metadata = route.metadata
    `)
    expect(resolveNamedObjectExport(file, 'metadata')).toBeNull()
  })

  it('avoids infinite recursion on self-referencing identifiers', () => {
    const file = writeSource('route.ts', `
      const metadata = metadata
      export { metadata }
    `)
    // Should not hang; either returns null or a degenerate value.
    expect(resolveNamedObjectExport(file, 'metadata')).toBeNull()
  })
})

describe('hasNamedExport', () => {
  it('detects a direct export const', () => {
    const file = writeSource('route.ts', `
      export const metadata = { GET: { requireAuth: true } }
    `)
    expect(hasNamedExport(file, 'metadata')).toBe(true)
  })

  it('detects a destructured export const', () => {
    const file = writeSource('route.ts', `
      export const { metadata, GET } = makeCrudRoute({ metadata: {} })
    `)
    expect(hasNamedExport(file, 'metadata')).toBe(true)
  })

  it('detects a named re-export clause', () => {
    const file = writeSource('route.ts', `
      const { metadata } = makeDashboardWidgetRoute({})
      export { metadata }
    `)
    expect(hasNamedExport(file, 'metadata')).toBe(true)
  })

  it('detects a renamed re-export (export { GET as metadata })', () => {
    const file = writeSource('route.ts', `
      const foo = {}
      export { foo as metadata }
    `)
    expect(hasNamedExport(file, 'metadata')).toBe(true)
  })

  it('detects a cross-module re-export (export { metadata } from "..")', () => {
    const file = writeSource('route.ts', `
      export { metadata, GET } from '../other/route'
    `)
    expect(hasNamedExport(file, 'metadata')).toBe(true)
  })

  it('returns false when metadata is not exported', () => {
    const file = writeSource('route.ts', `
      export async function GET() {}
    `)
    expect(hasNamedExport(file, 'metadata')).toBe(false)
  })

  it('returns false for non-exported local const with matching name', () => {
    const file = writeSource('route.ts', `
      const metadata = { GET: { requireAuth: true } }
      export async function GET() {}
    `)
    expect(hasNamedExport(file, 'metadata')).toBe(false)
  })
})
