import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createResolver } from '../../../cli/src/lib/resolver.js'
import { discoverPackageModuleSources } from '../../../cli/src/lib/generators/module-facts-discovery.js'
import { applyStarterPreset } from './apply-starter-preset.js'
import { generateCodex } from '../setup/tools/codex.js'
import { enforceRootInstructionBudget, generateShared, injectModuleGuides, readEnabledModuleIds, STANDALONE_ROOT_TARGET_BYTES } from '../setup/tools/shared.js'

test('production roots keep their capacity bound after enforcement across all presets and long app names', (context) => {
  const available = new Set(discoverPackageModuleSources(createResolver(fileURLToPath(new URL('../../../../', import.meta.url)))).map(source => source.moduleId))
  for (const preset of ['classic', 'crm', 'empty', 'wms']) {
    for (const projectName of [preset, 'app-' + 'a'.repeat(196)]) {
      const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-production-root-'))
      try {
        fs.mkdirSync(path.join(fixture, 'src'))
        fs.mkdirSync(path.join(fixture, '.mercato'))
        fs.copyFileSync(new URL('../../template/src/modules.ts', import.meta.url), path.join(fixture, 'src/modules.ts'))
        applyStarterPreset(preset, fixture)
        const modules = readEnabledModuleIds(path.join(fixture, 'src/modules.ts')).filter(moduleId => available.has(moduleId))
        const config = { targetDir: fixture, projectName }
        generateShared(config)
        injectModuleGuides(path.join(fixture, 'AGENTS.md'), modules)
        generateCodex(config)
        const rootFile = path.join(fixture, 'AGENTS.md')
        const beforeBytes = fs.statSync(rootFile).size
        enforceRootInstructionBudget(rootFile, modules)
        const root = fs.readFileSync(rootFile, 'utf8')
        const bytes = Buffer.byteLength(root)
        assert.ok(bytes <= STANDALONE_ROOT_TARGET_BYTES, `${preset}/${projectName.length}-character name uses ${bytes}/${STANDALONE_ROOT_TARGET_BYTES} bytes`)
        const marker = root.slice(root.indexOf('<!-- om:module-guides:start -->'), root.indexOf('<!-- om:module-guides:end -->'))
        if (marker.includes('too many to index inline')) {
          assert.ok(marker.includes(`${modules.length} sheets bundled`))
          assert.ok(marker.includes('list the module facts directory'))
        } else {
          for (const moduleId of modules) assert.ok(marker.includes(`\`${moduleId}\``), `${preset}: ${moduleId}`)
        }
        context.diagnostic(`${preset}/${projectName.length}-character name: ${modules.length} facts; before ${beforeBytes}, enforced ${bytes}/${STANDALONE_ROOT_TARGET_BYTES} bytes`)
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true })
      }
    }
  }
})
