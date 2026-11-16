/** Consumed shape of `templates.json`, schema 1, published by the Open Mercato Modules site. */

export type TemplateEnvKey = { name: string; description: string; link?: string }

/** Facts recorded for one commit sha. `modules` is read by the site pages and ignored here. */
export type TemplateFacts = {
  omLine: string | null
  omVersion: string | null
  linesBehind: number | null
  requiresEnterprise: boolean
  engines: { node?: string } | null
  env: TemplateEnvKey[]
}

/** `unknown` stands for a status this create-mercato-app does not know; it is refused like `hold`. */
export type TemplateStatus = 'active' | 'hold' | 'unmaintained' | 'unknown'

export type TemplateIndexEntry = {
  slug: string | null
  /** `owner/repo`, lower case. */
  github: string
  status: TemplateStatus
  reason: string | null
  useCase: string
  summary: string
  ref: string | null
  /** Null when the index gives no valid `source.sha`; the entry is kept so the hold policy still applies to it. */
  source: { sha: string; syncedAt: string; facts: TemplateFacts | null } | null
  verified: { sha: string; at: string; omVersion: string; importer: string; facts: TemplateFacts | null } | null
}

export type TemplatesIndex = { schema: 1; generatedAt: string; templates: TemplateIndexEntry[] }

export type TemplatesIndexResult =
  | { status: 'ok'; url: string; index: TemplatesIndex }
  | { status: 'unavailable'; url: string; reason: string }

export type TemplatesResponse = {
  status: number
  ok: boolean
  json(): Promise<unknown>
}

export type TemplatesFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<TemplatesResponse>

/** The value of `--template`, parsed without any network call. */
export type TemplateArg =
  | { kind: 'slug'; slug: string; ref: string | null; input: string }
  | { kind: 'repo'; owner: string; repo: string; ref: string | null; input: string }

/**
 * How the repository relates to the index: listed in it, absent from a reachable index, or of unknown status
 * because the index could not be read.
 */
export type TemplateListing = 'listed' | 'unlisted' | 'unknown'

/** One selected commit and only the facts recorded for that commit. */
export type TemplateSelection = {
  owner: string
  repo: string
  /** `#ref` when given, else the entry's `ref` (listed) or the resolved default branch. Null: the default branch of a listed entry without `ref`, not resolved. */
  ref: string | null
  sha: string
  listing: TemplateListing
  entry: TemplateIndexEntry | null
  /** True only when `sha` is the entry's `verified.sha`. */
  verified: boolean
  facts: TemplateFacts | null
  /** True when `sha` was taken from the index (no `#ref`); a 404 on its download then stops with a `#ref` hint. */
  shaFromIndex: boolean
  /** Why the index could not be read, when `listing` is `unknown`. */
  indexProblem: string | null
  indexUrl: string
}
