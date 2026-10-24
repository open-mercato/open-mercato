import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyStarterPreset } from './apply-starter-preset.js'
import { generateCodex } from '../setup/tools/codex.js'
import { enforceRootInstructionBudget, generateShared, injectModuleGuides, readEnabledModuleIds, STANDALONE_ROOT_TARGET_BYTES } from '../setup/tools/shared.js'

type RepairCase = {
  id: string
  context: { required: string[] }
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
}

const required = [
  'AGENTS.md',
  '.ai/guides/contracts.md',
  '.ai/guides/testing-debugging.md',
  '.ai/skills/om-troubleshooter/SKILL.md',
  '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md',
  '.ai/skills/om-troubleshooter/references/diagnosis-map.md',
  '.ai/skills/om-troubleshooter/references/regression-oracles.md',
]

test('query-scope repair fits mandatory diagnosis and compatibility plus the before-test verification procedure', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as RepairCase[]
  const record = cases.find(record => record.id === 'OMH-057')
  assert.ok(record)
  for (const preset of ['classic', 'crm', 'empty', 'wms']) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-query-scope-context-'))
    try {
      fs.mkdirSync(path.join(fixture, 'src'))
      fs.mkdirSync(path.join(fixture, '.mercato'))
      fs.copyFileSync(new URL('../../template/src/modules.ts', import.meta.url), path.join(fixture, 'src/modules.ts'))
      applyStarterPreset(preset, fixture)
      const modules = readEnabledModuleIds(path.join(fixture, 'src/modules.ts')).filter(moduleId => moduleId !== 'ratelimit_probe')
      const config = { targetDir: fixture, projectName: preset }
      generateShared(config)
      injectModuleGuides(path.join(fixture, 'AGENTS.md'), modules)
      generateCodex(config)
      enforceRootInstructionBudget(path.join(fixture, 'AGENTS.md'), modules)
      fs.mkdirSync(path.join(fixture, '.ai/guides/upstream'), { recursive: true })
      fs.copyFileSync(new URL('../../../../BACKWARD_COMPATIBILITY.md', import.meta.url), path.join(fixture, '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md'))
      const bytes = (files: string[]) => files.reduce((sum, file) => sum + fs.statSync(path.join(fixture, file)).size, 0)
      const mandatoryBytes = bytes(required)
      assert.ok(mandatoryBytes <= record.maxTotalContextBytes, `${preset} mandatory closure uses ${mandatoryBytes}/${record.maxTotalContextBytes} bytes`)
      const writingBytes = mandatoryBytes + bytes(['.ai/skills/om-module-scaffold/references/verification.md'])
      const worstRootBytes = writingBytes - bytes(['AGENTS.md']) + STANDALONE_ROOT_TARGET_BYTES
      assert.ok(record.maxTotalContextBytes - worstRootBytes >= 2_048)
      assert.ok(record.maxTotalContextBytes - worstRootBytes <= 4_096)
      const initial = required.filter(file => !file.includes('/references/') && !file.startsWith('.ai/guides/upstream/'))
      assert.equal(initial.length, 4)
      assert.ok(bytes(initial) <= record.maxInitialContextBytes)
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true })
    }
  }
  assert.deepEqual([...record.context.required].sort(), [...required].sort())
  assert.equal(record.maxContextFiles, 5)
  assert.equal(record.maxInitialContextBytes, 40_960)
  assert.equal(record.maxTotalContextBytes, 122_880)
})
