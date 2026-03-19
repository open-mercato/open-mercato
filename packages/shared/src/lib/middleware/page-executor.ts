import type {
  PageMiddlewareContext,
  PageMiddlewareMode,
  PageMiddlewareRegistryEntry,
  PageMiddlewareResult,
  PageRouteMiddleware,
} from '@open-mercato/shared/modules/middleware/page'
import { CONTINUE_PAGE_MIDDLEWARE, matchPageMiddlewareTarget } from '@open-mercato/shared/modules/middleware/page'

type ExecutePageMiddlewareArgs = {
  entries: PageMiddlewareRegistryEntry[]
  context: PageMiddlewareContext
  onError?: (error: unknown, middleware: Pick<PageRouteMiddleware, 'id' | 'priority'>) => void
}

const DEFAULT_PRIORITY = 100

function shouldRunMiddleware(middleware: PageRouteMiddleware, mode: PageMiddlewareMode, pathname: string): boolean {
  if (middleware.mode && middleware.mode !== mode) return false
  return matchPageMiddlewareTarget(pathname, middleware.target)
}

function compareMiddleware(a: PageRouteMiddleware, b: PageRouteMiddleware): number {
  const priorityDiff = (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY)
  if (priorityDiff !== 0) return priorityDiff
  return a.id.localeCompare(b.id)
}

function flattenAndSortMiddleware(
  entries: PageMiddlewareRegistryEntry[],
  mode: PageMiddlewareMode,
  pathname: string
): PageRouteMiddleware[] {
  return entries
    .flatMap((entry) => entry.middleware)
    .filter((middleware) => shouldRunMiddleware(middleware, mode, pathname))
    .sort(compareMiddleware)
}

export async function executePageMiddleware(args: ExecutePageMiddlewareArgs): Promise<PageMiddlewareResult> {
  const { entries, context, onError } = args
  const matchedMiddleware = flattenAndSortMiddleware(entries, context.mode, context.pathname)
  for (const middleware of matchedMiddleware) {
    try {
      const result = await middleware.run(context)
      if (result.action === 'redirect') return result
    } catch (error) {
      if (onError) {
        onError(error, { id: middleware.id, priority: middleware.priority })
      } else {
        console.error('[middleware:page] execution failed', { id: middleware.id, error })
      }
      throw error
    }
  }
  return CONTINUE_PAGE_MIDDLEWARE
}

export async function resolvePageMiddlewareRedirect(args: ExecutePageMiddlewareArgs): Promise<string | null> {
  const result = await executePageMiddleware(args)
  if (result.action !== 'redirect') return null
  return result.location
}
