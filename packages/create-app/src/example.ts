export interface ExampleInfo {
  owner: string
  repo: string
  branch: string
  filePath: string // subdirectory within the repo (e.g., "examples/prm")
}

const OFFICIAL_OWNER = 'open-mercato'
const OFFICIAL_REPO = 'ready-apps'
const OFFICIAL_BRANCH = 'main'
const OFFICIAL_PREFIX = 'examples'

/**
 * Parse an example identifier (plain name or GitHub URL) into fetch coordinates.
 */
export function parseExampleUrl(input: string): ExampleInfo {
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

    const branch = parts[3]
    const filePath = parts.slice(4).join('/')

    return { owner, repo, branch, filePath }
  }

  // Plain name — resolve to official examples repo
  if (/^[a-z0-9-]+$/.test(input)) {
    return {
      owner: OFFICIAL_OWNER,
      repo: OFFICIAL_REPO,
      branch: OFFICIAL_BRANCH,
      filePath: `${OFFICIAL_PREFIX}/${input}`,
    }
  }

  throw new Error(
    `Invalid example: "${input}". Use a plain name (e.g., "prm") or a GitHub URL (e.g., "https://github.com/owner/repo")`
  )
}
