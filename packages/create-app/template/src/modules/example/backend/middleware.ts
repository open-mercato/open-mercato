/**
 * Backend page middleware for the `example` module.
 *
 * `backend/middleware.ts` is auto-discovered into `backend-middleware.generated.ts`
 * and executed by the backend catch-all page
 * (`src/app/(backend)/backend/[...slug]/page.tsx`) through
 * `resolvePageMiddlewareRedirect`. Two properties of that call site decide what a
 * page middleware can usefully do:
 *
 * - It runs **after** the route manifest matched and after the `requireAuth` /
 *   `requireFeatures` guards passed. A middleware therefore cannot be used as an
 *   access-control gate (the guard already ran) and it never fires on a path that
 *   has no registered page — targeting an unrouted path produces a declaration
 *   that can never execute.
 * - It runs **before** the page component loads, so a redirect here costs nothing
 *   but the auth round-trip the guard already paid.
 *
 * The one entry below uses exactly that window: `/backend/todos/:id/edit` matches
 * for any `:id`, including a hand-typed or stale one. Sending a structurally
 * impossible id back to the list is cheaper and clearer than rendering the edit
 * shell so it can issue a detail fetch that is guaranteed to miss.
 */
import {
  CONTINUE_PAGE_MIDDLEWARE,
  type PageRouteMiddleware,
} from '@open-mercato/shared/modules/middleware/page'

/** Where a rejected deep link lands. Matches `RowActions` links in `components/TodosTable.tsx`. */
export const TODOS_LIST_PATH = '/backend/todos'

const TODO_EDIT_PATHNAME = /^\/backend\/todos\/([^/]+)\/edit\/?$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Pure pathname decision, exported so `__tests__/backend-middleware.test.ts` can
 * exercise both branches without constructing a `PageMiddlewareContext`.
 *
 * Returns the redirect location, or `null` to let the page render.
 */
export function resolveTodoEditRedirect(pathname: string): string | null {
  const match = TODO_EDIT_PATHNAME.exec(pathname)
  if (!match) return null
  const todoId = decodeURIComponent(match[1])
  return UUID_PATTERN.test(todoId) ? null : TODOS_LIST_PATH
}

export const middleware: PageRouteMiddleware[] = [
  {
    id: 'example.backend.todo-edit-id-guard',
    mode: 'backend',
    target: TODO_EDIT_PATHNAME,
    priority: 40,
    run(context) {
      const location = resolveTodoEditRedirect(context.pathname)
      if (!location) return CONTINUE_PAGE_MIDDLEWARE
      return { action: 'redirect', location }
    },
  },
]

export default middleware
