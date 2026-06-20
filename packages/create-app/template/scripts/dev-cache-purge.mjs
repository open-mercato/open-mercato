import fs from 'node:fs'
import path from 'node:path'

// Greenfield must not inherit stale route manifests, but wiping the whole
// configured Next.js distDir also discards Turbopack's reusable compiler cache
// and makes first /login warmup much slower. Remove manifests/locks that encode
// route shape while preserving `.mercato/next/dev/cache/turbopack`.
export const GREENFIELD_PURGE_TARGETS = Object.freeze([
  Object.freeze(['.mercato', 'next', 'dev', 'lock']),
  Object.freeze(['.mercato', 'next', 'dev', 'build-manifest.json']),
  Object.freeze(['.mercato', 'next', 'dev', 'fallback-build-manifest.json']),
  Object.freeze(['.mercato', 'next', 'dev', 'prerender-manifest.json']),
  Object.freeze(['.mercato', 'next', 'dev', 'routes-manifest.json']),
  Object.freeze(['.mercato', 'next', 'dev', 'server', 'app-paths-manifest.json']),
  Object.freeze(['.mercato', 'next', 'dev', 'server', 'middleware-build-manifest.js']),
  Object.freeze(['.mercato', 'next', 'dev', 'server', 'middleware-manifest.json']),
  Object.freeze(['.mercato', 'next', 'dev', 'server', 'pages-manifest.json']),
  Object.freeze(['.next']),
])

export function purgeAppBuildCaches({
  rootDir = process.cwd(),
  fsImpl = fs,
  logger = console,
  targets = GREENFIELD_PURGE_TARGETS,
} = {}) {
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
  return { removed }
}
