#!/usr/bin/env node
// Blocks pull requests touching packages/enterprise/ that were opened by, or
// contain a commit authored by, someone outside ALLOWED_LOGINS — see .github/workflows/
// enterprise-contribution-guard.yml for how this is wired into CI, and
// CONTRIBUTING.md § Enterprise Module Contributions for the policy this
// enforces. Pure decision logic lives in `evaluate()`; `main()` is the only
// part that talks to the GitHub API, so the former is what scripts/__tests__
// exercises directly, with fakes standing in for the GitHub calls. Run
// directly with `node` (no build step) — Node strips the type annotations.
import fs from 'node:fs'

export const ENTERPRISE_PREFIX = 'packages/enterprise/'

// Keep in sync by hand; do not widen this to an org/team or association
// check — membership changes shouldn't silently grant enterprise write
// access. Derived from `git log` authorship on packages/enterprise/ across
// origin/main + origin/develop (everyone with merged history there today).
export const ALLOWED_LOGINS: Set<string> = new Set([
  'pkarw',
  'patzick',
  'haxiorz',
  'mstaniaszek1998',
  'pat-lewczuk',
  'matgren',
  'zielivia',
  'andrzejewsky',
  'dominikpalatynski',
])

export interface CommitInfo {
  sha: string
  authorLogin: string | null
  authorType: string | null
  authorEmail: string | null
}

export interface Violation {
  sha: string
  identity: string
  files: string[]
}

export interface PrAuthor {
  login: string | null
  type: string | null
}

export interface EvaluateDeps {
  prAuthor: PrAuthor
  listFiles: () => Promise<string[]>
  listCommits: () => Promise<CommitInfo[]>
  getCommitFiles: (sha: string) => Promise<string[]>
  allowedLogins: Set<string>
}

export interface EvaluateResult {
  touchesEnterprise: boolean
  prAuthorViolation: string | null
  violations: Violation[]
}

export function isAllowedLogin(login: string | null | undefined, allowedLogins: Set<string>): boolean {
  return typeof login === 'string' && allowedLogins.has(login.toLowerCase())
}

export async function evaluate({ prAuthor, listFiles, listCommits, getCommitFiles, allowedLogins }: EvaluateDeps): Promise<EvaluateResult> {
  const files = await listFiles()
  if (!files.some((f) => f.startsWith(ENTERPRISE_PREFIX))) {
    return { touchesEnterprise: false, prAuthorViolation: null, violations: [] }
  }

  // Commit author identity is resolved from the commit email, which anyone can
  // set to an allowlisted maintainer's (or a bot's) address, so the PR opener —
  // the authenticated account behind the PR — must be allowlisted as well.
  const prAuthorAllowed = prAuthor.type === 'Bot' || isAllowedLogin(prAuthor.login, allowedLogins)
  const prAuthorViolation = prAuthorAllowed ? null : prAuthor.login ? `@${prAuthor.login}` : 'unknown author'

  const commits = await listCommits()
  const violations: Violation[] = []

  for (const commit of commits) {
    const commitFiles = await getCommitFiles(commit.sha)
    const enterpriseFiles = commitFiles.filter((f) => f.startsWith(ENTERPRISE_PREFIX))
    if (enterpriseFiles.length === 0) continue
    if (commit.authorType === 'Bot') continue
    if (isAllowedLogin(commit.authorLogin, allowedLogins)) continue

    violations.push({
      sha: commit.sha,
      identity: commit.authorLogin ? `@${commit.authorLogin}` : commit.authorEmail || 'unknown author',
      files: enterpriseFiles,
    })
  }

  return { touchesEnterprise: true, prAuthorViolation, violations }
}

