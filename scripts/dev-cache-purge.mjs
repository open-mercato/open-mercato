import fs from 'node:fs'
import path from 'node:path'

// Greenfield must not inherit stale route manifests, but wiping the whole
// configured Next.js distDir also discards Turbopack's reusable compiler cache
// and makes first /login warmup much slower. Remove manifests/locks that encode
// route shape while preserving `.mercato/next/dev/cache/turbopack`. See issue
// #1950.
export const GREENFIELD_PURGE_TARGETS = Object.freeze([
  Object.freeze(['apps', 'mercato', '.mercato', 'next', 'dev', 'lock']),
  Object.freeze(['apps', 'mercato', '.mercato', 'next', 'dev', 'build-manifest.json']),
  Object.freeze(['apps', 'mercato', '.mercato', 'next', 'dev', 'fallback-build-manifest.json']),
  Object.freeze(['apps', 'mercato', '.mercato', 'next', 'dev', 'prerender-manifest.json']),
  Object.freeze(['apps', 'mercato', '.mercato', 'next', 'dev', 'routes-manifest.json']),
  Object.freeze(['apps', 'mercato', '.mercato', 'next', 'dev', 'server', 'app-paths-manifest.json']),
  Object.freeze(['apps', 'mercato', '.mercato', 'next', 'dev', 'server', 'middleware-build-manifest.js']),
  Object.freeze(['apps', 'mercato', '.mercato', 'next', 'dev', 'server', 'middleware-manifest.json']),
  Object.freeze(['apps', 'mercato', '.mercato', 'next', 'dev', 'server', 'pages-manifest.json']),
  Object.freeze(['apps', 'mercato', '.next']),
])

function isLiveProcess(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

// `next dev` writes `{ pid, appUrl }` into its distDir lock. Purging under a
// live server deletes the manifests it is serving (ENOENT on
// routes-manifest.json) and the lock that would have stopped a second server.
export function findActiveNextDevServer({
  rootDir = process.cwd(),
  fsImpl = fs,
  targets = GREENFIELD_PURGE_TARGETS,
  isProcessAlive = isLiveProcess,
} = {}) {
  const lockSegments = targets.find((segments) => segments[segments.length - 1] === 'lock')
  if (!lockSegments) return null
  let serverInfo
  try {
    serverInfo = JSON.parse(fsImpl.readFileSync(path.join(rootDir, ...lockSegments), 'utf8'))
  } catch {
    return null
  }
  const pid = Number(serverInfo?.pid)
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null
  if (!isProcessAlive(pid)) return null
  return {
    pid,
    appUrl: typeof serverInfo.appUrl === 'string' ? serverInfo.appUrl : null,
    lockPath: lockSegments.join('/'),
  }
}

export function purgeAppBuildCaches({
  rootDir = process.cwd(),
  fsImpl = fs,
  logger = console,
  targets = GREENFIELD_PURGE_TARGETS,
  isProcessAlive = isLiveProcess,
} = {}) {
  const activeServer = findActiveNextDevServer({ rootDir, fsImpl, targets, isProcessAlive })
  if (activeServer) {
    logger.log(`⚠️ [dev:greenfield] another next dev server (pid ${activeServer.pid}${activeServer.appUrl ? `, ${activeServer.appUrl}` : ''}) holds ${activeServer.lockPath}; build caches were left untouched`)
    return { removed: [], activeServer }
  }
  const removed = []
  for (const segments of targets) {
    const target = path.join(rootDir, ...segments)
    if (!fsImpl.existsSync(target)) continue
    fsImpl.rmSync(target, { recursive: true, force: true })
    removed.push(segments.join('/'))
  }
  if (removed.length === 0) {
    logger.log('🧹 [dev:greenfield] no stale Next/Turbopack manifest files to purge')
  } else {
    for (const relPath of removed) {
      logger.log(`🧹 [dev:greenfield] removed ${relPath}`)
    }
  }
  return { removed, activeServer: null }
}
