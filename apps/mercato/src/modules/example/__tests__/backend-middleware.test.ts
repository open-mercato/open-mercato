/** @jest-environment node */
/**
 * A page middleware is only real if the platform executor picks it up. The pure
 * `resolveTodoEditRedirect` cases below pin the decision; the `executePageMiddleware`
 * cases run the declaration through the *actual* shared executor
 * (`packages/shared/src/lib/middleware/page-executor.ts`) — the same function the
 * backend catch-all page calls — so a wrong `mode`, a target that does not match, or
 * a `run` that forgets to return `{ action: 'redirect' }` fails here rather than in
 * a browser.
 */
import { executePageMiddleware } from '@open-mercato/shared/lib/middleware/page-executor'
import type { PageMiddlewareContext } from '@open-mercato/shared/modules/middleware/page'
import middleware, { TODOS_LIST_PATH, resolveTodoEditRedirect } from '../backend/middleware'

const VALID_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

function context(pathname: string, mode: 'backend' | 'frontend' = 'backend'): PageMiddlewareContext {
  return {
    pathname,
    mode,
    routeMeta: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
    auth: null,
    ensureContainer: async () => {
      throw new Error('[internal] this middleware must not need a container')
    },
  }
}

async function run(pathname: string, mode: 'backend' | 'frontend' = 'backend') {
  return executePageMiddleware({
    entries: [{ moduleId: 'example', middleware }],
    context: context(pathname, mode),
  })
}

describe('resolveTodoEditRedirect', () => {
  it('lets a well-formed todo id through', () => {
    expect(resolveTodoEditRedirect(`/backend/todos/${VALID_ID}/edit`)).toBeNull()
    expect(resolveTodoEditRedirect(`/backend/todos/${VALID_ID.toUpperCase()}/edit`)).toBeNull()
  })

  it('sends a structurally impossible id back to the list', () => {
    expect(resolveTodoEditRedirect('/backend/todos/not-a-uuid/edit')).toBe(TODOS_LIST_PATH)
    expect(resolveTodoEditRedirect('/backend/todos/42/edit')).toBe(TODOS_LIST_PATH)
    expect(resolveTodoEditRedirect(`/backend/todos/${VALID_ID}x/edit`)).toBe(TODOS_LIST_PATH)
  })

  it('decodes the segment before judging it', () => {
    expect(resolveTodoEditRedirect(`/backend/todos/${encodeURIComponent(VALID_ID)}/edit`)).toBeNull()
  })

  it('ignores every other path', () => {
    for (const pathname of [
      '/backend/todos',
      '/backend/todos/create',
      `/backend/todos/${VALID_ID}`,
      '/backend/example',
      '/backend/customers/not-a-uuid/edit',
    ]) {
      expect(resolveTodoEditRedirect(pathname)).toBeNull()
    }
  })
})

describe('example backend middleware through the shared executor', () => {
  it('declares one entry with a stable id and an explicit backend mode', () => {
    expect(middleware).toHaveLength(1)
    expect(middleware[0].id).toBe('example.backend.todo-edit-id-guard')
    expect(middleware[0].mode).toBe('backend')
  })

  it('redirects an invalid deep link', async () => {
    await expect(run('/backend/todos/not-a-uuid/edit')).resolves.toEqual({
      action: 'redirect',
      location: TODOS_LIST_PATH,
    })
  })

  it('continues for a valid deep link', async () => {
    await expect(run(`/backend/todos/${VALID_ID}/edit`)).resolves.toEqual({ action: 'continue' })
  })

  it('does not run on the frontend surface', async () => {
    await expect(run('/backend/todos/not-a-uuid/edit', 'frontend')).resolves.toEqual({
      action: 'continue',
    })
  })
})
