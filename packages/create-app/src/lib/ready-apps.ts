import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertRegularTree,
  createTargetDirectory,
  extractArchive,
  inspectArchive,
  listRegularFiles,
  readCappedBody,
  type ArchiveLimits,
  type DownloadedArchive,
} from './safe-archive.js'

const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com'
const GITHUB_HOSTNAME = 'github.com'

export interface ReadyAppSelectionOptions {
  app?: string
  appUrl?: string
}

export interface GitHubRepositoryLocation {
  owner: string
  repo: string
  ref?: string
  normalizedUrl: string
}

interface BaseReadyAppSource {
  owner: string
  repo: string
  ref?: string
}

export interface OfficialReadyAppSource extends BaseReadyAppSource {
  kind: 'official'
  appSlug: string
  ref: string
}

export interface ExternalReadyAppSource extends BaseReadyAppSource {
  kind: 'external'
  sourceUrl: string
}

export type ReadyAppSource = OfficialReadyAppSource | ExternalReadyAppSource

export interface ReadyAppDownload {
  archive: DownloadedArchive
  owner: string
  repo: string
  ref: string
}

interface GitHubRepositoryInfo {
  defaultBranch: string
}

type FetchLike = typeof fetch

export function validateSlug(name: string, label: string): { valid: boolean; error?: string } {
  if (!name) {
    return { valid: false, error: `${label} is required` }
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    return {
      valid: false,
      error: `${label} must be lowercase alphanumeric with hyphens only (e.g., my-app)`,
    }
  }

  if (name.startsWith('-') || name.endsWith('-')) {
    return { valid: false, error: `${label} cannot start or end with a hyphen` }
  }

  return { valid: true }
}

export function parseGitHubRepositoryUrl(inputUrl: string): GitHubRepositoryLocation {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(inputUrl)
  } catch {
    throw new Error(`Invalid GitHub repository URL "${inputUrl}"`)
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== GITHUB_HOSTNAME) {
    throw new Error('Only GitHub repository URLs are supported for --app-url in v1.')
  }

  const segments = parsedUrl.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  if (segments.length < 2) {
    throw new Error('GitHub repository URL must include both the owner and repository name.')
  }

  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/u, '')

  if (!owner || !repo) {
    throw new Error('GitHub repository URL must include both the owner and repository name.')
  }

  let ref: string | undefined
  if (segments.length > 2) {
    if (segments[2] !== 'tree' || segments.length < 4) {
      throw new Error('GitHub repository URL must point to the repository root or /tree/<ref>.')
    }

    ref = decodeURIComponent(segments.slice(3).join('/'))
    if (!ref) {
      throw new Error('GitHub repository URL is missing the ref after /tree/.')
    }
  }

  return {
    owner,
    repo,
    ref,
    normalizedUrl: `https://${GITHUB_HOSTNAME}/${owner}/${repo}${ref ? `/tree/${ref}` : ''}`,
  }
}

export function resolveOfficialReadyAppSource(
  appName: string,
  packageVersion: string,
): OfficialReadyAppSource {
  const validation = validateSlug(appName, 'Ready app name')
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  return {
    kind: 'official',
    appSlug: appName,
    owner: 'open-mercato',
    repo: `ready-app-${appName}`,
    ref: `v${packageVersion}`,
  }
}

export function resolveReadyAppSource(
  options: ReadyAppSelectionOptions,
  packageVersion: string,
): ReadyAppSource | null {
  const selectedFlags = [options.app, options.appUrl].filter(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )

  if (selectedFlags.length > 1) {
    throw new Error('Options --app and --app-url are mutually exclusive. Use only one source flag.')
  }

  if (options.app) {
    return resolveOfficialReadyAppSource(options.app.trim(), packageVersion)
  }

  if (options.appUrl) {
    const parsed = parseGitHubRepositoryUrl(options.appUrl.trim())
    return {
      kind: 'external',
      owner: parsed.owner,
      repo: parsed.repo,
      ref: parsed.ref,
      sourceUrl: parsed.normalizedUrl,
    }
  }

  return null
}

