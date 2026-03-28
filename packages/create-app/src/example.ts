import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extract as tarExtract } from 'tar'
import pc from 'picocolors'

export interface ExampleInfo {
  owner: string
  repo: string
  branch: string
  filePath: string // subdirectory within the repo (e.g., "apps/prm")
}

const OFFICIAL_OWNER = 'open-mercato'
const OFFICIAL_REPO = 'ready-apps'
const OFFICIAL_BRANCH = 'main'
const OFFICIAL_PREFIX = 'apps'

/**
 * Parse an example identifier (plain name or GitHub URL) into fetch coordinates.
 * @param options.branch - Override the branch (useful for branches with `/` in the name)
 */
export function parseExampleUrl(input: string, options?: { branch?: string }): ExampleInfo {
  // GitHub URL
  if (input.startsWith('https://github.com/') || input.startsWith('http://github.com/')) {
    const url = new URL(input)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts.length < 2) {
      throw new Error(`Invalid GitHub URL: ${input}. Expected format: https://github.com/owner/repo`)
    }

    const owner = parts[0]
    const repo = parts[1]

    if (parts.length === 2) {
      return { owner, repo, branch: 'main', filePath: '' }
    }

    if (parts[2] !== 'tree' || parts.length < 4) {
      throw new Error(
        `Invalid GitHub URL: ${input}. To specify a branch, use: https://github.com/owner/repo/tree/branch`
      )
    }

    // When --app-branch is provided, skip the branch segments in the URL path
    // (avoids ambiguity with branches containing '/' like feat/my-feature)
    if (options?.branch) {
      const branchSegments = options.branch.split('/').length
      const filePath = parts.slice(3 + branchSegments).join('/')
      return { owner, repo, branch: options.branch, filePath }
    }

    const branch = parts[3]
    const filePath = parts.slice(4).join('/')

    return { owner, repo, branch, filePath }
  }

  // Plain name — resolve to official examples repo
  if (/^[a-z0-9-]+$/.test(input)) {
    return {
      owner: OFFICIAL_OWNER,
      repo: OFFICIAL_REPO,
      branch: options?.branch ?? OFFICIAL_BRANCH,
      filePath: `${OFFICIAL_PREFIX}/${input}`,
    }
  }

  throw new Error(
    `Invalid app: "${input}". Use a plain name (e.g., "prm") or a GitHub URL (e.g., "https://github.com/owner/repo")`
  )
}

function getGithubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'create-mercato-app',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

export async function checkExampleExists(info: ExampleInfo, token?: string): Promise<void> {
  if (!info.filePath) return

  const url = `https://api.github.com/repos/${info.owner}/${info.repo}/contents/${info.filePath}?ref=${info.branch}`
  const response = await fetch(url, { headers: getGithubHeaders(token) })

  if (response.status === 404) {
    throw new Error(
      `App not found: "${info.filePath}" does not exist in ${info.owner}/${info.repo} (branch: ${info.branch})`
    )
  }

  if (response.status === 403) {
    throw new Error(
      'GitHub API rate limit reached. Set GITHUB_TOKEN environment variable for higher limits.'
    )
  }

  if (response.status === 401) {
    throw new Error(
      'Repository not accessible. For private repos, set GITHUB_TOKEN environment variable.'
    )
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API error (${response.status}): Could not verify app at ${info.owner}/${info.repo}/${info.filePath}`
    )
  }
}

async function fetchWithRetry(url: string, headers: Record<string, string>, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { headers })
      if (response.ok) return response
      // 403 = rate limit — fail immediately, don't retry
      if (response.status === 403) {
        throw new Error('GitHub API rate limit reached. Set GITHUB_TOKEN environment variable for higher limits.')
      }
      if (attempt === retries) {
        throw new Error(`Download failed (${response.status}) after ${retries} attempts`)
      }
    } catch (error) {
      // Re-throw non-retryable errors (including 403) immediately
      if (error instanceof Error && error.message.includes('rate limit')) throw error
      if (attempt === retries) throw error
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt))
  }
  throw new Error('Download failed — unreachable')
}

export async function downloadAndExtract(info: ExampleInfo, targetDir: string, token?: string): Promise<void> {
  const url = `https://codeload.github.com/${info.owner}/${info.repo}/tar.gz/${info.branch}`
  const headers = getGithubHeaders(token)

  console.log(pc.dim(`  Downloading app from ${info.owner}/${info.repo}...`))

  const response = await fetchWithRetry(url, headers)

  if (!response.body) {
    throw new Error('Download failed — empty response body')
  }

  let rootDir: string | null = null
  const prefix = info.filePath ? `${info.filePath}/` : ''
  const stripCount = 1 + (info.filePath ? info.filePath.split('/').length : 0)

  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    tarExtract({
      cwd: targetDir,
      strip: stripCount,
      filter: (path) => {
        if (rootDir === null) {
          rootDir = path.split('/')[0]
        }

        if (!prefix) return true

        const withoutRoot = path.slice(rootDir.length + 1)
        return withoutRoot.startsWith(prefix)
      },
    })
  )
}
