#!/usr/bin/env node
// `yarn install-skills` wrapper.
//
// scripts/install-skills.sh is installed by the agentic setup step, not by the
// base template, so on a scaffold created with `--agents none` (or one whose
// agentic setup was interrupted) the shell script simply is not there. Running
// `sh scripts/install-skills.sh` in that state failed with an opaque
// "No such file or directory". Explain what happened and how to get the skills
// instead of dangling.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const shellScript = path.join(appDir, 'scripts', 'install-skills.sh')

if (!existsSync(shellScript)) {
  console.log('Agent skills are not set up in this app.')
  console.log('')
  console.log('scripts/install-skills.sh is installed by the agentic setup step, which was')
  console.log('skipped (--agents none / --skip-agentic-setup) or did not finish. Re-run the')
  console.log('scaffolder in this directory to add it:')
  console.log('')
  console.log('  npx create-mercato-app@latest . --agents claude-code')
  console.log('')
  process.exit(0)
}

const result = spawnSync('sh', [shellScript], { cwd: appDir, stdio: 'inherit' })
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 0)
