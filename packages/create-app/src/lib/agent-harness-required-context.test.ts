import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateCodex } from '../setup/tools/codex.js'
import { enforceRootInstructionBudget, generateShared, injectModuleGuides, readEnabledModuleIds, STANDALONE_ROOT_TARGET_BYTES } from '../setup/tools/shared.js'

type HarnessCase = {
  id: string
  context: { required: string[]; allowedExtra?: string[] }
  requiredSkills: string[]
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
}

test('DataTable extension context includes both mandatory skills within its measured initial ceiling', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as HarnessCase[]
  const record = cases.find(record => record.id === 'OMH-027')
  assert.ok(record)
  const required = [
    'AGENTS.md',
    '.ai/guides/extensions.md',
    '.ai/guides/backend-ui.md',
    '.ai/skills/om-system-extension/SKILL.md',
    '.ai/skills/om-backend-ui-design/SKILL.md',
  ]
  assert.deepEqual([...record.context.required].sort(), [...required].sort())
  for (const skill of record.requiredSkills) {
    assert.ok(record.context.required.includes(`.ai/skills/${skill}/SKILL.md`))
  }
  assert.equal(record.maxContextFiles, 5)
  assert.equal(record.maxInitialContextBytes, 45_056)
  assert.equal(record.maxTotalContextBytes, 98_304)
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-required-context-'))
  try {
    const config = { targetDir: fixture, projectName: 'required-context-fixture' }
    generateShared(config)
    generateCodex(config)
    const bytes = required.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
    const rootBytes = fs.statSync(path.join(fixture, 'AGENTS.md')).size
    assert.ok(bytes <= record.maxInitialContextBytes)
    assert.ok(record.maxInitialContextBytes - bytes <= 8_192)
    assert.ok(bytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES <= record.maxInitialContextBytes)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

test('CLI and provider guidance changes preserve existing business-slice initial context ceilings', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as HarnessCase[]
  const affected = ['OMH-082', 'OMH-097', 'OMH-101', 'OMH-103', 'OMH-105', 'OMH-117', 'OMH-118', 'OMH-124', 'OMH-128', 'OMH-130', 'OMH-141', 'OMH-153', 'OMH-155', 'OMH-169']
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-business-context-'))
  try {
    const config = { targetDir: fixture, projectName: 'classic' }
    fs.mkdirSync(path.join(fixture, 'src'))
    fs.copyFileSync(new URL('../../template/src/modules.ts', import.meta.url), path.join(fixture, 'src/modules.ts'))
    const modules = readEnabledModuleIds(path.join(fixture, 'src/modules.ts')).filter(moduleId => moduleId !== 'ratelimit_probe')
    generateShared(config)
    injectModuleGuides(path.join(fixture, 'AGENTS.md'), modules)
    generateCodex(config)
    enforceRootInstructionBudget(path.join(fixture, 'AGENTS.md'), modules)
    const violations: string[] = []
    for (const id of affected) {
      const record = cases.find(record => record.id === id)
      assert.ok(record)
      const declared = [...new Set([...record.context.required, ...(record.context.allowedExtra ?? [])])]
      const initial = declared.filter(file => !file.includes('/references/')
        && !['.ai/framework-context/', '.ai/guides/modules/', '.ai/guides/reference-modules/', '.ai/guides/upstream/', '.agents/skills/'].some(prefix => file.startsWith(prefix)))
      const bytes = initial.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
      if (bytes > record.maxInitialContextBytes) violations.push(`${id}: ${bytes}/${record.maxInitialContextBytes}`)
    }
    assert.deepEqual(violations, [])
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

test('component replacement preserves its mandatory procedure closure within a bounded total ceiling', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as HarnessCase[]
  const record = cases.find(record => record.id === 'OMH-030')
  assert.ok(record)
  const required = [
    'AGENTS.md',
    '.ai/guides/extensions.md',
    '.ai/guides/backend-ui.md',
    '.ai/skills/om-system-extension/SKILL.md',
    '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md',
    '.ai/skills/om-backend-ui-design/SKILL.md',
    '.ai/skills/om-system-extension/references/mechanism-selector.md',
    '.ai/skills/om-system-extension/references/extension-branches.md',
    '.ai/skills/om-system-extension/references/verification.md',
    '.ai/skills/om-backend-ui-design/references/quality-states.md',
  ]
  assert.deepEqual([...record.context.required].sort(), [...required].sort())
  assert.deepEqual([...record.requiredSkills].sort(), ['om-backend-ui-design', 'om-system-extension'])
  assert.deepEqual(record.context.allowedExtra, ['.ai/skills/om-framework-context/SKILL.md'])
  assert.equal(record.maxContextFiles, 6)
  assert.equal(record.maxInitialContextBytes, 49_152)
  assert.equal(record.maxTotalContextBytes, 141_312)
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-replacement-context-'))
  try {
    const config = { targetDir: fixture, projectName: 'replacement-context-fixture' }
    generateShared(config)
    generateCodex(config)
    const upstream = path.join(fixture, '.ai/guides/upstream')
    fs.mkdirSync(upstream, { recursive: true })
    fs.copyFileSync(new URL('../../../../BACKWARD_COMPATIBILITY.md', import.meta.url), path.join(upstream, 'BACKWARD_COMPATIBILITY.md'))
    const declared = [...required, ...(record.context.allowedExtra ?? [])]
    const bytes = declared.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
    const rootBytes = fs.statSync(path.join(fixture, 'AGENTS.md')).size
    assert.ok(record.maxTotalContextBytes - bytes >= 1_024)
    assert.ok(record.maxTotalContextBytes - bytes <= 4_096)
    assert.ok(bytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES <= record.maxTotalContextBytes - 1_024)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})
