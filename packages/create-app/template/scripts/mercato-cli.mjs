// Launcher for `mercato` package scripts. Invoking the bare bin name lets the
// shell resolve it through .cmd shims — under Yarn Berry that is a temp PATH
// wrapper holding an absolute UTF-8 path, which cmd.exe decodes with the OEM
// code page and mangles on non-ASCII checkout paths (MODULE_NOT_FOUND with a
// mojibake path). Importing the CLI's JS entry directly keeps every path in
// process, with no batch files anywhere. Works from the monorepo app workspace
// (entry lives in the repo-root node_modules) and from standalone apps (local
// node_modules) via the ancestor walk.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
let currentDir = path.resolve(scriptsDir, '..')
let entry = null
for (;;) {
  const candidate = path.join(currentDir, 'node_modules', '@open-mercato', 'cli', 'bin', 'mercato')
  if (fs.existsSync(candidate)) {
    entry = candidate
    break
  }
  const parentDir = path.dirname(currentDir)
  if (parentDir === currentDir) break
  currentDir = parentDir
}

if (!entry) {
  console.error('Could not find @open-mercato/cli in any node_modules above this app. Run `yarn install` first.')
  process.exit(1)
}

await import(pathToFileURL(entry).href)
