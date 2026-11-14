import { printable } from '../catalog/fetch-catalog.js'
import { validateSlug } from '../ready-apps.js'
import type {
  TemplateEnvKey,
  TemplateFacts,
  TemplateIndexEntry,
  TemplatesFetch,
  TemplatesIndex,
  TemplatesIndexResult,
  TemplateStatus,
} from './types.js'

export const DEFAULT_TEMPLATES_URL = 'https://modules.openmercato.com/templates.json'
export const TEMPLATES_URL_ENV = 'OM_TEMPLATES_URL'
export const TEMPLATES_TIMEOUT_MS = 4000

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const KNOWN_STATUSES: readonly TemplateStatus[] = ['active', 'hold', 'unmaintained']
const OWNER_PATTERN = /^[A-Za-z0-9-]{1,39}$/
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/
const SHA_PATTERN = /^[0-9a-f]{40}$/i
const GIT_REF_PATTERN = /^[A-Za-z0-9._/-]{1,255}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const stringOrNull = (value: unknown): string | null => (isString(value) && value.trim() !== '' ? value : null)

export function isFullSha(value: string): boolean {
  return SHA_PATTERN.test(value)
}

/**
 * A branch, tag or sha that is safe to print inside a suggested shell command: letters, digits, `.`, `_`, `/` and `-`
 * only, no `..` and no leading `-`. Refs from the index or from GitHub are printed only when they pass.
 */
export function isSafeGitRef(value: string): boolean {
  return GIT_REF_PATTERN.test(value) && value !== '.' && !value.includes('..') && !value.startsWith('-')
}

/** `owner/repo` split into its parts when both are valid GitHub names, else null. */
export function parseGitHubPath(value: string): { owner: string; repo: string } | null {
  const parts = value.split('/')
  if (parts.length !== 2) return null
  const [owner, repo] = parts as [string, string]
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo) || repo === '.' || repo === '..') return null
  return { owner, repo }
}

/**
 * The index URL: `OM_TEMPLATES_URL` when set, else the default. The override must be https, or http on a loopback
 * host; anything else is a usage error before any request, never a silent fallback to the default URL.
 */
export function resolveTemplatesUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[TEMPLATES_URL_ENV]?.trim()
  if (!override) return DEFAULT_TEMPLATES_URL
  let parsed: URL
  try {
    parsed = new URL(override)
  } catch {
    throw new Error(`${TEMPLATES_URL_ENV} is not a valid URL: "${override}".`)
  }
  if (parsed.protocol === 'https:') return parsed.href
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return parsed.href
  throw new Error(
    `${TEMPLATES_URL_ENV} must be an https:// URL, or an http:// URL on localhost, 127.0.0.1 or [::1]. Got "${override}".`,
  )
}

/** One declared env key (`name`, `description`, optional `link`), or null without a name. */
export function toEnvKey(value: unknown): TemplateEnvKey | null {
  if (!isRecord(value) || !isString(value.name) || value.name.trim() === '') return null
  const key: TemplateEnvKey = { name: value.name, description: isString(value.description) ? value.description : '' }
  if (isString(value.link) && value.link.trim() !== '') key.link = value.link
  return key
}

function toFacts(value: unknown): TemplateFacts | null {
  if (!isRecord(value)) return null
  const engines = isRecord(value.engines)
    ? (isString(value.engines.node) ? { node: value.engines.node } : {})
    : null
  return {
    omLine: stringOrNull(value.omLine),
    omVersion: stringOrNull(value.omVersion),
    linesBehind: typeof value.linesBehind === 'number' && Number.isInteger(value.linesBehind) && value.linesBehind >= 0
      ? value.linesBehind
      : null,
    requiresEnterprise: value.requiresEnterprise === true,
    engines,
    env: Array.isArray(value.env)
      ? value.env.map(toEnvKey).filter((key): key is TemplateEnvKey => key !== null)
      : [],
  }
}

function toVerified(value: unknown): TemplateIndexEntry['verified'] {
  if (!isRecord(value) || !isString(value.sha) || !isFullSha(value.sha)) return null
  return {
    sha: value.sha.toLowerCase(),
    at: isString(value.at) ? value.at : '',
    omVersion: isString(value.omVersion) ? value.omVersion : '',
    importer: isString(value.importer) ? value.importer : '',
    facts: toFacts(value.facts),
  }
}

function toSource(value: unknown): TemplateIndexEntry['source'] {
  if (!isRecord(value) || !isString(value.sha) || !isFullSha(value.sha)) return null
  return {
    sha: value.sha.toLowerCase(),
    syncedAt: isString(value.syncedAt) ? value.syncedAt : '',
    facts: toFacts(value.facts),
  }
}

/**
 * One index entry, or null when it lacks a valid `github` or `status`. An entry without a valid `source.sha` is kept
 * with `source: null`, so a `hold` or unknown status is still refused instead of the repo counting as unlisted.
 */
function toEntry(value: unknown): TemplateIndexEntry | null {
  if (!isRecord(value) || !isString(value.github) || !isString(value.status)) return null
  if (!parseGitHubPath(value.github)) return null
  const status = KNOWN_STATUSES.find((candidate) => candidate === value.status) ?? 'unknown'
  const slug = isString(value.slug) && validateSlug(value.slug, 'slug').valid ? value.slug : null
  return {
    slug,
    github: value.github.toLowerCase(),
    status,
    reason: stringOrNull(value.reason),
    useCase: isString(value.useCase) ? value.useCase : '',
    summary: isString(value.summary) ? value.summary : '',
    ref: isString(value.ref) && isSafeGitRef(value.ref) ? value.ref : null,
    source: toSource(value.source),
    verified: toVerified(value.verified),
  }
}

/** The index when `schema` is 1, with invalid entries dropped and every string freed of control characters. */
export function parseTemplatesIndex(value: unknown): TemplatesIndex | null {
  if (!isRecord(value) || value.schema !== 1 || !Array.isArray(value.templates)) return null
  const templates = value.templates
    .map((entry) => toEntry(printable(entry)))
    .filter((entry): entry is TemplateIndexEntry => entry !== null)
  return { schema: 1, generatedAt: isString(value.generatedAt) ? value.generatedAt : '', templates }
}

/** Same contract as the picker index: 4 s timeout, one retry after a network error or a 5xx, no GitHub token. */
export async function fetchTemplatesIndex(options: {
  url?: string
  fetchImpl?: TemplatesFetch
  timeoutMs?: number
} = {}): Promise<TemplatesIndexResult> {
  const url = options.url ?? DEFAULT_TEMPLATES_URL
  const timeoutMs = options.timeoutMs ?? TEMPLATES_TIMEOUT_MS
  const fetchImpl: TemplatesFetch = options.fetchImpl ?? ((target, init) => fetch(target, init))
  let reason = 'no response'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        reason = `HTTP ${response.status}`
        if (response.status < 500) break
        continue
      }
      const index = parseTemplatesIndex(await response.json())
      if (!index) return { status: 'unavailable', url, reason: 'unsupported templates.json format' }
      return { status: 'ok', url, index }
    } catch (error: unknown) {
      reason = error instanceof Error ? error.message : String(error)
    }
  }
  return { status: 'unavailable', url, reason }
}