export function formatSummaryMarkdown(violations: Violation[], prAuthorViolation: string | null = null): string {
  const lines = [
    '## Enterprise Contribution Guard',
    '',
    '`packages/enterprise/` is commercial, proprietary software — only specific allowlisted accounts may author commits that touch it (see [CONTRIBUTING.md § Enterprise Module Contributions](https://github.com/open-mercato/open-mercato/blob/main/CONTRIBUTING.md#enterprise-module-contributions)).',
    '',
    ...(prAuthorViolation
      ? [`This PR was opened by ${prAuthorViolation}, who is not allowlisted for \`packages/enterprise/\` — revert those changes or open a separate issue describing the change instead.`, '']
      : []),
    ...(violations.length > 0
      ? [
          'These commits need to be dropped from this PR; open a separate issue describing the change instead:',
          '',
          ...violations.map((v) => `- ${v.sha.slice(0, 7)} by ${v.identity}: ${v.files.map((f) => `\`${f}\``).join(', ')}`),
          '',
        ]
      : []),
  ]
  return lines.join('\n')
}

async function paginate<T>(fetchPage: (page: number) => Promise<T[]>): Promise<T[]> {
  const results: T[] = []
  let page = 1
  for (;;) {
    const items = await fetchPage(page)
    results.push(...items)
    if (items.length < 100) break
    page += 1
  }
  return results
}

interface GithubRequestOptions {
  token: string
  apiUrl: string
}

async function githubRequest(path: string, { token, apiUrl }: GithubRequestOptions): Promise<any> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

function buildGithubDeps({ owner, repo, prNumber, token, apiUrl }: {
  owner: string
  repo: string
  prNumber: number
  token: string
  apiUrl: string
}): Omit<EvaluateDeps, 'allowedLogins'> {
  return {
    async listFiles() {
      const files = await paginate((page) =>
        githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`, { token, apiUrl }),
      )
      return files.map((f: any) => f.filename)
    },
    async listCommits() {
      const commits = await paginate((page) =>
        githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=100&page=${page}`, { token, apiUrl }),
      )
      return commits.map((c: any) => ({
        sha: c.sha,
        authorLogin: c.author?.login ?? null,
        authorType: c.author?.type ?? null,
        authorEmail: c.commit?.author?.email ?? null,
      }))
    },
    async getCommitFiles(sha: string) {
      const commit = await githubRequest(`/repos/${owner}/${repo}/commits/${sha}`, { token, apiUrl })
      return (commit.files || []).map((f: any) => f.filename)
    },
  }
}

export async function main({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}): Promise<number> {
  const token = env.GITHUB_TOKEN
  const apiUrl = env.GITHUB_API_URL || 'https://api.github.com'
  const [owner, repo] = (env.GITHUB_REPOSITORY || '').split('/')
  const eventPath = env.GITHUB_EVENT_PATH
  if (!token || !owner || !repo || !eventPath) {
    throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_PATH must be set.')
  }
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
  const prNumber = event.pull_request?.number
  if (!prNumber) {
    throw new Error('This script must run on a pull_request event.')
  }

  const { touchesEnterprise, prAuthorViolation, violations } = await evaluate({
    prAuthor: { login: event.pull_request.user?.login ?? null, type: event.pull_request.user?.type ?? null },
    ...buildGithubDeps({ owner, repo, prNumber, token, apiUrl }),
    allowedLogins: ALLOWED_LOGINS,
  })

  if (!touchesEnterprise) {
    console.log('No packages/enterprise/ files changed; nothing to do.')
    return 0
  }
  if (!prAuthorViolation && violations.length === 0) {
    console.log('The PR author and all commits touching packages/enterprise/ are allowlisted.')
    return 0
  }

  const summary = formatSummaryMarkdown(violations, prAuthorViolation)
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`)
  }
  if (prAuthorViolation) {
    console.log(`::error::PR opened by ${prAuthorViolation}, who is not allowlisted, touches packages/enterprise/.`)
  }
  for (const v of violations) {
    console.log(`::error::Commit ${v.sha.slice(0, 7)} by ${v.identity} touches packages/enterprise/: ${v.files.join(', ')}`)
  }
  if (violations.length > 0) {
    console.log(`::error::${violations.length} commit(s) by non-allowlisted authors touch packages/enterprise/. See the job summary.`)
  }
  return 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