export function getGitHubApiBaseUrl(): string {
  const overridden = process.env.OM_CREATE_APP_GITHUB_API_BASE_URL?.trim()
  if (!overridden) {
    return DEFAULT_GITHUB_API_BASE_URL
  }

  return overridden.replace(/\/+$/u, '')
}

function buildGitHubRepoApiUrl(owner: string, repo: string): string {
  return `${getGitHubApiBaseUrl()}/repos/${owner}/${repo}`
}

function buildGitHubTarballApiUrl(owner: string, repo: string, ref: string): string {
  return `${getGitHubApiBaseUrl()}/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`
}

function buildGitHubHeaders(packageVersion: string): Headers {
  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    'User-Agent': `create-mercato-app/${packageVersion}`,
  })

  const token = process.env.GITHUB_TOKEN?.trim()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return headers
}

function buildRepoAccessError(owner: string, repo: string): Error {
  return new Error(
    `GitHub repository not found or inaccessible: ${owner}/${repo}. Check the repository URL. If it is private, set GITHUB_TOKEN and retry.`,
  )
}

function buildNetworkError(owner: string, repo: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Error(
    `Unable to reach GitHub while fetching ${owner}/${repo}. Check network access or the repository URL. (${detail})`,
  )
}

async function readGitHubErrorMessage(response: Response): Promise<string | null> {
  try {
    const payload = await response.json()
    if (
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
    ) {
      return payload.message
    }
  } catch {
    return null
  }

  return null
}

function isGitHubRateLimitResponse(response: Response, message: string | null): boolean {
  const remaining = response.headers.get('x-ratelimit-remaining')
  if (remaining === '0') {
    return true
  }

  const normalizedMessage = message?.toLowerCase() ?? ''
  return normalizedMessage.includes('rate limit')
}

async function buildGitHubRequestError(
  response: Response,
  owner: string,
  repo: string,
  action: string,
): Promise<Error> {
  const message = await readGitHubErrorMessage(response)

  if (isGitHubRateLimitResponse(response, message)) {
    return new Error(
      `GitHub API rate limit reached while ${action} ${owner}/${repo}. Set GITHUB_TOKEN and retry.`,
    )
  }

  if (response.status === 401) {
    return new Error(
      `GitHub authentication failed while ${action} ${owner}/${repo}. Check GITHUB_TOKEN and retry.`,
    )
  }

  if (response.status === 403 && message?.toLowerCase().includes('resource not accessible')) {
    return buildRepoAccessError(owner, repo)
  }

  return new Error(
    `GitHub API request failed while ${action} ${owner}/${repo} (${response.status}${message ? `: ${message}` : ''}).`,
  )
}

async function performGitHubRequest(
  url: string,
  owner: string,
  repo: string,
  packageVersion: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      headers: buildGitHubHeaders(packageVersion),
      redirect: 'follow',
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    throw buildNetworkError(owner, repo, error)
  }
}

/** Deadlines for the GitHub operations of `--template`; every value is in milliseconds. */
export type GitHubDeadlines = {
  /** One API request: headers and JSON body, and the headers of a tarball. */
  requestTimeoutMs?: number
  /** A tarball body that delivers no bytes for this long is abandoned. */
  archiveIdleTimeoutMs?: number
  /** A whole tarball download, headers and body. */
  archiveTimeoutMs?: number
}

export const GITHUB_REQUEST_TIMEOUT_MS = 15_000
export const GITHUB_ARCHIVE_IDLE_TIMEOUT_MS = 30_000
export const GITHUB_ARCHIVE_TIMEOUT_MS = 10 * 60_000

type OperationDeadline = {
  signal: AbortSignal
  /** Restarts the stall timer: the operation is aborted when it is not called again within `ms`. */
  stallAfter(ms: number): void
  clear(): void
}

function startDeadline(totalMs: number): OperationDeadline {
  const controller = new AbortController()
  const total = setTimeout(() => controller.abort(), totalMs)
  let stall: ReturnType<typeof setTimeout> | undefined
  return {
    signal: controller.signal,
    stallAfter(ms) {
      clearTimeout(stall)
      stall = setTimeout(() => controller.abort(), ms)
    },
    clear() {
      clearTimeout(total)
      clearTimeout(stall)
    },
  }
}

