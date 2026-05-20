import fs from 'node:fs'
import path from 'node:path'

// Greenfield must not inherit the prior run's compiler state. Wiping the
// configured Next.js distDir (`apps/mercato/.mercato/next`) plus the legacy
// `apps/mercato/.next` location guarantees Turbopack rebuilds the route table
// and middleware manifest from scratch on the next launch. See issue #1950.
export const GREENFIELD_PURGE_TARGETS = Object.freeze([
  Object.freeze(['apps', 'mercato', '.mercato', 'next']),
  Object.freeze(['apps', 'mercato', '.next']),
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
    logger.log('🧹 [dev:greenfield] no stale Next/Turbopack build directories to purge')
  } else {
    for (const relPath of removed) {
      logger.log(`🧹 [dev:greenfield] removed ${relPath}`)
    }
  }
  return { removed }
}
