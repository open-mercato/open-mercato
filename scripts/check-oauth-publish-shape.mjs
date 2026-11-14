#!/usr/bin/env node
/**
 * Guard: every import path the OAuth2 grant core publishes (App Spec §10.1,
 * `.ai/specs/2026-10-01-oauth2-grant-lifecycle-core.md` → Publish-shape check)
 * resolves through Node `exports` to a file in the BUILT `dist` of
 * `@open-mercato/shared` or `@open-mercato/core`.
 *
 * Resolution uses Node's own ESM resolver, not Jest's module mapper (which
 * resolves directory indexes that Node never does), and every resolved file is
 * `stat`ed, because resolving a specifier does not prove that its target exists.
 * Each resolved file must also have its source in the package's `src`, so a
 * `dist` file left over from an earlier build after a rename or delete fails.
 *
 * Requires `yarn build:packages` first; a missing dist is a failure rather than
 * a skip, so the gate cannot report green without having inspected anything.
 *
 * Usage:
 *   node scripts/check-oauth-publish-shape.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LOG_PREFIX = '[oauth-publish-shape]'

const OAUTH_FILES = [
  'token-endpoint',
  'pkce',
  'authorization',
  'redirect',
  'resource-challenge',
  'descriptor',
  'grant-service',
  'health',
]

const PUBLISHED_IMPORT_PATHS = [
  '@open-mercato/shared/lib/db/advisoryLock',
  ...OAUTH_FILES.map((file) => `@open-mercato/core/modules/integrations/lib/oauth/${file}`),
  '@open-mercato/core/modules/integrations/lib/oauth/testing/fakeAuthorizationServer',
  '@open-mercato/core/modules/integrations/lib/credentials-service',
  '@open-mercato/core/modules/integrations/lib/log-service',
  '@open-mercato/core/modules/communication_channels/lib/oauth-state',
]

function packageNameOf(specifier) {
  const [scope, name] = specifier.split('/')
  return `${scope}/${name}`
}

function resolveToPath(specifier) {
  const url = import.meta.resolve(specifier)
  if (!url.startsWith('file:')) throw new Error(`resolved to a non-file URL: ${url}`)
  return fileURLToPath(url)
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs']

function existingFileRealPath(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) return null
    return fs.realpathSync(filePath)
  } catch {
    return null
  }
}

function resolveDistDir(packageName) {
  const entryPath = resolveToPath(packageName)
  if (path.basename(path.dirname(entryPath)) !== 'dist') throw new Error(`root export does not point into dist: ${entryPath}`)
  const realEntryPath = existingFileRealPath(entryPath)
  if (!realEntryPath) throw new Error(`no built entry at ${entryPath}; run yarn build:packages`)
  return path.dirname(realEntryPath)
}

export function sourceCandidatesFor(distFile, distDir) {
  const relative = path.relative(distDir, distFile).replace(/\.m?js$/, '')
  const sourceDir = path.join(path.dirname(distDir), 'src')
  return SOURCE_EXTENSIONS.map((extension) => path.join(sourceDir, `${relative}${extension}`))
}

export function checkResolvedFile(resolvedPath, distDir) {
  const realPath = existingFileRealPath(resolvedPath)
  if (!realPath) return `resolves to a missing file: ${resolvedPath}`
  if (!realPath.startsWith(`${distDir}${path.sep}`)) return `resolves outside the built dist (${distDir}): ${realPath}`
  if (!sourceCandidatesFor(realPath, distDir).some((candidate) => existingFileRealPath(candidate) !== null)) {
    return `resolves to a stale dist file with no source in src (run yarn build:packages): ${realPath}`
  }
  return null
}

function checkImportPath(specifier, distDirs) {
  const distDir = distDirs.get(packageNameOf(specifier))
  if (distDir instanceof Error) return `package not built: ${distDir.message}`
  let resolvedPath
  try {
    resolvedPath = resolveToPath(specifier)
  } catch (error) {
    return `does not resolve: ${error instanceof Error ? error.message : String(error)}`
  }
  return checkResolvedFile(resolvedPath, distDir)
}

function main() {
  const distDirs = new Map()
  for (const packageName of new Set(PUBLISHED_IMPORT_PATHS.map(packageNameOf))) {
    try {
      distDirs.set(packageName, resolveDistDir(packageName))
    } catch (error) {
      distDirs.set(packageName, error instanceof Error ? error : new Error(String(error)))
    }
  }

  const broken = []
  for (const specifier of PUBLISHED_IMPORT_PATHS) {
    const problem = checkImportPath(specifier, distDirs)
    if (problem) broken.push({ specifier, problem })
  }

  if (broken.length > 0) {
    console.error(`${LOG_PREFIX} ${broken.length} of ${PUBLISHED_IMPORT_PATHS.length} published import path(s) are broken:`)
    for (const { specifier, problem } of broken) console.error(`  - ${specifier}: ${problem}`)
    process.exit(1)
  }
  console.log(`${LOG_PREFIX} all ${PUBLISHED_IMPORT_PATHS.length} published import paths resolve to built files.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
