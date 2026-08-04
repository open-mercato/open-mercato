import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = path.join(ROOT, 'scripts', 'check-token-parity.mjs')

const APP_CSS_RELATIVE = 'apps/mercato/src/app/globals.css'
const TEMPLATE_CSS_RELATIVE = 'packages/create-app/template/src/app/globals.css'

function runChecker(rootDir) {
  const args = rootDir ? [SCRIPT, '--root', rootDir] : [SCRIPT]
  return spawnSync(process.execPath, args, { encoding: 'utf8' })
}

function buildCss({ rootTokens, darkTokens }) {
  const block = (selector, tokens) =>
    `${selector} {\n${Object.entries(tokens).map(([name, value]) => `  --${name}: ${value};`).join('\n')}\n}\n`
  return `@source "../../../../packages";\n\n${block(':root', rootTokens)}\n${block('.dark', darkTokens)}`
}

const PASSING_ROOT_TOKENS = {
  background: '#ffffff',
  foreground: '#101828',
  card: '#ffffff',
  'card-foreground': '#101828',
}

const PASSING_DARK_TOKENS = {
  background: '#101828',
  foreground: '#ffffff',
  card: '#101828',
  'card-foreground': '#ffffff',
}

function makeFixture({ rootTokens = PASSING_ROOT_TOKENS, darkTokens = PASSING_DARK_TOKENS, templateCss } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-parity-'))
  const appCss = buildCss({ rootTokens, darkTokens })
  const appCssPath = path.join(dir, APP_CSS_RELATIVE)
  const templateCssPath = path.join(dir, TEMPLATE_CSS_RELATIVE)
  fs.mkdirSync(path.dirname(appCssPath), { recursive: true })
  fs.mkdirSync(path.dirname(templateCssPath), { recursive: true })
  fs.writeFileSync(appCssPath, appCss)
  fs.writeFileSync(templateCssPath, templateCss ?? appCss.replace('"../../../../packages"', '"../../packages"'))
  return dir
}

function withFixture(options, assertions) {
  const fixture = makeFixture(options)
  try {
    assertions(runChecker(fixture))
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
}

test('the repository globals.css passes parity, template sync and contrast', () => {
  const result = runChecker()
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /create-app template copy in sync/)
  assert.match(result.stdout, /contrast checked on \d+ theme×pair combinations/)
})

test('fails when a :root token has no .dark override and is not allowlisted', () => {
  withFixture(
    { rootTokens: { ...PASSING_ROOT_TOKENS, sidebar: '#fafafa' } },
    (result) => {
      assert.equal(result.status, 1)
      assert.match(result.stderr, /--sidebar defined in :root has no \.dark override/)
    },
  )
})

test('fails when a .dark token has no :root base', () => {
  withFixture(
    { darkTokens: { ...PASSING_DARK_TOKENS, sidebar: '#1a1a1a' } },
    (result) => {
      assert.equal(result.status, 1)
      assert.match(result.stderr, /--sidebar defined in \.dark has no :root base/)
    },
  )
})

test('fails when the create-app template copy drifts from the app globals.css', () => {
  withFixture(
    { templateCss: buildCss({ rootTokens: { ...PASSING_ROOT_TOKENS, card: '#eeeeee' }, darkTokens: PASSING_DARK_TOKENS }) },
    (result) => {
      assert.equal(result.status, 1)
      assert.match(result.stderr, /has drifted from the app globals\.css/)
    },
  )
})

test('fails when a token pair drops below the WCAG text threshold in light theme', () => {
  withFixture(
    { rootTokens: { ...PASSING_ROOT_TOKENS, 'card-foreground': '#dddddd' } },
    (result) => {
      assert.equal(result.status, 1)
      assert.match(result.stderr, /\[light\] --card-foreground on --card: contrast \d+\.\d+ < 4\.5/)
    },
  )
})

test('fails when a token pair drops below the WCAG text threshold in dark theme only', () => {
  withFixture(
    { darkTokens: { ...PASSING_DARK_TOKENS, 'card-foreground': '#333333' } },
    (result) => {
      assert.equal(result.status, 1)
      assert.match(result.stderr, /\[dark\] --card-foreground on --card: contrast \d+\.\d+ < 4\.5/)
      assert.doesNotMatch(result.stderr, /\[light\] --card-foreground/)
    },
  )
})
