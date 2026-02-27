/**
 * Template sync checker/fixer for create-app scaffold parity.
 *
 * Keeps `packages/create-app/template/src/{app,modules}` aligned with
 * `apps/mercato/src/{app,modules}` for shared layout/routes/module scaffolding.
 *
 * Usage:
 *   tsx scripts/template-sync.ts          # check only (exit 1 on drift)
 *   tsx scripts/template-sync.ts --fix    # sync template from app source
 *   tsx scripts/template-sync.ts --ask    # when drift is found, prompt to sync
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { globSync } from 'glob'

const __filename_ = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename_), '..')

const APP_SRC_ROOT = path.join(ROOT, 'apps', 'mercato', 'src')
const TEMPLATE_SRC_ROOT = path.join(ROOT, 'packages', 'create-app', 'template', 'src')
const SYNC_FOLDERS = ['app', 'modules'] as const
const MAX_DIFFS_TO_SHOW = 20

const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

type DriftKind = 'missing_in_template' | 'content_mismatch'

type Drift = {
  kind: DriftKind
  sourceFile: string
  templateFile: string
  rel: string
}

function relFromRoot(absPath: string): string {
  return path.relative(ROOT, absPath).split(path.sep).join('/')
}

function collectSourceFiles(): string[] {
  const files = SYNC_FOLDERS.flatMap((folder) =>
    globSync(`${folder}/**/*`, {
      cwd: APP_SRC_ROOT,
      absolute: true,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.DS_Store'],
    }),
  )
  return files.sort()
}

function computeDrift(): Drift[] {
  const sourceFiles = collectSourceFiles()
  const drifts: Drift[] = []

  for (const sourceFile of sourceFiles) {
    const rel = path.relative(APP_SRC_ROOT, sourceFile)
    const templateFile = path.join(TEMPLATE_SRC_ROOT, rel)
    if (!fs.existsSync(templateFile)) {
      drifts.push({
        kind: 'missing_in_template',
        sourceFile,
        templateFile,
        rel,
      })
      continue
    }

    const source = fs.readFileSync(sourceFile)
    const template = fs.readFileSync(templateFile)
    if (!source.equals(template)) {
      drifts.push({
        kind: 'content_mismatch',
        sourceFile,
        templateFile,
        rel,
      })
    }
  }

  return drifts
}

function printDrift(drifts: Drift[]): void {
  if (drifts.length === 0) {
    console.log(green('Template sync check passed: app and template are in sync for src/app and src/modules.'))
    return
  }

  const missing = drifts.filter((d) => d.kind === 'missing_in_template').length
  const changed = drifts.filter((d) => d.kind === 'content_mismatch').length

  console.log(red(`Template drift detected: ${drifts.length} file(s)`))
  console.log(dim(`  missing in template: ${missing}`))
  console.log(dim(`  content mismatch:    ${changed}`))

  const preview = drifts.slice(0, MAX_DIFFS_TO_SHOW)
  for (const drift of preview) {
    const marker = drift.kind === 'missing_in_template' ? yellow('MISSING') : yellow('DIFF')
    console.log(`  - [${marker}] ${drift.rel}`)
  }
  if (drifts.length > preview.length) {
    console.log(dim(`  ... and ${drifts.length - preview.length} more`))
  }
}

function applySync(drifts: Drift[]): number {
  let updated = 0
  for (const drift of drifts) {
    fs.mkdirSync(path.dirname(drift.templateFile), { recursive: true })
    fs.copyFileSync(drift.sourceFile, drift.templateFile)
    updated++
  }
  return updated
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const fix = args.has('--fix')
  const ask = args.has('--ask')
  const checkOnly = !fix && !ask

  if (!fs.existsSync(APP_SRC_ROOT) || !fs.existsSync(TEMPLATE_SRC_ROOT)) {
    console.log(red('Required source/template paths were not found.'))
    process.exit(2)
  }

  console.log(cyan('[template-sync] Checking src/app and src/modules parity...'))
  const drifts = computeDrift()
  printDrift(drifts)

  if (drifts.length === 0) {
    process.exit(0)
  }

  if (checkOnly) {
    console.log(dim('Run `yarn template:sync --fix` to sync template from app source.'))
    process.exit(1)
  }

  if (ask) {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
    if (!interactive) {
      console.log(yellow('Cannot prompt in non-interactive mode. Re-run with --fix or in a TTY with --ask.'))
      process.exit(1)
    }
    const shouldSync = await promptYesNo('Template drift found. Sync template files now?')
    if (!shouldSync) {
      console.log(yellow('Template sync skipped by user.'))
      process.exit(1)
    }
  }

  const updated = applySync(drifts)
  console.log(green(`Synced ${updated} file(s) into packages/create-app/template/src.`))
  process.exit(0)
}

void main()
