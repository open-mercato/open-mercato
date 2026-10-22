import { execFileSync } from 'node:child_process'
import { assertModulePackageExports, parsePackageNameFromSpec } from './module-package'

export type GithubModuleTarget = {
  packageName: string
  packageSpec: string
  moduleIds: string[]
  locator: string
}

function githubApi(endpoint: string, cwd: string): unknown {
  try {
    return JSON.parse(execFileSync('gh', ['api', endpoint], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 })) as unknown
  } catch {
    throw new Error(`Cannot read GitHub repository metadata at ${endpoint}. Check the locator and access with "gh auth login". No package was installed.`)
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function resolveGithubModuleTarget(input: string, cwd: string, options: { moduleId?: string; enabledModules?: readonly { id: string; from?: string }[] } = {}): GithubModuleTarget {
  let normalized = input.trim()
    .replace(/^(?:(?:git\+)?https?:\/\/github\.com\/)+/i, '')
    .replace(/^github\.com\//i, '')
    .replace(/^github:/i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/^(?:git\+)?ssh:\/\/(?:git@)?github\.com\//i, '')
  const hash = normalized.indexOf('#')
  const separator = hash < 0 ? normalized.lastIndexOf('@') : hash
  const requestedRef = separator < 0 ? undefined : normalized.slice(separator + 1)
  if (requestedRef !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(requestedRef)) {
    throw new Error('Invalid GitHub revision. No package was installed.')
  }
  normalized = (separator < 0 ? normalized : normalized.slice(0, separator)).replace(/\/$/, '').replace(/\.git$/i, '')
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    const login = record(githubApi('user', cwd)).login
    if (typeof login !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(login)) {
      throw new Error('Cannot determine your GitHub account. Use owner/repository or a full GitHub URL.')
    }
    normalized = `${login}/${normalized}`
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new Error('Unsupported GitHub locator. Use github:owner/repository, a repository URL, or owner/repository.')
  }
  const repository = normalized.toLowerCase()
  const ref = requestedRef ?? record(githubApi(`repos/${repository}`, cwd)).default_branch
  if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(ref)) {
    throw new Error('Cannot determine a valid GitHub revision. Use a repository locator with #branch, #tag, or #commit.')
  }
  const sha = record(githubApi(`repos/${repository}/commits/${encodeURIComponent(ref)}`, cwd)).sha
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Cannot resolve ${repository} to an immutable commit. No package was installed.`)
  }
  const contents = record(githubApi(`repos/${repository}/contents/package.json?ref=${sha}`, cwd))
  if (contents.encoding !== 'base64' || typeof contents.content !== 'string') {
    throw new Error(`Repository ${repository} has no readable package.json. No package was installed.`)
  }
  let manifest: Record<string, unknown>
  try {
    manifest = record(JSON.parse(Buffer.from(contents.content, 'base64').toString('utf8')))
  } catch {
    throw new Error(`Repository ${repository} has invalid package.json. No package was installed.`)
  }
  const packageName = manifest.name
  if (typeof packageName !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName) || parsePackageNameFromSpec(packageName) !== packageName) {
    throw new Error(`Repository ${repository} has no valid npm package name. No package was installed.`)
  }
  const tree = record(githubApi(`repos/${repository}/git/trees/${sha}?recursive=1`, cwd))
  if (!Array.isArray(tree.tree) || tree.truncated === true) {
    throw new Error(`Cannot enumerate modules in ${repository}. No package was installed.`)
  }
  const moduleIds = Array.from(new Set(tree.tree.flatMap((entry: unknown) => {
    const filePath = record(entry).path
    const match = typeof filePath === 'string' ? /^src\/modules\/([a-z0-9]+(?:_[a-z0-9]+)*)\/index\.ts$/.exec(filePath) : null
    return match ? [match[1]] : []
  })))
  if (moduleIds.length === 0) throw new Error(`Repository ${repository} has no module descriptors in src/modules/. No package was installed.`)
  const files = tree.tree.flatMap((entry: unknown) => {
    const filePath = record(entry).path
    if (typeof filePath !== 'string') return []
    const compiledPath = /^src\/modules\/.+\.tsx?$/.test(filePath) ? filePath.replace(/^src\//, 'dist/').replace(/\.tsx?$/, '.js') : undefined
    return compiledPath ? [filePath, compiledPath] : [filePath]
  })
  const requiredModuleIds = new Set([
    ...(options.moduleId ? [options.moduleId] : moduleIds.length === 1 ? moduleIds : []),
    ...(options.enabledModules ?? []).filter((entry) => (entry.from ?? '@open-mercato/core') === packageName).map((entry) => entry.id),
  ])
  const sourceCache = new Map<string, string>()
  const readSource = (relativePath: string): string => {
    const cached = sourceCache.get(relativePath)
    if (cached !== undefined) return cached
    const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/')
    const file = record(githubApi(`repos/${repository}/contents/${encodedPath}?ref=${sha}`, cwd))
    if (file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > 2 * 1024 * 1024) {
      throw new Error(`Cannot inspect module source in ${repository} at the selected commit. No package was installed.`)
    }
    const source = Buffer.from(file.content, 'base64').toString('utf8')
    if (Buffer.byteLength(source, 'utf8') > 1024 * 1024) throw new Error(`Module source inspection limit exceeded in ${repository}. No package was installed.`)
    sourceCache.set(relativePath, source)
    return source
  }
  for (const moduleId of requiredModuleIds) {
    if (!moduleIds.includes(moduleId)) throw new Error(`Repository ${repository} no longer provides enabled module "${moduleId}". No package was installed.`)
    assertModulePackageExports(manifest, packageName, moduleId, files, readSource)
  }
  return { packageName, packageSpec: `${packageName}@github:${repository}#${sha}`, moduleIds, locator: `github:${repository}` }
}