function buildTimeoutError(owner: string, repo: string, action: string): Error {
  return new Error(`GitHub did not answer in time while ${action} ${owner}/${repo}. Check network access and retry.`)
}

/** Settles with `work`, or rejects with the timeout error once the deadline aborts, whatever the fetch implementation does with the signal. */
async function withinDeadline<T>(work: Promise<T>, deadline: OperationDeadline, timeoutError: () => Error): Promise<T> {
  const { signal } = deadline
  if (signal.aborted) throw timeoutError()
  let onAbort: () => void = () => undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(timeoutError())
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([work, aborted])
  } catch (error) {
    throw signal.aborted ? timeoutError() : error
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * One API request under its own deadline, covering the headers and the JSON body. A status in `passthrough` returns
 * without a payload; any other failure throws the GitHub request error.
 */
async function requestGitHubJson(
  url: string,
  target: { owner: string; repo: string; action: string },
  packageVersion: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  passthrough: readonly number[] = [],
): Promise<{ status: number; payload: unknown }> {
  const { owner, repo, action } = target
  const deadline = startDeadline(timeoutMs)
  const timeoutError = () => buildTimeoutError(owner, repo, action)
  try {
    const response = await withinDeadline(
      performGitHubRequest(url, owner, repo, packageVersion, fetchImpl, deadline.signal),
      deadline,
      timeoutError,
    )
    if (passthrough.includes(response.status)) {
      await response.body?.cancel().catch(() => undefined)
      return { status: response.status, payload: null }
    }
    if (!response.ok) {
      throw await withinDeadline(buildGitHubRequestError(response, owner, repo, action), deadline, timeoutError)
    }
    return { status: response.status, payload: await withinDeadline(response.json() as Promise<unknown>, deadline, timeoutError) }
  } finally {
    deadline.clear()
  }
}

async function fetchGitHubRepositoryInfo(
  owner: string,
  repo: string,
  packageVersion: string,
  fetchImpl: FetchLike,
  timeoutMs?: number,
): Promise<GitHubRepositoryInfo | null> {
  let payload: { default_branch?: unknown }
  if (timeoutMs === undefined) {
    const response = await performGitHubRequest(
      buildGitHubRepoApiUrl(owner, repo),
      owner,
      repo,
      packageVersion,
      fetchImpl,
    )

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw await buildGitHubRequestError(response, owner, repo, 'inspecting')
    }

    payload = (await response.json()) as { default_branch?: unknown }
  } else {
    const result = await requestGitHubJson(
      buildGitHubRepoApiUrl(owner, repo),
      { owner, repo, action: 'inspecting' },
      packageVersion,
      fetchImpl,
      timeoutMs,
      [404],
    )
    if (result.status === 404) return null
    payload = (result.payload ?? {}) as { default_branch?: unknown }
  }

  const defaultBranch =
    typeof payload.default_branch === 'string' && payload.default_branch.trim().length > 0
      ? payload.default_branch
      : null

  if (!defaultBranch) {
    throw new Error(`GitHub repository metadata for ${owner}/${repo} is missing default_branch.`)
  }

  return { defaultBranch }
}

/**
 * The default branch of a repository; a missing or hidden repository gets the access error with the token hint.
 * Headers and body share one deadline (`requestTimeoutMs`).
 */
export async function resolveGitHubDefaultBranch(
  owner: string,
  repo: string,
  packageVersion: string,
  fetchImpl: FetchLike = fetch,
  deadlines: GitHubDeadlines = {},
): Promise<string> {
  const timeoutMs = deadlines.requestTimeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS
  const repoInfo = await fetchGitHubRepositoryInfo(owner, repo, packageVersion, fetchImpl, timeoutMs)
  if (!repoInfo) {
    throw buildRepoAccessError(owner, repo)
  }

  return repoInfo.defaultBranch
}

/**
 * The commit sha a branch, tag or sha points to, read from `GET /repos/{owner}/{repo}/commits/{ref}`. Each request
 * has its own deadline (`requestTimeoutMs`) over headers and body.
 */
