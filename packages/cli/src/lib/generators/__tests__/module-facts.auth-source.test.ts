import fs from 'node:fs'
import path from 'node:path'
import { extractModuleFacts } from '../module-facts'

function findCoreSrcRoot(): string {
  let dir = __dirname
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(dir, 'packages', 'core', 'src', 'modules')
    if (fs.existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  throw new Error('[internal] could not locate packages/core/src/modules from the test directory')
}

const REGISTRY_SOURCE = `
export const modules = [
  {
    id: 'customers',
    apis: [
      {
        path: '/api/customers/people',
        handlers: { GET: handlerGet, POST: handlerPost },
        metadata: {
          GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
          POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
        },
      },
      {
        path: '/api/customers/people/:id',
        handlers: { GET: handlerGet, PUT: handlerPut, DELETE: handlerDelete },
        metadata: {
          GET: { requireFeatures: ['customers.people.view'] },
          PUT: { requireFeatures: ['customers.people.manage'] },
          DELETE: { requireFeatures: ['customers.people.manage'] },
        },
      },
    ],
  },
  {
    id: 'sales',
    apis: [
      {
        path: '/api/sales/orders',
        handlers: { GET: handlerGet },
        metadata: { GET: { requireFeatures: ['sales.orders.view'] } },
      },
    ],
  },
]
`

describe('module-facts API route auth source (T2)', () => {
  const coreSrcRoot = findCoreSrcRoot()
  const facts = extractModuleFacts({ moduleId: 'customers', coreSrcRoot, registrySource: REGISTRY_SOURCE })

  it('reads per-method auth from the registry apis[].metadata for the requested module', () => {
    const list = facts.apiRoutes.find((route) => route.path === '/api/customers/people')
    expect(list).toBeDefined()
    expect(list?.methods).toEqual(['GET', 'POST'])
    expect(list?.auth.GET).toEqual({ requireAuth: true, requireFeatures: ['customers.people.view'] })
    expect(list?.auth.POST).toEqual({ requireAuth: true, requireFeatures: ['customers.people.manage'] })

    const detail = facts.apiRoutes.find((route) => route.path === '/api/customers/people/:id')
    expect(detail?.methods).toEqual(['GET', 'PUT', 'DELETE'])
    expect(detail?.auth.PUT).toEqual({ requireFeatures: ['customers.people.manage'] })
    expect(detail?.auth.DELETE).toEqual({ requireFeatures: ['customers.people.manage'] })
  })

  it('scopes routes to the requested module and ignores other modules in the registry', () => {
    expect(facts.apiRoutes.some((route) => route.path.startsWith('/api/sales/'))).toBe(false)
    expect(facts.warnings.some((warning) => warning.includes('module registry unavailable'))).toBe(false)
  })

  it('omits API routes (and warns) when a registry path is provided but the file is missing', () => {
    const missing = extractModuleFacts({
      moduleId: 'customers',
      coreSrcRoot,
      registryPath: path.join(coreSrcRoot, '__does_not_exist__', 'modules.runtime.generated.ts'),
    })
    expect(missing.apiRoutes).toEqual([])
    expect(missing.warnings.some((warning) => warning.includes('module registry unavailable'))).toBe(true)
  })
})
