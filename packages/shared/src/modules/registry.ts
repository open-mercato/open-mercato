import type { ReactNode } from 'react'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiHandler = (req: Request, ctx?: any) => Promise<Response> | Response

export type ModuleRoute = {
  pattern?: string
  path?: string
  requireAuth?: boolean
  requireRoles?: string[]
  title?: string
  group?: string
  icon?: string
  order?: number
  navHidden?: boolean
  visible?: (ctx: { path?: string; auth?: any }) => boolean | Promise<boolean>
  enabled?: (ctx: { path?: string; auth?: any }) => boolean | Promise<boolean>
  Component: (props: any) => ReactNode | Promise<ReactNode>
}

export type ModuleApiLegacy = {
  method: HttpMethod
  path: string
  handler: ApiHandler
}

export type ModuleApiRouteFile = {
  path: string
  handlers: Partial<Record<HttpMethod, ApiHandler>>
  requireAuth?: boolean
  requireRoles?: string[]
}

export type ModuleApi = ModuleApiLegacy | ModuleApiRouteFile

export type ModuleCli = {
  command: string
  run: (argv: string[]) => Promise<void> | void
}

export type ModuleInfo = {
  name?: string
  title?: string
  version?: string
  description?: string
  author?: string
  license?: string
  homepage?: string
  copyright?: string
}

export type Module = {
  id: string
  info?: ModuleInfo
  backendRoutes?: ModuleRoute[]
  frontendRoutes?: ModuleRoute[]
  apis?: ModuleApi[]
  cli?: ModuleCli[]
  translations?: Record<string, Record<string, string>>
  // Auto-discovered event subscribers
  subscribers?: Array<{
    id: string
    event: string
    persistent?: boolean
    // Imported function reference; will be registered into event bus
    handler: (payload: any, ctx: any) => Promise<void> | void
  }>
  // Optional: per-module declared entity extensions and custom fields (static)
  // These are discovered from data/extensions.ts and data/fields.ts
  entityExtensions?: import('./entities').EntityExtension[]
  customFieldSets?: import('./entities').CustomFieldSet[]
}

function normPath(s: string) {
  return (s.startsWith('/') ? s : '/' + s).replace(/\/+$/, '') || '/'
}

function matchPattern(pattern: string, pathname: string): Record<string, string | string[]> | undefined {
  const p = normPath(pattern)
  const u = normPath(pathname)
  const pSegs = p.split('/').slice(1)
  const uSegs = u.split('/').slice(1)
  const params: Record<string, string | string[]> = {}
  let i = 0
  for (let j = 0; j < pSegs.length; j++, i++) {
    const seg = pSegs[j]
    const mCatchAll = seg.match(/^\[\.\.\.(.+)\]$/)
    const mOptCatch = seg.match(/^\[\[\.\.\.(.+)\]\]$/)
    const mDyn = seg.match(/^\[(.+)\]$/)
    if (mCatchAll) {
      const key = mCatchAll[1]
      if (i >= uSegs.length) return undefined
      params[key] = uSegs.slice(i)
      i = uSegs.length
      return i === uSegs.length ? params : undefined
    } else if (mOptCatch) {
      const key = mOptCatch[1]
      params[key] = i < uSegs.length ? uSegs.slice(i) : []
      i = uSegs.length
      return params
    } else if (mDyn) {
      if (i >= uSegs.length) return undefined
      params[mDyn[1]] = uSegs[i]
    } else {
      if (i >= uSegs.length || uSegs[i] !== seg) return undefined
    }
  }
  if (i !== uSegs.length) return undefined
  return params
}

function getPattern(r: ModuleRoute) {
  return r.pattern ?? r.path ?? '/'
}

export function findFrontendMatch(modules: Module[], pathname: string): { route: ModuleRoute; params: Record<string, string | string[]> } | undefined {
  for (const m of modules) {
    const routes = m.frontendRoutes ?? []
    for (const r of routes) {
      const params = matchPattern(getPattern(r), pathname)
      if (params) return { route: r, params }
    }
  }
}

export function findBackendMatch(modules: Module[], pathname: string): { route: ModuleRoute; params: Record<string, string | string[]> } | undefined {
  for (const m of modules) {
    const routes = m.backendRoutes ?? []
    for (const r of routes) {
      const params = matchPattern(getPattern(r), pathname)
      if (params) return { route: r, params }
    }
  }
}

export function findApi(modules: Module[], method: HttpMethod, pathname: string): { handler: ApiHandler; params: Record<string, string | string[]>; requireAuth?: boolean; requireRoles?: string[] } | undefined {
  for (const m of modules) {
    const apis = m.apis ?? []
    for (const a of apis) {
      if ('handlers' in a) {
        const params = matchPattern(a.path, pathname)
        const handler = (a.handlers as any)[method]
        if (params && handler) return { handler, params, requireAuth: a.requireAuth, requireRoles: (a as any).requireRoles }
      } else {
        const al = a as ModuleApiLegacy
        if (al.method === method && al.path === pathname) {
          return { handler: al.handler, params: {} }
        }
      }
    }
  }
}
