import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Cache DI-contract documentation audit.
 *
 * `packages/cache/AGENTS.md` and `.ai/review-checklist.md` are the two places an agent
 * looks up how to reach the cache. Both had drifted away from the runtime: they told
 * readers to resolve a `cacheService` DI token (nothing registers that name — the real
 * token is `cache`, registered in `packages/core/src/bootstrap.ts`) and to invalidate a
 * tag with `invalidateTag('customers')` (no such member exists — `CacheStrategy` exposes
 * `deleteByTags(tags: string[])`). Both snippets throw at runtime, so the docs were
 * actively producing broken module code.
 *
 * This audit re-derives the ground truth from the sources on every run — the registered
 * token from the bootstrap registration, the callable members from the `CacheStrategy`
 * type — and fails when either document quotes a token or a method that no longer exists.
 * Renaming the token or a strategy method therefore breaks this test until the docs are
 * updated in the same change.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')
const bootstrapPath = join(repoRoot, 'packages', 'core', 'src', 'bootstrap.ts')
const cacheTypesPath = join(repoRoot, 'packages', 'cache', 'src', 'types.ts')
const cacheAgentsPath = join(repoRoot, 'packages', 'cache', 'AGENTS.md')
const reviewChecklistPath = join(repoRoot, '.ai', 'review-checklist.md')

function readSource(path: string): string {
  return readFileSync(path, 'utf8')
}

/** The DI token `bootstrap()` registers the cache service under. */
function registeredCacheToken(): string {
  const source = readSource(bootstrapPath)
  const match = source.match(/container\.register\(\{\s*([A-Za-z_$][\w$]*)\s*:\s*asValue\(cache\)\s*\}\)/)
  if (!match) {
    throw new Error(
      '[internal] Could not locate the cache registration in packages/core/src/bootstrap.ts. ' +
        'Update this audit if the registration shape changed.',
    )
  }
  return match[1]
}

/** The body of the `CacheStrategy` type declaration. */
function cacheStrategyBody(): string {
  const source = readSource(cacheTypesPath)
  const start = source.indexOf('export type CacheStrategy = {')
  if (start === -1) throw new Error('[internal] CacheStrategy type not found in packages/cache/src/types.ts')
  const rest = source.slice(start)
  const endOffset = rest.search(/^\}/m)
  if (endOffset === -1) throw new Error('[internal] CacheStrategy type body is not terminated')
  return rest.slice(0, endOffset)
}

/** Every callable member of the `CacheStrategy` contract, optional ones included. */
function cacheStrategyMembers(body: string): Set<string> {
  const members = new Set<string>()
  const memberPattern = /^ {2}([A-Za-z_$][\w$]*)\??\(/gm
  let match = memberPattern.exec(body)
  while (match) {
    members.add(match[1])
    match = memberPattern.exec(body)
  }
  return members
}

/** The member that performs tag-based invalidation — the one taking a `string[]` of tags. */
function tagInvalidationMember(body: string): string {
  const match = body.match(/^ {2}([A-Za-z_$][\w$]*)\??\(tags: string\[\]\)/m)
  if (!match) throw new Error('[internal] CacheStrategy no longer declares a tags: string[] member')
  return match[1]
}

/** Every `container.resolve('x')` / `resolve('x')` token quoted by a document. */
function documentedResolveTokens(markdown: string): string[] {
  const tokens: string[] = []
  const pattern = /\bresolve\(\s*['"`]([^'"`]+)['"`]\s*\)/g
  let match = pattern.exec(markdown)
  while (match) {
    tokens.push(match[1])
    match = pattern.exec(markdown)
  }
  return tokens
}

/** Every method invoked on a cache-shaped identifier inside a document. */
function documentedCacheMethodCalls(markdown: string): string[] {
  const calls: string[] = []
  const pattern = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(/g
  let match = pattern.exec(markdown)
  while (match) {
    if (/cache/i.test(match[1])) calls.push(match[2])
    match = pattern.exec(markdown)
  }
  return calls
}

/**
 * The review checklist documents every subsystem, so only its Cache section is in scope —
 * other sections legitimately quote other DI tokens.
 */
function cacheSectionOf(markdown: string): string {
  const heading = markdown.match(/^## \d+\. Cache$/m)
  if (!heading || heading.index === undefined) {
    throw new Error('[internal] .ai/review-checklist.md no longer has a "## <n>. Cache" section')
  }
  const rest = markdown.slice(heading.index + heading[0].length)
  const nextHeading = rest.search(/^## /m)
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading)
}

type AuditedDocument = { file: string; text: string }

function auditedDocuments(): AuditedDocument[] {
  return [
    { file: 'packages/cache/AGENTS.md', text: readSource(cacheAgentsPath) },
    { file: '.ai/review-checklist.md', text: cacheSectionOf(readSource(reviewChecklistPath)) },
  ]
}

describe('cache DI contract documentation', () => {
  const token = registeredCacheToken()
  const strategyBody = cacheStrategyBody()
  const members = cacheStrategyMembers(strategyBody)
  const tagMember = tagInvalidationMember(strategyBody)
  const documents = auditedDocuments()

  it('derives the ground truth it audits against', () => {
    expect(token).toBe('cache')
    const required = ['get', 'set', 'has', 'delete', 'deleteByTags', 'clear', 'keys', 'stats']
    expect(required.filter((member) => !members.has(member))).toEqual([])
    expect(members.has('invalidateTag')).toBe(false)
    expect(tagMember).toBe('deleteByTags')
  })

  it('every audited document resolves only the registered DI token', () => {
    for (const { file, text } of documents) {
      const quoted = documentedResolveTokens(text)
      expect({ file, quotedCount: quoted.length > 0 }).toEqual({ file, quotedCount: true })
      for (const quotedToken of quoted) {
        expect({ file, quotedToken }).toEqual({ file, quotedToken: token })
      }
    }
  })

  it('every audited document only calls methods that exist on CacheStrategy', () => {
    for (const { file, text } of documents) {
      for (const method of documentedCacheMethodCalls(text)) {
        expect({ file, method, exists: members.has(method) }).toEqual({ file, method, exists: true })
      }
    }
  })

  it('every audited document names tag invalidation by its real member', () => {
    for (const { file, text } of documents) {
      expect({ file, documented: text.includes(`${tagMember}(`) }).toEqual({ file, documented: true })
    }
  })
})
