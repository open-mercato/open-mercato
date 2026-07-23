import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Regression guards for #4328: a freshly scaffolded app ran `yarn test`,
// `yarn lint`, and `yarn install-skills` against files the template never
// shipped (jest.config.cjs, install-skills.sh) or a command the toolchain
// removed (`next lint`, gone in Next 16). Every template script that names a
// local file must resolve to something the template actually ships.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = path.resolve(__dirname, '..', '..', 'template')

function readTemplateManifest(): { scripts: Record<string, string> } {
  const raw = fs
    .readFileSync(path.join(TEMPLATE_DIR, 'package.json.template'), 'utf8')
    .replace(/\{\{[A-Z_]+\}\}/g, '0.0.0')
  return JSON.parse(raw) as { scripts: Record<string, string> }
}

const scripts = readTemplateManifest().scripts

// Local-file references a script can make: `--config <file>`, `node ./x.mjs`,
// `sh scripts/x.sh`. Package binaries (jest, eslint, next, mercato) are not
// files in the template and are checked separately.
function referencedTemplateFiles(script: string): string[] {
  const files: string[] = []
  const configMatch = script.match(/--config\s+([^\s]+)/)
  if (configMatch && !configMatch[1].startsWith('-')) files.push(configMatch[1])
  for (const match of script.matchAll(/(?:^|\s)(?:node|sh|bash)\s+([^\s]+)/g)) {
    files.push(match[1])
  }
  return files.filter((file) => !file.startsWith('-'))
}

test('every template script that names a local file ships that file', () => {
  const missing: string[] = []
  for (const [name, script] of Object.entries(scripts)) {
    for (const file of referencedTemplateFiles(script)) {
      // .ai/qa assets are installed by the agentic setup step, not the base template.
      if (file.startsWith('.ai/')) continue
      const candidates = [file, `${file}.template`]
      if (!candidates.some((candidate) => fs.existsSync(path.join(TEMPLATE_DIR, candidate)))) {
        missing.push(`${name}: ${file}`)
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    `template scripts reference files the template does not ship: ${missing.join(', ')}`,
  )
})

test('the test script has a jest config to run against', () => {
  assert.match(scripts.test, /jest/)
  assert.ok(
    fs.existsSync(path.join(TEMPLATE_DIR, 'jest.config.cjs')),
    'template must ship jest.config.cjs — `yarn test` fails config-not-found without it',
  )
})

test('lint does not use `next lint` (removed in Next 16) and has a flat config', () => {
  assert.doesNotMatch(
    scripts.lint,
    /next\s+lint/,
    '`next lint` was removed in Next 16 — use the ESLint CLI',
  )
  assert.match(scripts.lint, /eslint/)
  const flatConfigs = ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs']
  assert.ok(
    flatConfigs.some((config) => fs.existsSync(path.join(TEMPLATE_DIR, config))),
    'template must ship an ESLint flat config for the lint script to resolve',
  )
})

test('install-skills degrades gracefully when agentic setup was skipped', () => {
  // scripts/install-skills.sh is installed by the agentic setup step, so the
  // base template must not invoke it directly — the wrapper explains the
  // situation instead of failing with "No such file or directory".
  assert.doesNotMatch(scripts['install-skills'], /install-skills\.sh/)
  const wrapper = path.join(TEMPLATE_DIR, 'scripts', 'install-skills.mjs')
  assert.ok(fs.existsSync(wrapper), 'template must ship the install-skills wrapper')
  const source = fs.readFileSync(wrapper, 'utf8')
  assert.match(source, /install-skills\.sh/)
  assert.match(source, /existsSync/)
})
