import fs from 'node:fs'
import { join } from 'node:path'

// Test files MUST NOT spawn build.mjs. Every build refreshes dist/agentic — ~55 module fact-sheets
// plus the whole harness tree — and node:test runs test files in parallel, so a build started from
// one file wipes the tree another file is reading and the suite fails with ENOENT on files that
// exist (#5059). The package `test` script builds once, before the runner starts; a test file only
// asserts the artifacts are there and says how to produce them when they are not.
export function requirePackageBuild(packageRoot: string): void {
  const missing = [join('dist', 'index.js'), join('dist', 'agentic')]
    .filter((relative) => !fs.existsSync(join(packageRoot, relative)))
  if (missing.length === 0) return
  throw new Error(
    `[internal] create-mercato-app is not built (missing ${missing.join(', ')}). `
    + 'Run `yarn workspace create-mercato-app test`, which builds first, or '
    + '`yarn workspace create-mercato-app build` before running a single test file.',
  )
}
