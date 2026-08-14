import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// @ts-expect-error The standalone template script is plain ESM by design.
import { scanDesignSystem, UI_POLICY_PATTERN_SOURCES } from '../../template/scripts/ds-check.mjs'

function createFixture(files: Record<string, string>, ignore?: object) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-ds-check-'))
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
  }
  if (ignore) fs.writeFileSync(path.join(root, '.ds-check-ignore'), JSON.stringify(ignore))
  return root
}

test('standalone ds checker accepts semantic-token source', () => {
  const root = createFixture({
    'src/modules/example/backend/page.tsx': `export const Page = () => <div className="text-status-danger-fg border-border" />`,
  })
  try {
    assert.deepEqual(scanDesignSystem(root).findings, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('standalone ds checker reports every deterministic violation family', () => {
  const root = createFixture({
    'src/modules/example/backend/page.tsx': `export const Page = () => (
      <table style={{ color: 'red' }} className="text-amber-600 dark:text-amber-500 w-[13px]">
        <tbody><tr><td>Value</td></tr></tbody>
      </table>
    )`,
  })
  try {
    const ruleIds = new Set(scanDesignSystem(root).findings.map((finding) => finding.rule))
    assert.deepEqual(ruleIds, new Set([
      'hardcoded-palette',
      'arbitrary-tailwind',
      'manual-dark-override',
      'inline-style',
      'raw-backend-table',
    ]))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('standalone ds checker honors justified ignores and rejects stale entries', () => {
  const root = createFixture(
    { 'src/modules/example/backend/page.tsx': `export const Page = () => <div className="text-amber-600" />` },
    {
      version: 1,
      entries: [{
        file: 'src/modules/example/backend/page.tsx',
        rule: 'hardcoded-palette',
        match: 'text-amber-600',
        reason: 'Legacy provider badge pending upstream token support.',
      }],
    },
  )
  try {
    assert.equal(scanDesignSystem(root).ok, true)
    fs.writeFileSync(path.join(root, 'src/modules/example/backend/page.tsx'), 'export const Page = () => <div />')
    const stale = scanDesignSystem(root)
    assert.equal(stale.ok, false)
    assert.equal(stale.staleIgnores.length, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('standalone ds checker keeps the shared oracle pattern family aligned', () => {
  const oracle = fs.readFileSync(
    new URL('../../agentic/shared/ai/harness/writable-ast-oracles.mjs', import.meta.url),
    'utf8',
  )
  for (const pattern of Object.values(UI_POLICY_PATTERN_SOURCES)) {
    assert.ok(oracle.includes(`/${pattern}/`), `shared writable oracle is missing ${pattern}`)
  }
})
