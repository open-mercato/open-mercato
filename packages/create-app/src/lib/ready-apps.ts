import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import * as tar from 'tar'

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
  archive: Uint8Array
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
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      headers: buildGitHubHeaders(packageVersion),
      redirect: 'follow',
    })
  } catch (error) {
    throw buildNetworkError(owner, repo, error)
  }
}

async function fetchGitHubRepositoryInfo(
  owner: string,
  repo: string,
  packageVersion: string,
  fetchImpl: FetchLike,
): Promise<GitHubRepositoryInfo | null> {
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

  const payload = (await response.json()) as { default_branch?: unknown }
  const defaultBranch =
    typeof payload.default_branch === 'string' && payload.default_branch.trim().length > 0
      ? payload.default_branch
      : null

  if (!defaultBranch) {
    throw new Error(`GitHub repository metadata for ${owner}/${repo} is missing default_branch.`)
  }

  return { defaultBranch }
}

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
      archive: new Uint8Array(await tarballResponse.arrayBuffer()),
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
        throw new Error(`Official ready app repository not found: ${source.owner}/${source.repo}.`)
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

export function findTemplateFiles(dir: string, rootDir = dir): string[] {
  if (!existsSync(dir)) {
    return []
  }

  const findings: string[] = []
  const entries = readdirSync(dir).sort()

  for (const entry of entries) {
    const entryPath = join(dir, entry)
    const entryStat = statSync(entryPath)

    if (entryStat.isDirectory()) {
      findings.push(...findTemplateFiles(entryPath, rootDir))
      continue
    }

    if (entry.endsWith('.template')) {
      findings.push(relative(rootDir, entryPath))
    }
  }

  return findings
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

export async function extractTarballSnapshot(
  archive: Uint8Array,
  targetDir: string,
): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'create-mercato-app-tarball-'))
  const archivePath = join(tempDir, 'ready-app.tar.gz')

  writeFileSync(archivePath, archive)
  mkdirSync(targetDir, { recursive: true })

  try {
    await tar.x({
      cwd: targetDir,
      file: archivePath,
      strip: 1,
    })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