export async function resolveGitHubCommitSha(
  owner: string,
  repo: string,
  ref: string,
  packageVersion: string,
  fetchImpl: FetchLike = fetch,
  deadlines: GitHubDeadlines = {},
): Promise<string> {
  const timeoutMs = deadlines.requestTimeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS
  // GitHub answers 422 for a ref that names no commit and 404 for a missing repository or ref.
  const { status, payload } = await requestGitHubJson(
    `${buildGitHubRepoApiUrl(owner, repo)}/commits/${encodeURIComponent(ref)}`,
    { owner, repo, action: 'resolving a ref of' },
    packageVersion,
    fetchImpl,
    timeoutMs,
    [404, 422],
  )

  if (status === 404 || status === 422) {
    const repoInfo = await fetchGitHubRepositoryInfo(owner, repo, packageVersion, fetchImpl, timeoutMs)
    if (!repoInfo) {
      throw buildRepoAccessError(owner, repo)
    }

    throw new Error(`Ref not found: ${owner}/${repo}#${ref}. Check that the branch, tag or commit exists.`)
  }

  const sha = typeof payload === 'object' && payload !== null && 'sha' in payload ? payload.sha : null
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/iu.test(sha)) {
    throw new Error(`GitHub did not return a commit sha for ${owner}/${repo}#${ref}.`)
  }

  return sha.toLowerCase()
}

export type RepositoryTarballDownload = { status: 'ok'; archive: DownloadedArchive } | { status: 'not-found' }

/**
 * The tarball of one commit, `GET /repos/{owner}/{repo}/tarball/{sha}`. A 404 is returned as `not-found` when the
 * repository itself is still reachable, so the caller can explain a commit that is gone. The headers must arrive
 * within `requestTimeoutMs`, the body may not stall for `archiveIdleTimeoutMs`, and the whole download ends at
 * `archiveTimeoutMs`; a timed-out download leaves no partial file.
 */
export async function downloadRepositoryTarball(
  owner: string,
  repo: string,
  sha: string,
  packageVersion: string,
  fetchImpl: FetchLike = fetch,
  deadlines: GitHubDeadlines = {},
): Promise<RepositoryTarballDownload> {
  const requestTimeoutMs = deadlines.requestTimeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS
  const idleTimeoutMs = deadlines.archiveIdleTimeoutMs ?? GITHUB_ARCHIVE_IDLE_TIMEOUT_MS
  const action = 'downloading tarball for'
  const timeoutError = () => buildTimeoutError(owner, repo, action)
  const deadline = startDeadline(deadlines.archiveTimeoutMs ?? GITHUB_ARCHIVE_TIMEOUT_MS)
  try {
    deadline.stallAfter(requestTimeoutMs)
    const response = await withinDeadline(
      performGitHubRequest(buildGitHubTarballApiUrl(owner, repo, sha), owner, repo, packageVersion, fetchImpl, deadline.signal),
      deadline,
      timeoutError,
    )
    if (response.ok) {
      deadline.stallAfter(idleTimeoutMs)
      try {
        const archive = await readCappedBody(response, `${owner}/${repo}`, undefined, {
          signal: deadline.signal,
          onChunk: () => deadline.stallAfter(idleTimeoutMs),
        })
        return { status: 'ok', archive }
      } catch (error) {
        throw deadline.signal.aborted ? timeoutError() : error
      }
    }
    if (response.status !== 404) {
      throw await withinDeadline(buildGitHubRequestError(response, owner, repo, action), deadline, timeoutError)
    }
    await response.body?.cancel().catch(() => undefined)
  } finally {
    deadline.clear()
  }

  const repoInfo = await fetchGitHubRepositoryInfo(owner, repo, packageVersion, fetchImpl, requestTimeoutMs)
  if (!repoInfo) {
    throw buildRepoAccessError(owner, repo)
  }

  return { status: 'not-found' }
}

/** Printed when `--app <name>` finds no official repo (Templates umbrella spec, A8). */
export const READY_APP_MISS_HINT =
  'Ready apps are now app templates: see https://modules.openmercato.com/templates or use --template <owner/repo>.'

