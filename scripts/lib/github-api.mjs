// The GitHub REST calls the release-line workflows make (scripts/release-line.mjs).
//
// Commits go through the git data API rather than `git push`, so a token that may write the
// branch (RELEASE_TOKEN, on the `release/v*` ruleset's bypass list) is all a run needs. A PR
// opened with the workflow's own GITHUB_TOKEN triggers no CI, so callers pass RELEASE_TOKEN.
// Every call is re-run safe: existing branches, PRs, labels and releases are reused.

const DEFAULT_API = 'https://api.github.com'

export function createGithubClient({ token, repository, apiUrl = process.env.GITHUB_API_URL, fetchImpl = fetch }) {
  if (!token) throw new Error('[internal] GH_TOKEN is not set')
  if (!/^[^/]+\/[^/]+$/.test(repository ?? '')) throw new Error(`[internal] bad GITHUB_REPOSITORY "${repository}"`)
  const [owner, repo] = repository.split('/')
  const api = (apiUrl || DEFAULT_API).replace(/\/$/, '')
  const base = `/repos/${owner}/${repo}`

  const call = async (method, route, body) => {
    const response = await fetchImpl(`${api}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    return { status: response.status, data: text ? JSON.parse(text) : null }
  }
  const ok = async (method, route, body) => {
    const { status, data } = await call(method, route, body)
    if (status >= 300) throw new Error(`[internal] ${method} ${route} → ${status}: ${data?.message ?? ''}`)
    return data
  }
  const refPath = (branch) => encodeURIComponent(branch).replace(/%2F/g, '/')

  return {
    owner,
    repo,
    async getBranchSha(branch) {
      const { status, data } = await call('GET', `${base}/git/ref/heads/${refPath(branch)}`)
      return status === 200 ? data.object.sha : null
    },
    async createBranch(branch, sha) {
      await ok('POST', `${base}/git/refs`, { ref: `refs/heads/${branch}`, sha })
    },
    async moveBranch(branch, sha, force) {
      await ok('PATCH', `${base}/git/refs/heads/${refPath(branch)}`, { sha, force })
    },
    async setBranch(branch, sha) {
      if ((await this.getBranchSha(branch)) === null) await this.createBranch(branch, sha)
      else await this.moveBranch(branch, sha, true)
    },
    async commitFiles({ parentSha, files, message }) {
      const parent = await ok('GET', `${base}/git/commits/${parentSha}`)
      const tree = await ok('POST', `${base}/git/trees`, {
        base_tree: parent.tree.sha,
        tree: files.map((file) => ({ path: file.path, mode: '100644', type: 'blob', content: file.content })),
      })
      const commit = await ok('POST', `${base}/git/commits`, { message, tree: tree.sha, parents: [parentSha] })
      return commit.sha
    },
    async readFile(filePath, ref) {
      const data = await ok('GET', `${base}/contents/${filePath}?ref=${encodeURIComponent(ref)}`)
      if (data.content) return Buffer.from(data.content, 'base64').toString('utf8')
      const blob = await ok('GET', `${base}/git/blobs/${data.sha}`)
      return Buffer.from(blob.content, 'base64').toString('utf8')
    },
    async openPullRequest({ head, base: target, title, body }) {
      const existing = await ok(
        'GET',
        `${base}/pulls?state=open&base=${encodeURIComponent(target)}&head=${owner}:${encodeURIComponent(head)}`,
      )
      if (existing.length > 0) return existing[0]
      return ok('POST', `${base}/pulls`, { head, base: target, title, body })
    },
    async addLabels(number, labels) {
      await ok('POST', `${base}/issues/${number}/labels`, { labels })
    },
    async ensureLabel(name, color, description) {
      const { status } = await call('POST', `${base}/labels`, { name, color, description })
      if (status !== 201 && status !== 422) throw new Error(`[internal] creating label "${name}" → ${status}`)
    },
    async generateNotes({ tag, target, previousTag }) {
      const data = await ok('POST', `${base}/releases/generate-notes`, {
        tag_name: tag,
        target_commitish: target,
        ...(previousTag ? { previous_tag_name: previousTag } : {}),
      })
      return data.body ?? ''
    },
    async createRelease({ tag, sha, name, body, makeLatest }) {
      const { status, data } = await call('GET', `${base}/releases/tags/${encodeURIComponent(tag)}`)
      const payload = { name, body, make_latest: makeLatest ? 'true' : 'false' }
      if (status === 200) {
        await ok('PATCH', `${base}/releases/${data.id}`, payload)
        return false
      }
      await ok('POST', `${base}/releases`, {
        ...payload,
        tag_name: tag,
        target_commitish: sha,
        draft: false,
        prerelease: false,
      })
      return true
    },
  }
}
