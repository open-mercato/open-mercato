import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyStarterPreset } from './apply-starter-preset.js'
import { generateCodex } from '../setup/tools/codex.js'
import { enforceRootInstructionBudget, generateShared, injectModuleGuides, readEnabledModuleIds, STANDALONE_ROOT_TARGET_BYTES } from '../setup/tools/shared.js'

const readAgentic = (relativePath: string) => fs.readFileSync(new URL(`../../agentic/${relativePath}`, import.meta.url), 'utf8')

test('existing generated-export drift repairs authored source without inventing worker or cache contracts', () => {
  const skill = readAgentic('shared/ai/skills/om-troubleshooter/SKILL.md')
  const repair = skill.split('\n').find((line) => line.startsWith('Existing generated app-module export drift'))
  assert.ok(repair)
  assert.match(repair, /`module-data` \+ `architecture`, contracts\/BC, named signature/)
  assert.match(repair, /Repair authored source\+regenerate/)
  assert.match(repair, /scaffold\/cache\/queue procedures require authoring those contracts/)
})

test('bootstrap repair preserves compatibility, read-only outputs, exact source lookup, and every runtime check', () => {
  const skill = readAgentic('shared/ai/skills/om-troubleshooter/SKILL.md')
  assert.match(skill, /read `\.ai\/guides\/upstream\/BACKWARD_COMPATIBILITY\.md` when repairing a seeded export or public seam; preserve that seam/)
  assert.match(skill, /Use `om-framework-context` only when one named installed implementation\/export remains unresolved/)
  assert.match(skill, /Never patch generated\/package output/)
  const diagnosis = readAgentic('shared/ai/skills/om-troubleshooter/references/diagnosis-map.md')
  assert.match(diagnosis, /Each bootstrap's registry\/DI init, generated imports, chunk-global identity/)
  const oracles = readAgentic('shared/ai/skills/om-troubleshooter/references/regression-oracles.md')
  assert.match(oracles, /same registry\/service behavior in browser\/server, CLI, worker, and queue from packed install/)
  assert.match(readAgentic('guides/architecture.md'), /Validate browser, API, CLI, worker, and queue bootstrap paths when a registry\/global\/service is consumed by more than one runtime/)
})

test('bootstrap repair declares its mandatory procedure closure within a bounded total ceiling', () => {
  const cases = JSON.parse(readAgentic('shared/ai/harness/cases.json')) as Array<{
    id: string
    context: { required: string[] }
    requiredSkills: string[]
    maxContextFiles: number
    maxInitialContextBytes: number
    maxTotalContextBytes: number
  }>
  const record = cases.find(record => record.id === 'OMH-064')
  assert.ok(record)
  const required = [
    'AGENTS.md',
    '.ai/guides/testing-debugging.md',
    '.ai/guides/contracts.md',
    '.ai/guides/architecture.md',
    '.ai/skills/om-troubleshooter/SKILL.md',
    '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md',
    '.ai/skills/om-framework-context/SKILL.md',
    '.ai/guides/framework-contracts.md',
    '.ai/skills/om-troubleshooter/references/diagnosis-map.md',
    '.ai/skills/om-troubleshooter/references/regression-oracles.md',
    '.ai/skills/om-framework-context/references/resolver-procedure.md',
  ]
  assert.deepEqual([...record.requiredSkills].sort(), ['om-framework-context', 'om-troubleshooter'])
  assert.equal(record.maxContextFiles, 8)
  assert.equal(record.maxInitialContextBytes, 65_536)
  for (const preset of ['classic', 'crm', 'empty', 'wms']) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-context-'))
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
      const initial = required.filter(file => !file.includes('/references/') && !file.startsWith('.ai/guides/upstream/'))
      assert.equal(initial.length, 7)
      const initialBytes = initial.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
      assert.ok(initialBytes <= record.maxInitialContextBytes)
      const bytes = required.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
      const rootBytes = fs.statSync(path.join(fixture, 'AGENTS.md')).size
      assert.ok(bytes <= record.maxTotalContextBytes, `${preset} mandatory closure uses ${bytes}/${record.maxTotalContextBytes} bytes`)
      assert.ok(record.maxTotalContextBytes - bytes >= 1_024)
      assert.ok(record.maxTotalContextBytes - bytes <= 4_096)
      assert.ok(bytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES <= record.maxTotalContextBytes - 1_024)
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true })
    }
  }
  assert.deepEqual([...record.context.required].sort(), [...required].sort())
  assert.equal(record.maxTotalContextBytes, 139_264)
})
