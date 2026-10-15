import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateShared } from '../setup/tools/shared.js'
import { generateCodex } from '../setup/tools/codex.js'

type HarnessCase = { id: string; context: { required: string[]; allowedExtra?: string[]; forbidden: string[] }; maxInitialContextBytes: number; maxTotalContextBytes: number }
const packageRoot = new URL('../../', import.meta.url)
const read = (file: string): string => fs.readFileSync(new URL(file, packageRoot), 'utf8')
const cases = JSON.parse(read('agentic/shared/ai/harness/cases.json')) as HarnessCase[]
const initialCaps: Record<string, number> = { 'OMH-007': 65536, 'OMH-022': 65536, 'OMH-030': 49152, 'OMH-057': 40960, 'OMH-064': 65536 }

test('compatibility cases fit their exact required files without broad read or initial-budget increases', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-compat-context-'))
  try {
    const config = { targetDir: fixture, projectName: 'compatibility-context-budget' }
    generateShared(config)
    generateCodex(config)
    fs.mkdirSync(path.join(fixture, '.ai/guides/upstream'), { recursive: true })
    fs.copyFileSync(new URL('../../../../BACKWARD_COMPATIBILITY.md', import.meta.url), path.join(fixture, '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md'))
    for (const [id, initialCap] of Object.entries(initialCaps)) {
      const record = cases.find(record => record.id === id)
      assert.ok(record)
      const paths = [...new Set([...record.context.required, ...(record.context.allowedExtra ?? []).filter(file => !/[?*]/.test(file))])]
      const bytes = paths.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
      assert.ok(bytes > 98304, `${id} demonstrates the stale original total cap`)
      assert.ok(bytes <= record.maxTotalContextBytes, `${id}: ${bytes} required bytes exceed ${record.maxTotalContextBytes}`)
      assert.ok(record.maxTotalContextBytes - bytes <= 4096, `${id} has excessive unused total budget`)
      assert.equal(record.maxInitialContextBytes, initialCap)
      assert.ok(record.context.forbidden.includes('.env*'))
      assert.ok(record.context.forbidden.includes('.git/**'))
    }
    assert.ok(fs.statSync(path.join(fixture, 'AGENTS.md')).size <= 12288)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})
