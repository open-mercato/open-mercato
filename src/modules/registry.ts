import type { NextRequest } from 'next/server'
import type { ReactNode } from 'react'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiHandler = (req: NextRequest | Request) => Promise<Response> | Response

export type ModuleRoute = {
  path: string // e.g. '/login' or '/backend/example'
  Component: (props: { params?: Record<string, string | string[]> }) => ReactNode | Promise<ReactNode>
}

export type ModuleApi = {
  method: HttpMethod
  path: string // e.g. '/auth/login'
  handler: ApiHandler
}

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
}

// Auto-generated modules list
import { modules } from './generated'
export { modules }

export function findFrontendRoute(pathname: string): ModuleRoute | undefined {
  for (const m of modules) {
    const routes = m.frontendRoutes ?? []
    const match = routes.find((r) => r.path === pathname)
    if (match) return match
  }
}

export function findBackendRoute(pathname: string): ModuleRoute | undefined {
  for (const m of modules) {
    const routes = m.backendRoutes ?? []
    const match = routes.find((r) => r.path === pathname)
    if (match) return match
  }
}

export function findApi(method: HttpMethod, pathname: string) {
  for (const m of modules) {
    const apis = m.apis ?? []
    const match = apis.find((a) => a.method === method && a.path === pathname)
    if (match) return match
  }
}
