import type { ReactNode } from 'react'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiHandler = (req: Request, ctx?: any) => Promise<Response> | Response

export type ModuleRoute = {
  // Next-style pattern, supports dynamic segments like '/blog/[id]' or '[...slug]'.
  // Backwards-compat: older registry may provide `path`.
  pattern?: string
  path?: string
  requireAuth?: boolean
  requireRoles?: string[]
  title?: string
  group?: string
  Component: (props: any) => ReactNode | Promise<ReactNode>
}

// Legacy per-method entries
export type ModuleApiLegacy = {
  method: HttpMethod
  path: string
  handler: ApiHandler
}

// New Next-style route file that can expose multiple HTTP methods in one file
export type ModuleApiRouteFile = {
  path: string // may include dynamic segments like '/blog/[id]'
  handlers: Partial<Record<HttpMethod, ApiHandler>>
  requireAuth?: boolean
  requireRoles?: string[]
}

export type ModuleApi = ModuleApiLegacy | ModuleApiRouteFile

export type ModuleCli = {
  command: string // e.g. 'add-user'
  run: (argv: string[]) => Promise<void> | void
}

export type ErpModule = {
  id: string // plural snake_case (special cases: 'auth', 'example')
  backendRoutes?: ModuleRoute[]
  frontendRoutes?: ModuleRoute[]
  apis?: ModuleApi[]
  cli?: ModuleCli[]
  translations?: Record<string, Record<string, string>>
}

// Auto-generated modules list
import { modules } from './generated'
export { modules }

// --- Routing helpers ---

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
    const mCatchAll = seg.match(/^\[\.\.\.(.+)\]$/) // [...slug]
    const mOptCatch = seg.match(/^\[\[\.\.\.(.+)\]\]$/) // [[...slug]]
    const mDyn = seg.match(/^\[(.+)\]$/) // [id]
    if (mCatchAll) {
      const key = mCatchAll[1]
      if (i >= uSegs.length) return undefined // requires at least one
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

export function findFrontendMatch(pathname: string): { route: ModuleRoute; params: Record<string, string | string[]> } | undefined {
  for (const m of modules) {
    const routes = m.frontendRoutes ?? []
    for (const r of routes) {
      const params = matchPattern(getPattern(r), pathname)
      if (params) return { route: r, params }
    }
  }
}

export function findBackendMatch(pathname: string): { route: ModuleRoute; params: Record<string, string | string[]> } | undefined {
  for (const m of modules) {
    const routes = m.backendRoutes ?? []
    for (const r of routes) {
      const params = matchPattern(getPattern(r), pathname)
      if (params) return { route: r, params }
    }
  }
}

export function findApi(method: HttpMethod, pathname: string): { handler: ApiHandler; params: Record<string, string | string[]>; requireAuth?: boolean; requireRoles?: string[] } | undefined {
  for (const m of modules) {
    const apis = m.apis ?? []
    for (const a of apis) {
      if ('handlers' in a) {
        const params = matchPattern(a.path, pathname)
        const handler = (a.handlers as any)[method]
        if (params && handler) return { handler, params, requireAuth: a.requireAuth, requireRoles: (a as any).requireRoles }
      } else {
        // legacy exact match
        const al = a as ModuleApiLegacy
        if (al.method === method && al.path === pathname) {
          return { handler: al.handler, params: {} }
        }
      }
    }
  }
}