export async function downloadReadyAppSnapshot(
  source: ReadyAppSource,
  packageVersion: string,
  fetchImpl: FetchLike = fetch,
): Promise<ReadyAppDownload> {
  let resolvedRef = source.ref

  if (!resolvedRef) {
    const repoInfo = await fetchGitHubRepositoryInfo(
      source.owner,
      source.repo,
      packageVersion,
      fetchImpl,
    )

    if (!repoInfo) {
      throw buildRepoAccessError(source.owner, source.repo)
    }

    resolvedRef = repoInfo.defaultBranch
  }

  const tarballResponse = await performGitHubRequest(
    buildGitHubTarballApiUrl(source.owner, source.repo, resolvedRef),
    source.owner,
    source.repo,
    packageVersion,
    fetchImpl,
  )

  if (tarballResponse.ok) {
    return {
      archive: await readCappedBody(tarballResponse, `${source.owner}/${source.repo}`),
      owner: source.owner,
      repo: source.repo,
      ref: resolvedRef,
    }
  }

  if (tarballResponse.status === 404) {
    const repoInfo = await fetchGitHubRepositoryInfo(
      source.owner,
      source.repo,
      packageVersion,
      fetchImpl,
    )

    if (!repoInfo) {
      if (source.kind === 'official') {
        throw new Error(`Official ready app repository not found: ${source.owner}/${source.repo}. ${READY_APP_MISS_HINT}`)
      }

      throw buildRepoAccessError(source.owner, source.repo)
    }

    if (source.kind === 'official') {
      throw new Error(
        `Official ready app compatibility tag not found: ${source.owner}/${source.repo}@${resolvedRef}. Expected tag ${source.ref} for this create-mercato-app release.`,
      )
    }

    throw new Error(
      `Ready app ref not found: ${source.owner}/${source.repo}@${resolvedRef}. Check the GitHub URL and ensure the branch or tag exists.`,
    )
  }

  throw await buildGitHubRequestError(
    tarballResponse,
    source.owner,
    source.repo,
    'downloading tarball for',
  )
}

/** The bootstrap-safe artifact every app gets, imported ones included (packages/create-app AGENTS.md, Always 7). */
export function ensureGeneratedCssPlaceholder(targetDir: string): void {
  const generatedDir = join(targetDir, '.mercato', 'generated')
  const placeholderPath = join(generatedDir, 'module-package-sources.css')

  mkdirSync(generatedDir, { recursive: true })
  if (!existsSync(placeholderPath)) {
    writeFileSync(placeholderPath, '')
  }
}

/** `.template` files in a tree, found by the same `lstat` walk that rejects links and special files. */
export function findTemplateFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }

  return listRegularFiles(dir).filter((path) => path.endsWith('.template'))
}

export function validateImportedReadyAppSnapshot(dir: string): void {
  const templateFiles = findTemplateFiles(dir)
  if (templateFiles.length === 0) {
    return
  }

  const preview = templateFiles.slice(0, 5).join(', ')
  throw new Error(
    `Imported ready apps must be committed source snapshots. Found .template files: ${preview}${templateFiles.length > 5 ? ', ...' : ''}`,
  )
}

export interface ExtractSnapshotOptions {
  /** Defaults to `ARCHIVE_LIMITS`; tests pass smaller ones. */
  limits?: ArchiveLimits
  /** Runs after extraction, inside the cleanup scope (validation, finalizing). */
  afterExtract?: (targetDir: string) => void | Promise<void>
  /** Removes the target directory when this call created it and a later step fails (`--template` only). */
  removeTargetOnFailure?: boolean
}

/**
 * Imports an untrusted archive: pass 1 inspects it without writing, then the target is created non-recursively,
 * pass 2 extracts files and directories only, and an `lstat` walk checks the result. A pass 1 failure creates nothing.
 */
export async function extractTarballSnapshot(
  archivePath: string,
  targetDir: string,
  options: ExtractSnapshotOptions = {},
): Promise<void> {
  await inspectArchive(archivePath, options.limits)
  createTargetDirectory(targetDir)

  try {
    await extractArchive(archivePath, targetDir)
    assertRegularTree(targetDir)
    await options.afterExtract?.(targetDir)
  } catch (error) {
    if (options.removeTargetOnFailure) {
      rmSync(targetDir, { recursive: true, force: true })
    }
    throw error
  }
}
