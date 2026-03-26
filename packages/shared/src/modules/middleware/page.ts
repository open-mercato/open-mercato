import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

export type PageMiddlewareMode = 'frontend' | 'backend'

export type PageRouteMeta = {
  requireAuth?: boolean
  requireRoles?: string[]
  requireFeatures?: string[]
}

export type PageMiddlewareContainer = {
  resolve: (name: string) => unknown
}

export type PageMiddlewareContext = {
  pathname: string
  mode: PageMiddlewareMode
  routeMeta: PageRouteMeta
  auth: AuthContext
  ensureContainer: () => Promise<PageMiddlewareContainer>
}

export type PageMiddlewareResult =
  | { action: 'continue' }
  | { action: 'redirect'; location: string }

export type PageMiddlewareTarget = string | RegExp

export type PageRouteMiddleware = {
  id: string
  mode?: PageMiddlewareMode
  target: PageMiddlewareTarget
  priority?: number
  run: (ctx: PageMiddlewareContext) => Promise<PageMiddlewareResult> | PageMiddlewareResult
}

export type PageMiddlewareRegistryEntry = {
  moduleId: string
  middleware: PageRouteMiddleware[]
}

export function matchPageMiddlewareTarget(pathname: string, target: PageMiddlewareTarget): boolean {
  if (target instanceof RegExp) {
    return target.test(pathname)
  }
  if (target.endsWith('*')) {
    return pathname.startsWith(target.slice(0, -1))
  }
  return pathname === target
}

export const CONTINUE_PAGE_MIDDLEWARE: PageMiddlewareResult = { action: 'continue' }
