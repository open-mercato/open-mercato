#!/usr/bin/env node
// Blocks pull requests containing a commit under packages/enterprise/
// authored by someone outside ALLOWED_LOGINS — see .github/workflows/
// enterprise-contribution-guard.yml for how this is wired into CI, and
// CONTRIBUTING.md § Enterprise Module Contributions for the policy this
// enforces. Pure decision logic lives in `evaluate()`; `main()` is the only
// part that talks to the GitHub API, so the former is what scripts/__tests__
// exercises directly, with fakes standing in for the GitHub calls.
import fs from 'node:fs'

export const ENTERPRISE_PREFIX = 'packages/enterprise/'

// Keep in sync by hand; do not widen this to an org/team or association
// check — membership changes shouldn't silently grant enterprise write
// access. Derived from `git log` authorship on packages/enterprise/ across
// origin/main + origin/develop (everyone with merged history there today).
export const ALLOWED_LOGINS = new Set([
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

export function isAllowedLogin(login, allowedLogins) {
  return typeof login === 'string' && allowedLogins.has(login.toLowerCase())
}

/**
 * @param {object} deps
 * @param {() => Promise<string[]>} deps.listFiles - every file path changed in the PR
 * @param {() => Promise<Array<{ sha: string, authorLogin: string | null, authorType: string | null, authorEmail: string | null }>>} deps.listCommits
 * @param {(sha: string) => Promise<string[]>} deps.getCommitFiles - file paths touched by one commit
 * @param {Set<string>} deps.allowedLogins
 */
export async function evaluate({ listFiles, listCommits, getCommitFiles, allowedLogins }) {
  const files = await listFiles()
  if (!files.some((f) => f.startsWith(ENTERPRISE_PREFIX))) {
    return { touchesEnterprise: false, violations: [] }
  }

  const commits = await listCommits()
  const violations = []

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

  return { touchesEnterprise: true, violations }
}

export function formatSummaryMarkdown(violations) {
  const lines = [
    '## Enterprise Contribution Guard',
    '',
    '`packages/enterprise/` is commercial, proprietary software — only specific allowlisted accounts may author commits that touch it (see [CONTRIBUTING.md § Enterprise Module Contributions](https://github.com/open-mercato/open-mercato/blob/main/CONTRIBUTING.md#enterprise-module-contributions)).',
    '',
    'These commits need to be dropped from this PR; open a separate issue describing the change instead:',
    '',
    ...violations.map((v) => `- ${v.sha.slice(0, 7)} by ${v.identity}: ${v.files.map((f) => `\`${f}\``).join(', ')}`),
    '',
  ]
  return lines.join('\n')
}

async function paginate(fetchPage) {
  const results = []
  let page = 1
  for (;;) {
    const items = await fetchPage(page)
    results.push(...items)
    if (items.length < 100) break
    page += 1
  }
  return results
}

async function githubRequest(path, { token, apiUrl }) {
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

function buildGithubDeps({ owner, repo, prNumber, token, apiUrl }) {
  const sep = (p) => (p.includes('?') ? '&' : '?')
  return {
    async listFiles() {
      const files = await paginate((page) =>
        githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/files${sep('')}per_page=100&page=${page}`, { token, apiUrl }),
      )
      return files.map((f) => f.filename)
    },
    async listCommits() {
      const commits = await paginate((page) =>
        githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/commits${sep('')}per_page=100&page=${page}`, { token, apiUrl }),
      )
      return commits.map((c) => ({
        sha: c.sha,
        authorLogin: c.author?.login ?? null,
        authorType: c.author?.type ?? null,
        authorEmail: c.commit?.author?.email ?? null,
      }))
    },
    async getCommitFiles(sha) {
      const commit = await githubRequest(`/repos/${owner}/${repo}/commits/${sha}`, { token, apiUrl })
      return (commit.files || []).map((f) => f.filename)
    },
  }
}

export async function main({ env = process.env } = {}) {
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

  const { touchesEnterprise, violations } = await evaluate({
    ...buildGithubDeps({ owner, repo, prNumber, token, apiUrl }),
    allowedLogins: ALLOWED_LOGINS,
  })

  if (!touchesEnterprise) {
    console.log('No packages/enterprise/ files changed; nothing to do.')
    return 0
  }
  if (violations.length === 0) {
    console.log('All commits touching packages/enterprise/ are from allowlisted authors.')
    return 0
  }

  const summary = formatSummaryMarkdown(violations)
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`)
  }
  for (const v of violations) {
    console.log(`::error::Commit ${v.sha.slice(0, 7)} by ${v.identity} touches packages/enterprise/: ${v.files.join(', ')}`)
  }
  console.log(`::error::${violations.length} commit(s) by non-allowlisted authors touch packages/enterprise/. See the job summary.`)
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
