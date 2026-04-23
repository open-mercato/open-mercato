import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Atomic write: write to a temp sibling file, then rename over the target.
// rename() is atomic on POSIX (and replaces the destination on Windows since Node 16),
// so concurrent readers never observe a truncated file — they see either the old
// or the new contents in full.
export function atomicWriteFileSync(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`
  try {
    writeFileSync(tmpPath, data)
    renameSync(tmpPath, filePath)
  } catch (error) {
    try {
      unlinkSync(tmpPath)
    } catch {}
    throw error
  }
}

// Decide whether `import './foo'` should be rewritten to `./foo.js` (a sibling
// file) or `./foo/index.js` (a directory with barrel export). With `write: false`
// the plugin iterates outputs in memory — nothing is on disk yet — so
// `existsSync` would wrongly report every directory as missing. Consult the set
// of paths that THIS build is about to emit first; fall back to `existsSync`
// only for pre-existing files carried over from an earlier build.
function resolveRelativeImport(fileDir, importPath, knownOutputPaths) {
  const directoryIndexPath = join(fileDir, importPath, 'index.js')
  if (knownOutputPaths && knownOutputPaths.has(directoryIndexPath)) {
    return `${importPath}/index.js`
  }
  const resolvedPath = join(fileDir, importPath)
  if (existsSync(resolvedPath) && existsSync(directoryIndexPath)) {
    return `${importPath}/index.js`
  }
  return `${importPath}.js`
}

export function rewriteRelativeImports(content, fileDir, options = {}) {
  const {
    skipExtensions = ['.js', '.json'],
    skipTemplateLiterals = false,
    resolveGeneratedImport = null,
    knownOutputPaths = null,
  } = options

  let output = content

  if (typeof resolveGeneratedImport === 'function') {
    output = output.replace(
      /from\s+["']#generated\/([^"']+)["']/g,
      (match, importPath) => {
        const rewritten = resolveGeneratedImport(importPath, fileDir)
        return rewritten ? `from "${rewritten}"` : match
      },
    )
    output = output.replace(
      /import\s*\(\s*["']#generated\/([^"']+)["']\s*\)/g,
      (match, importPath) => {
        const rewritten = resolveGeneratedImport(importPath, fileDir)
        return rewritten ? `import("${rewritten}")` : match
      },
    )
  }

  const shouldSkip = (importPath) => {
    if (skipExtensions.some((ext) => importPath.endsWith(ext))) return true
    if (skipTemplateLiterals && importPath.includes('${')) return true
    return false
  }

  output = output.replace(/from\s+["'](\.[^"']+)["']/g, (match, importPath) => {
    if (shouldSkip(importPath)) return match
    return `from "${resolveRelativeImport(fileDir, importPath, knownOutputPaths)}"`
  })

  output = output.replace(/import\s*\(\s*["'](\.[^"']+)["']\s*\)/g, (match, importPath) => {
    if (shouldSkip(importPath)) return match
    return `import("${resolveRelativeImport(fileDir, importPath, knownOutputPaths)}")`
  })

  output = output.replace(/import\s+["'](\.[^"']+)["'];/g, (match, importPath) => {
    if (shouldSkip(importPath)) return match
    return `import "${resolveRelativeImport(fileDir, importPath, knownOutputPaths)}";`
  })

  return output
}

// esbuild plugin that:
//   1) Forces `write: false` so esbuild does not touch the filesystem itself.
//   2) Rewrites relative imports in every emitted .js file to add .js extensions
//      (required for native Node ESM resolution).
//   3) Writes every output file atomically via temp+rename.
//
// Together this eliminates the read-modify-write race that the previous
// glob-based implementation had: it no longer re-reads files that may be in
// the process of being written by another builder (parallel turbo worker,
// watcher, cache restore), and atomic rename guarantees readers see only
// complete contents.
export function createAtomicWritePlugin(rewriteOptions = {}) {
  return {
    name: 'atomic-write-with-js-extensions',
    setup(build) {
      build.initialOptions.write = false

      build.onEnd((result) => {
        if (result.errors && result.errors.length > 0) return
        const outputs = result.outputFiles
        if (!outputs || outputs.length === 0) return

        // Precompute the full set of paths this build will emit so the rewriter
        // can resolve `./foo` → `./foo/index.js` for directory-with-barrel imports
        // without querying the filesystem (nothing is on disk yet with write: false).
        const knownOutputPaths = new Set(outputs.map((file) => file.path))
        const effectiveOptions = { ...rewriteOptions, knownOutputPaths }

        for (const file of outputs) {
          let data = file.contents
          if (file.path.endsWith('.js')) {
            const text = Buffer.from(file.contents).toString('utf-8')
            const rewritten = rewriteRelativeImports(text, dirname(file.path), effectiveOptions)
            if (rewritten !== text) {
              data = Buffer.from(rewritten, 'utf-8')
            }
          }
          atomicWriteFileSync(file.path, data)
        }
      })
    },
  }
}
