import {
  downloadRepositoryTarball,
  resolveGitHubCommitSha,
  resolveGitHubDefaultBranch,
  validateSlug,
} from '../ready-apps.js'
import type { DownloadedArchive } from '../safe-archive.js'
import { fetchTemplatesIndex, isSafeGitRef, parseGitHubPath } from './fetch-templates.js'
import type {
  TemplateArg,
  TemplateIndexEntry,
  TemplateListing,
  TemplateSelection,
  TemplatesFetch,
  TemplatesIndex,
} from './types.js'

type FetchLike = typeof fetch

export type TemplateResolveDeps = {
  indexUrl: string
  packageVersion: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f-\u009f]/u

/**
 * Parses `<slug | owner/repo>[#ref]`. A URL is refused with a hint, because `--template` takes a GitHub path and
 * `--app-url` already takes URLs.
 */
export function parseTemplateArg(value: string): TemplateArg {
  const input = value.trim()
  const hashIndex = input.indexOf('#')
  const base = hashIndex === -1 ? input : input.slice(0, hashIndex)
  const ref = hashIndex === -1 ? null : input.slice(hashIndex + 1)

  if (!base) {
    throw new Error('--template needs a template slug or owner/repo, for example --template crm or --template owner/repo#v1.0.0.')
  }
  if (ref !== null && (!ref || CONTROL_OR_SPACE.test(ref) || ref === '.' || ref === '..')) {
    throw new Error(`--template "${input}" has an invalid ref after "#". Name a branch, tag or commit sha.`)
  }
  if (base.includes(':') || /^(www\.)?github\.com\//iu.test(base)) {
    throw new Error(
      `--template takes a template slug or owner/repo, not a URL ("${base}"). Use --template owner/repo, or --app-url for a GitHub URL.`,
    )
  }

  if (base.includes('/')) {
    const path = parseGitHubPath(base)
    if (!path) {
      throw new Error(`--template "${base}" is not a valid GitHub owner/repo.`)
    }
    return { kind: 'repo', owner: path.owner, repo: path.repo, ref, input }
  }

  const validation = validateSlug(base, 'Template slug')
  if (!validation.valid) {
    throw new Error(`${validation.error}. Use a template slug or owner/repo.`)
  }
  return { kind: 'slug', slug: base, ref, input }
}

function describeArg(arg: TemplateArg): string {
  return arg.kind === 'slug' ? arg.slug : `${arg.owner}/${arg.repo}`
}

/** The entry for a slug or `owner/repo` (case-insensitive), or null. Two matches fail instead of picking one. */
export function findTemplateEntry(index: TemplatesIndex, arg: TemplateArg): TemplateIndexEntry | null {
  const matches = arg.kind === 'slug'
    ? index.templates.filter((entry) => entry.slug === arg.slug)
    : index.templates.filter((entry) => entry.github === `${arg.owner}/${arg.repo}`.toLowerCase())
  if (matches.length > 1) {
    throw new Error(
      `The template index lists ${describeArg(arg)} more than once (${matches.map((entry) => entry.github).join(', ')}). Report it to the Open Mercato Modules maintainers, or use --template owner/repo with the repository you trust.`,
    )
  }
  return matches[0] ?? null
}

/** Hold policy: `hold` is refused with its reason, a status this CLI does not know is refused too (fail closed). */
export function assertTemplateAllowed(entry: TemplateIndexEntry): void {
  if (entry.status === 'hold') {
    throw new Error(
      `The template ${entry.github} is on hold and cannot be used to create an app. Reason: ${entry.reason ?? 'none given'}`,
    )
  }
  if (entry.status === 'unknown') {
    throw new Error(
      `The template index gives ${entry.github} a status this create-mercato-app does not know. Update create-mercato-app (npx create-mercato-app@latest) and retry.`,
    )
  }
}

export type TemplateLookup = {
  listing: TemplateListing
  entry: TemplateIndexEntry | null
  indexProblem: string | null
  indexUrl: string
}

/**
 * Selects one commit sha and the facts recorded for exactly that sha. A listed repository without `#ref` uses
 * `verified.sha`, else `source.sha`, and stops when it has neither; any `#ref` and any unlisted repository is resolved through the GitHub API, and a
 * resolved sha only gets catalog facts when it equals one of the entry's own shas.
 */
export async function selectTemplateSha(
  arg: TemplateArg,
  lookup: TemplateLookup,
  deps: Pick<TemplateResolveDeps, 'packageVersion' | 'fetchImpl'>,
): Promise<TemplateSelection> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const base = { listing: lookup.listing, entry: lookup.entry, indexProblem: lookup.indexProblem, indexUrl: lookup.indexUrl }
  const entry = lookup.entry

  if (entry) {
    const path = parseGitHubPath(entry.github)
    if (!path) throw new Error(`The template index has an invalid GitHub path: ${entry.github}`)
    if (arg.ref === null) {
      const verified = entry.verified
      const picked = verified ?? entry.source
      if (!picked) {
        throw new Error(
          `The template index lists ${entry.github} without a valid commit sha. Report it to the Open Mercato Modules maintainers, or run again with --template ${entry.github}#<branch or tag>. That code is not verified.`,
        )
      }
      return {
        ...base,
        ...path,
        ref: entry.ref,
        sha: picked.sha,
        verified: verified !== null,
        facts: picked.facts,
        shaFromIndex: true,
      }
    }
    const sha = await resolveGitHubCommitSha(path.owner, path.repo, arg.ref, deps.packageVersion, fetchImpl)
    const verified = entry.verified?.sha === sha ? entry.verified : null
    const facts = verified ? verified.facts : sha === entry.source?.sha ? entry.source.facts : null
    return { ...base, ...path, ref: arg.ref, sha, verified: verified !== null, facts, shaFromIndex: false }
  }

  if (arg.kind !== 'repo') {
    throw new Error(`No template with slug "${arg.slug}".`)
  }
  const ref = arg.ref ?? await resolveGitHubDefaultBranch(arg.owner, arg.repo, deps.packageVersion, fetchImpl)
  const sha = await resolveGitHubCommitSha(arg.owner, arg.repo, ref, deps.packageVersion, fetchImpl)
  return { ...base, owner: arg.owner, repo: arg.repo, ref, sha, verified: false, facts: null, shaFromIndex: false }
}

