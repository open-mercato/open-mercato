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
 * The check is **path-scoped**, not file-scoped: for every bus call site the
 * guard walks the chain of `catch` clauses that can actually receive that call's
 * rejection — including the clauses around the call sites of a helper that wraps
 * the bus — and requires the mapper to appear on that chain. A file where only
 * one of several handlers adopted the branch therefore fails, which a plain
 * `source.includes(MAPPER)` check would not catch.
 *
 * Two boundaries this guard deliberately does not cover:
 * - **Scope is this package**, per the convention of the other structural guards
 *   here. The checkout, enterprise-security and documents routes funnel their
 *   errors through one module-level mapper each, and those mappers carry their own
 *   unit tests (`helpers.error-mapping.test.ts`, two `error-mapping.interceptor.test.ts`).
 *   A future route in those packages that owns its `catch` instead of delegating to
 *   the shared mapper is not caught by anything here, and neither is a new package
 *   arriving with its own mapper — which is how `handleDocumentsRouteError` shipped
 *   without the branch until it was spotted by hand.
 * - **A `catch` that swallows rather than rethrows** still satisfies the chain
 *   check as long as an outer clause maps the rejection. That is the case the
 *   batch exemption below exists for; a new route with the same shape has to be
 *   classified by hand.
 */

const MAPPER = 'getCommandInterceptorHttpRejection'
const BUS_CALL = /commandBus\.(execute|undo|redo)\s*[<(]/
const HTTP_HANDLERS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

const modulesRoot = join(__dirname, '..', 'modules')

/**
 * Routes with at least one command-bus call that no `catch` in the file can
 * receive: the rejection propagates out of the handler, so there is nothing to
 * map it in. They answer with the framework's unhandled-error response today,
 * exactly as before this change — bringing them into the contract means giving
 * them error handling first, which is a behavior change of its own.
 *
 * `messages/api/[id]/route.ts` is on the list for its `GET` handler only; its
 * `PATCH` and `DELETE` catch their own failures and do map the rejection.
 *
 * The list is asserted in both directions below and the property is re-derived
 * from the AST, so a route that grows a `try/catch` around its bus call drops out
 * of the list and has to adopt the mapper, and a new catch-less bus call has to be
 * recorded here deliberately instead of passing unnoticed.
 */
const ROUTES_WITH_UNCAUGHT_COMMAND_BUS_CALLS = [
  'auth/api/roles/acl/route.ts',
  'auth/api/users/acl/route.ts',
  'communication_channels/api/delete/admin/channels/[id]/route.ts',
  'communication_channels/api/delete/channels/[id]/route.ts',
  'communication_channels/api/delete/messages/[messageId]/reactions/[reactionId]/route.ts',
  'communication_channels/api/post/channels/[id]/set-primary/route.ts',
  'communication_channels/api/post/channels/connect/credentials/route.ts',
  'communication_channels/api/post/channels/connect/tenant-credentials/route.ts',
  'communication_channels/api/post/messages/[messageId]/reactions/route.ts',
  'communication_channels/api/post/test-seed/route.ts',
  'communication_channels/api/put/threads/[threadId]/assign/route.ts',
  'customers/api/interactions/[id]/visibility/route.ts',
  'messages/api/[id]/archive/route.ts',
  'messages/api/[id]/attachments/route.ts',
  'messages/api/[id]/read/route.ts',
  'messages/api/[id]/route.ts',
  'messages/api/route.ts',
]

/**
 * Batch routes that answer `HTTP 200` with a per-item `failed[]` list. Every path
 * from the handler to the command bus runs through a per-item `catch` that
 * records the failure and continues, so a rejection never reaches the route-level
 * `catch` and cannot be turned into an HTTP status without changing the batch
 * contract these endpoints publish.
 *
 * They are exempt rather than "covered": a route-level mapper branch here would
 * be unreachable for bus rejections and would make both the code and this guard
 * claim a coverage that does not exist behaviourally. `eudr/api/plots/import`'s
 * behavioural test pins what these routes actually do.
 *
 * The test below re-derives the property from the AST — every bus call must sit
 * behind at least one `catch` nested inside the route-level one — so a route that
 * later moves its bus call up to the handler drops out of the exemption.
 */
const ROUTES_WITH_BATCH_ITEM_ERROR_HANDLING = [
  'eudr/api/plots/import/route.ts',
  'eudr/api/product-mappings/suggestions/apply/route.ts',
]

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
}

function functionName(node: FunctionLike): string | null {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return node.name.getText()
  const parent = node.parent
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  return null
}

