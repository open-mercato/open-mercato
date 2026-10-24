#!/usr/bin/env node
// Verifies the Open Mercato Semgrep rules against their annotated fixture.
//
// Usage (needs Docker):
//   node .ai/skills/om-setup-ci/scripts/verify-semgrep-rules.mjs
//
// templates/scripts/ci/semgrep/open-mercato.fixture.txt is deliberately
// vulnerable TSX. It is stored with a .txt extension so the app's TypeScript
// and ESLint never pick it up; this script copies it to a temporary .tsx file,
// runs the pinned Semgrep image over it, and checks that every
// `// ruleid: <id>` line produces exactly that finding and every
// `// ok: <id>` line produces none. Run it after changing any rule.
// (`semgrep --test` would be the natural tool, but its rule-id matching is
// broken for this layout in the pinned release.)

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOLS } from './setup-ci.mjs'

const semgrepDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'scripts', 'ci', 'semgrep')
const workDir = mkdtempSync(path.join(os.tmpdir(), 'om-semgrep-rules-'))

try {
  copyFileSync(path.join(semgrepDir, 'open-mercato.yml'), path.join(workDir, 'rules.yml'))
  copyFileSync(path.join(semgrepDir, 'open-mercato.fixture.txt'), path.join(workDir, 'fixture.tsx'))
  const output = execFileSync('docker', [
    'run', '--rm', '-v', `${workDir}:/src`, '-w', '/src', TOOLS.SEMGREP_IMAGE,
    'semgrep', 'scan', '--metrics=off', '--quiet', '--json', '--config', 'rules.yml', 'fixture.tsx',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const result = JSON.parse(output)
  const found = new Set(result.results.map((finding) => `${finding.start.line} ${finding.check_id.split('.').pop()}`))
  const problems = []
  readFileSync(path.join(workDir, 'fixture.tsx'), 'utf8').split('\n').forEach((line, index) => {
    const annotation = line.match(/\b(ruleid|ok): (om-[a-z-]+)/)
    if (!annotation) return
    const key = `${index + 2} ${annotation[2]}`
    const expected = annotation[1] === 'ruleid'
    if (expected !== found.has(key)) problems.push(`${expected ? 'missed' : 'false positive'}: ${annotation[2]} at fixture line ${index + 2}`)
    found.delete(key)
  })
  for (const extra of found) problems.push(`unannotated finding: ${extra}`)
  for (const error of result.errors) problems.push(`semgrep error: ${error.message}`)
  if (problems.length > 0) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else {
    console.log(`verify-semgrep-rules: all annotations match (${result.results.length} expected findings).`)
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