function siteUrl(indexUrl: string, path: string): string {
  return new URL(path, indexUrl).href
}

/**
 * Reads the index and selects the sha. A slug needs the index; `owner/repo` continues without it as "catalog status
 * unknown". Hold and unknown statuses are refused before any GitHub request.
 */
export async function resolveTemplateSelection(arg: TemplateArg, deps: TemplateResolveDeps): Promise<TemplateSelection> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const indexFetch: TemplatesFetch = (url, init) => fetchImpl(url, init)
  const result = await fetchTemplatesIndex({ url: deps.indexUrl, fetchImpl: indexFetch, timeoutMs: deps.timeoutMs })

  if (result.status === 'unavailable') {
    if (arg.kind === 'slug') {
      throw new Error(
        `Could not read the template index at ${result.url} (${result.reason}), which a template slug needs. Retry later, or use --template <owner/repo> to create from a repository directly.`,
      )
    }
    return selectTemplateSha(arg, { listing: 'unknown', entry: null, indexProblem: result.reason, indexUrl: result.url }, deps)
  }

  const entry = findTemplateEntry(result.index, arg)
  if (!entry) {
    if (arg.kind === 'slug') {
      throw new Error(
        `No template with slug "${arg.slug}". See ${siteUrl(result.url, '/templates')} for the listed templates, or use --template <owner/repo>.`,
      )
    }
    return selectTemplateSha(arg, { listing: 'unlisted', entry: null, indexProblem: null, indexUrl: result.url }, deps)
  }

  assertTemplateAllowed(entry)
  return selectTemplateSha(arg, { listing: 'listed', entry, indexProblem: null, indexUrl: result.url }, deps)
}

export type TemplateSelectionDescription = {
  /** `Template: owner/repo@sha (state)`, printed before any download. */
  headline: string
  /** The template page, only for a listed repository. */
  pageUrl: string | null
  /** Warnings to print before the download. */
  notices: string[]
}

function verificationState(selection: TemplateSelection): string {
  if (selection.listing === 'unknown') return 'catalog status unknown, not verified'
  if (selection.listing === 'unlisted' || !selection.entry) return 'not listed, not verified'
  if (selection.verified) return 'verified'
  const known = selection.sha === selection.entry.source?.sha || selection.sha === selection.entry.verified?.sha
  return known ? 'not verified' : `not verified, no catalog facts for ${selection.sha}`
}

export function describeTemplateSelection(selection: TemplateSelection): TemplateSelectionDescription {
  const notices: string[] = []
  if (selection.listing === 'unknown') {
    notices.push(`Could not read the template index (${selection.indexProblem ?? 'no response'}). Continuing without catalog data.`)
  }
  if (selection.entry?.status === 'unmaintained') {
    notices.push(`This template is unmaintained. Reason: ${selection.entry.reason ?? 'none given'}`)
  }
  return {
    headline: `Template: ${selection.owner}/${selection.repo}@${selection.sha} (${verificationState(selection)})`,
    pageUrl: selection.listing === 'listed' && selection.entry
      ? siteUrl(selection.indexUrl, `/t/${selection.entry.github}`)
      : null,
    notices,
  }
}

/**
 * Downloads the selected sha. When a sha taken from the index is gone (404), the CLI stops and suggests `#<ref>`
 * instead of switching to other code on its own.
 */
export async function downloadSelectedTemplate(
  selection: TemplateSelection,
  deps: Pick<TemplateResolveDeps, 'packageVersion' | 'fetchImpl'>,
): Promise<DownloadedArchive> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const { owner, repo, sha } = selection
  const download = await downloadRepositoryTarball(owner, repo, sha, deps.packageVersion, fetchImpl)
  if (download.status === 'ok') return download.archive

  if (!selection.shaFromIndex) {
    throw new Error(`Commit ${sha} of ${owner}/${repo} could not be downloaded (HTTP 404).`)
  }
  let ref = selection.ref
  if (!ref) {
    try {
      ref = await resolveGitHubDefaultBranch(owner, repo, deps.packageVersion, fetchImpl)
    } catch {
      ref = null
    }
  }
  // The hint is a command the user may copy, so a ref that could carry shell syntax is never printed.
  if (!ref || !isSafeGitRef(ref)) ref = '<branch or tag>'
  throw new Error(
    `The commit ${sha} that the template index lists for ${owner}/${repo} can no longer be downloaded. create-mercato-app does not switch to other code on its own. To use the current code, run again with --template ${owner}/${repo}#${ref}. That code is not verified.`,
  )
}