/**
 * Walks outward from `node`, collecting the `catch` clauses that can receive what
 * it throws, and stops at the first *declared* function — one with a name this
 * file can call by. An anonymous callback (`em.transactional(async (trx) => …)`,
 * `array.map(…)`) is walked straight through: it runs where it is written, so the
 * surrounding `catch` really does receive what it throws.
 *
 * A clause only counts when the walk reaches its `try` statement through the
 * `try` block. A call written inside the `catch` (or `finally`) of a `try` — the
 * compensating `warranty_claims.claim.delete` in `warranty_claims/api/portal/claims`
 * is the one such site in this package — cannot be caught by that same clause, so
 * the clause is skipped rather than credited to the chain.
 */
function enclosingCatches(node: ts.Node): { catches: ts.CatchClause[]; fn: FunctionLike | null } {
  const catches: ts.CatchClause[] = []
  let child: ts.Node = node
  let parent: ts.Node | undefined = node.parent
  while (parent) {
    if (ts.isTryStatement(parent) && parent.catchClause && child === parent.tryBlock) catches.push(parent.catchClause)
    if (isFunctionLike(parent) && functionName(parent)) return { catches, fn: parent }
    child = parent
    parent = parent.parent
  }
  return { catches, fn: null }
}

function findNodes(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function isBusCall(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false
  const access = node.expression
  return access.expression.getText(sourceFile).endsWith('commandBus')
    && ['execute', 'undo', 'redo'].includes(access.name.text)
}

/**
 * Every chain of `catch` clauses (innermost first) that can receive a rejection
 * thrown by one of this route's command-bus calls. A bus call inside a local
 * helper contributes one chain per call site of that helper, so the guard sees
 * the handler's `catch` even when the bus call is one function away from it.
 */
function busCatchChains(source: string, relativePath: string): ts.CatchClause[][] {
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const chains: ts.CatchClause[][] = []

  const walkUp = (node: ts.Node, below: ts.CatchClause[], seen: Set<string>): void => {
    const { catches, fn } = enclosingCatches(node)
    const chain = [...below, ...catches]
    const name = fn ? functionName(fn) : null
    if (!fn || !name || HTTP_HANDLERS.has(name) || seen.has(name)) {
      chains.push(chain)
      return
    }
    const callSites = findNodes(sourceFile, (candidate) => ts.isCallExpression(candidate)
      && ts.isIdentifier(candidate.expression)
      && candidate.expression.text === name)
    if (!callSites.length) {
      chains.push(chain)
      return
    }
    const nextSeen = new Set(seen).add(name)
    for (const callSite of callSites) walkUp(callSite, chain, nextSeen)
  }

  for (const call of findNodes(sourceFile, (node) => isBusCall(node, sourceFile))) {
    walkUp(call, [], new Set())
  }

  return chains
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
  .map((route) => ({ ...route, chains: busCatchChains(route.source, route.rel) }))

describe('command interceptor HTTP status coverage (core routes)', () => {
  it('finds command-bus routes to check', () => {
    expect(commandBusRoutes.length).toBeGreaterThan(20)
  })

  it('maps interceptor rejections on every catch chain that receives a command-bus failure', () => {
    const missing = commandBusRoutes
      .filter(({ rel }) => !ROUTES_WITH_BATCH_ITEM_ERROR_HANDLING.includes(rel))
      .filter(({ chains }) => chains
        .filter((chain) => chain.length > 0)
        .some((chain) => !chain.some((clause) => clause.getText().includes(MAPPER))))
      .map(({ rel }) => rel)

    expect(missing).toEqual([])
  })

  it('records every route whose command-bus failure no catch can receive', () => {
    const uncaught = commandBusRoutes
      .filter(({ chains }) => chains.some((chain) => chain.length === 0))
      .map(({ rel }) => rel)
      .sort()

    expect(uncaught).toEqual([...ROUTES_WITH_UNCAUGHT_COMMAND_BUS_CALLS].sort())
  })

  it('keeps the batch exemption free of stale entries', () => {
    const known = new Set(commandBusRoutes.map(({ rel }) => rel))
    const stale = ROUTES_WITH_BATCH_ITEM_ERROR_HANDLING.filter((rel) => !known.has(rel))

    expect(stale).toEqual([])
  })

  it('exempts batch routes only while a per-item catch absorbs every command-bus failure', () => {
    const wronglyExempt = commandBusRoutes
      .filter(({ rel }) => ROUTES_WITH_BATCH_ITEM_ERROR_HANDLING.includes(rel))
      .filter(({ chains }) => chains.some((chain) => chain.length < 2))
      .map(({ rel }) => rel)

    expect(wronglyExempt).toEqual([])
  })

  it('lists each route in at most one exemption', () => {
    const overlap = ROUTES_WITH_UNCAUGHT_COMMAND_BUS_CALLS
      .filter((rel) => ROUTES_WITH_BATCH_ITEM_ERROR_HANDLING.includes(rel))

    expect(overlap).toEqual([])
  })
})
