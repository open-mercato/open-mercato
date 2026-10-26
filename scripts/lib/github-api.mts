// The GitHub REST calls the release-line workflows make (scripts/release-line.mts).
//
// Commits go through the git data API rather than `git push`, so a token that may write the
// branch (the release GitHub App's token, on the `release/v*` ruleset's bypass list) is all a
// run needs. A PR opened with the workflow's own GITHUB_TOKEN triggers no CI, so callers pass
// the app token.
// Every call is re-run safe: existing branches, tags, PRs, labels and releases are reused.

const DEFAULT_API = 'https://api.github.com'

type HttpMethod = 'GET' | 'POST' | 'PATCH'

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>

export type CommitFile = { path: string; content: string }

export type PullRequest = { number: number; html_url: string }

type GitRef = { object: { sha: string } }
type GitObject = { sha: string; tree: { sha: string } }
type ContentFile = { sha: string; content?: string }
type Blob = { content: string }
type Release = { id: number }
type GeneratedNotes = { body?: string }
type ApiError = { message?: string }

export type GithubClient = ReturnType<typeof createGithubClient>

export function createGithubClient({
  token,
  repository,
  apiUrl = process.env.GITHUB_API_URL,
  fetchImpl = fetch,
}: {
  token: string | undefined
  repository: string | undefined
  apiUrl?: string
  fetchImpl?: FetchLike
}) {
  if (!token) throw new Error('[internal] GH_TOKEN is not set')
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error(`[internal] bad GITHUB_REPOSITORY "${repository}"`)
  }
  const [owner, repo] = repository.split('/')
  const api = (apiUrl || DEFAULT_API).replace(/\/$/, '')
  const base = `/repos/${owner}/${repo}`

  const call = async <T,>(method: HttpMethod, route: string, body?: unknown): Promise<{ status: number; data: T | null }> => {
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
    return { status: response.status, data: text ? (JSON.parse(text) as T) : null }
  }
  const ok = async <T,>(method: HttpMethod, route: string, body?: unknown): Promise<T> => {
    const { status, data } = await call<T>(method, route, body)
    if (status >= 300 || data === null) {
      const message = (data as ApiError | null)?.message ?? ''
      throw new Error(`[internal] ${method} ${route} → ${status}: ${message}`)
    }
    return data
  }
  const refPath = (name: string) => encodeURIComponent(name).replace(/%2F/g, '/')

  const getRefSha = async (ref: string): Promise<string | null> => {
    const { status, data } = await call<GitRef>('GET', `${base}/git/ref/${refPath(ref)}`)
    return status === 200 && data ? data.object.sha : null
  }
  const getBranchSha = (branch: string) => getRefSha(`heads/${branch}`)
  const createRef = async (ref: string, sha: string): Promise<void> => {
    await ok<GitRef>('POST', `${base}/git/refs`, { ref: `refs/${ref}`, sha })
  }
  const createBranch = (branch: string, sha: string) => createRef(`heads/${branch}`, sha)
  const moveBranch = async (branch: string, sha: string, force: boolean): Promise<void> => {
    await ok<GitRef>('PATCH', `${base}/git/refs/heads/${refPath(branch)}`, { sha, force })
  }
  const findRelease = async (tag: string): Promise<Release | null> => {
    const { status, data } = await call<Release>('GET', `${base}/releases/tags/${encodeURIComponent(tag)}`)
    if (status === 404) return null
    if (status !== 200 || !data) throw new Error(`[internal] GET release ${tag} → ${status}`)
    return data
  }

  return {
    owner,
    repo,
    getBranchSha,
    createBranch,
    moveBranch,
    async setBranch(branch: string, sha: string): Promise<void> {
      if ((await getBranchSha(branch)) === null) await createBranch(branch, sha)
      else await moveBranch(branch, sha, true)
    },
    async ensureTag(tag: string, sha: string): Promise<void> {
      const existing = await getRefSha(`tags/${tag}`)
      if (existing === null) await createRef(`tags/${tag}`, sha)
      else if (existing !== sha) throw new Error(`[internal] tag ${tag} already points at ${existing}, not ${sha}`)
    },
    async hasRelease(tag: string): Promise<boolean> {
      return (await findRelease(tag)) !== null
    },
    async commitFiles({ parentSha, files, message }: { parentSha: string; files: CommitFile[]; message: string }): Promise<string> {
      const parent = await ok<GitObject>('GET', `${base}/git/commits/${parentSha}`)
      const tree = await ok<GitObject>('POST', `${base}/git/trees`, {
        base_tree: parent.tree.sha,
        tree: files.map((file) => ({ path: file.path, mode: '100644', type: 'blob', content: file.content })),
      })
      const commit = await ok<GitObject>('POST', `${base}/git/commits`, { message, tree: tree.sha, parents: [parentSha] })
      return commit.sha
    },
    async readFile(filePath: string, ref: string): Promise<string> {
      const file = await ok<ContentFile>('GET', `${base}/contents/${filePath}?ref=${encodeURIComponent(ref)}`)
      if (file.content) return Buffer.from(file.content, 'base64').toString('utf8')
      const blob = await ok<Blob>('GET', `${base}/git/blobs/${file.sha}`)
      return Buffer.from(blob.content, 'base64').toString('utf8')
    },
    async openPullRequest({ head, base: target, title, body }: { head: string; base: string; title: string; body: string }): Promise<PullRequest> {
      const existing = await ok<PullRequest[]>(
        'GET',
        `${base}/pulls?state=open&base=${encodeURIComponent(target)}&head=${owner}:${encodeURIComponent(head)}`,
      )
      if (existing.length > 0) return existing[0]
      return ok<PullRequest>('POST', `${base}/pulls`, { head, base: target, title, body })
    },
    async addLabels(number: number, labels: string[]): Promise<void> {
      await ok<unknown>('POST', `${base}/issues/${number}/labels`, { labels })
    },
    async ensureLabel(name: string, color: string, description: string): Promise<void> {
      const { status } = await call<unknown>('POST', `${base}/labels`, { name, color, description })
      if (status !== 201 && status !== 422) throw new Error(`[internal] creating label "${name}" → ${status}`)
    },
    async generateNotes({ tag, target, previousTag }: { tag: string; target: string; previousTag: string | null }): Promise<string> {
      const notes = await ok<GeneratedNotes>('POST', `${base}/releases/generate-notes`, {
        tag_name: tag,
        target_commitish: target,
        ...(previousTag ? { previous_tag_name: previousTag } : {}),
      })
      return notes.body ?? ''
    },
    async createRelease({ tag, sha, name, body, makeLatest }: {
      tag: string
      sha: string
      name: string
      body: string
      makeLatest: boolean
    }): Promise<boolean> {
      const payload = { name, body, make_latest: makeLatest ? 'true' : 'false' }
      const existing = await findRelease(tag)
      if (existing) {
        await ok<Release>('PATCH', `${base}/releases/${existing.id}`, payload)
        return false
      }
      await ok<Release>('POST', `${base}/releases`, {
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
