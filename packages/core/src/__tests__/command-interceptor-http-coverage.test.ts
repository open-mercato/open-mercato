import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import * as ts from 'typescript'

/**
 * Command-interceptor HTTP-status coverage guard (#5097).
 *
 * A command interceptor may reject with an explicit HTTP status, and
 * `getCommandInterceptorHttpRejection` turns that rejection into the status and
 * body the transport should answer with. `makeCrudRoute`'s `handleError` applies
 * it for every factory handler, but a route that owns its own `try/catch` has to
 * apply it itself — otherwise a deliberate 422 business block silently degrades
 * to that route's generic 400/500 (#5045, #5067).
 *
 * This test pins the invariant: every core route that calls the command bus and
 * maps its own errors MUST consult the mapper. A new route shipped without the
 * branch fails here instead of quietly answering with the wrong status.
 *
 * Scope is this package, per the convention of the other structural guards here.
 * The checkout and enterprise-security routes funnel their errors through one
 * module-level mapper each, and those mappers carry their own unit tests
 * (`helpers.error-mapping.test.ts`, `error-mapping.interceptor.test.ts`).
 */

const MAPPER = 'getCommandInterceptorHttpRejection'
const BUS_CALL = /commandBus\.(execute|undo|redo)\s*[<(]/

const modulesRoot = join(__dirname, '..', 'modules')

/**
 * Routes that do NOT catch their own command-bus failures: the rejection
 * propagates out of the handler, so there is no catch to map it in. They answer
 * with the framework's unhandled-error response today, exactly as before this
 * change — bringing them into the contract means giving them error handling
 * first, which is a behavior change of its own.
 *
 * The last test below re-derives that property from the AST, so a route that
 * later grows a `try/catch` around its bus call drops out of the exemption and
 * has to adopt the mapper.
 */
const ROUTES_WITHOUT_OWN_ERROR_HANDLING = [
  'communication_channels/api/delete/channels/[id]/route.ts',
  'communication_channels/api/delete/messages/[messageId]/reactions/[reactionId]/route.ts',
  'communication_channels/api/post/channels/[id]/set-primary/route.ts',
  'communication_channels/api/post/channels/connect/credentials/route.ts',
  'communication_channels/api/post/messages/[messageId]/reactions/route.ts',
  'communication_channels/api/post/test-seed/route.ts',
  'communication_channels/api/put/threads/[threadId]/assign/route.ts',
  'customers/api/interactions/[id]/visibility/route.ts',
  'messages/api/[id]/archive/route.ts',
  'messages/api/[id]/attachments/route.ts',
  'messages/api/[id]/read/route.ts',
  'messages/api/route.ts',
]

function countEnclosingCatches(source: string, relativePath: string): number[] {
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const perCall: number[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const access = node.expression
      const isBusCall = access.expression.getText(sourceFile).endsWith('commandBus')
        && ['execute', 'undo', 'redo'].includes(access.name.text)
      if (isBusCall) {
        let enclosing = 0
        let parent: ts.Node | undefined = node.parent
        while (parent) {
          if (ts.isTryStatement(parent) && parent.catchClause) enclosing += 1
          parent = parent.parent
        }
        perCall.push(enclosing)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return perCall
}

function collectRouteFiles(dir: string): string[] {
  const collected: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      collected.push(...collectRouteFiles(full))
      continue
    }
    if (name === 'route.ts') collected.push(full)
  }
  return collected
}

const commandBusRoutes = collectRouteFiles(modulesRoot)
  .map((full) => ({ rel: relative(modulesRoot, full).split(sep).join('/'), source: readFileSync(full, 'utf8') }))
  .filter(({ source }) => BUS_CALL.test(source))

describe('command interceptor HTTP status coverage (core routes)', () => {
  it('finds command-bus routes to check', () => {
    expect(commandBusRoutes.length).toBeGreaterThan(20)
  })

  it('maps interceptor rejections on every route that catches its own command-bus failures', () => {
    const exempt = new Set(ROUTES_WITHOUT_OWN_ERROR_HANDLING)
    const missing = commandBusRoutes
      .filter(({ rel }) => !exempt.has(rel))
      .filter(({ source }) => !source.includes(MAPPER))
      .map(({ rel }) => rel)

    expect(missing).toEqual([])
  })

  it('keeps the exemption list free of stale entries', () => {
    const known = new Set(commandBusRoutes.map(({ rel }) => rel))
    const stale = ROUTES_WITHOUT_OWN_ERROR_HANDLING.filter((rel) => !known.has(rel))

    expect(stale).toEqual([])
  })

  it('exempts only routes whose command-bus call sits outside every try/catch', () => {
    const wronglyExempt = commandBusRoutes
      .filter(({ rel }) => ROUTES_WITHOUT_OWN_ERROR_HANDLING.includes(rel))
      .filter(({ rel, source }) => countEnclosingCatches(source, rel).some((count) => count > 0))
      .map(({ rel }) => rel)

    expect(wronglyExempt).toEqual([])
  })
})
