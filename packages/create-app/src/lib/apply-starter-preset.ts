import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PRESET_ID,
  STARTER_PRESETS,
  VALID_PRESET_IDS,
  type ModuleEntry,
  type StarterPreset,
  type StarterPresetId,
} from './starter-presets.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export type ResolvedPreset = {
  id: StarterPresetId
  modules: ModuleEntry[]
  filesToRemove: string[]
  ui: StarterPreset['ui']
  isClassic: boolean
}

export function resolvePreset(presetId: string): ResolvedPreset {
  const preset = STARTER_PRESETS[presetId]
  if (!preset) {
    throw new Error(`Unknown preset "${presetId}". Valid presets: ${VALID_PRESET_IDS.join(', ')}`)
  }

  let modules: ModuleEntry[]
  let parentFilesToRemove: string[] = []

  if (preset.modules.mode === 'replace') {
    modules = [...preset.modules.enabled]
  } else {
    if (!preset.extends) {
      throw new Error(`Preset "${presetId}" uses mode "patch" but has no "extends" parent`)
    }
    const parent = STARTER_PRESETS[preset.extends]
    if (!parent) {
      throw new Error(`Preset "${presetId}" extends unknown preset "${preset.extends}"`)
    }
    if (parent.modules.mode !== 'replace') {
      throw new Error(`Preset "${presetId}" parent "${preset.extends}" must use mode "replace"`)
    }

    parentFilesToRemove = parent.files?.remove ?? []

    let base = [...parent.modules.enabled]
    if (preset.modules.add) {
      base = [...base, ...preset.modules.add]
    }
    if (preset.modules.remove) {
      const toRemove = new Set(preset.modules.remove)
      base = base.filter((m) => !toRemove.has(m.id))
    }
    modules = base
  }

  const ids = modules.map((m) => m.id)
  const seen = new Set<string>()
  const duplicates = ids.filter((id) => {
    if (seen.has(id)) return true
    seen.add(id)
    return false
  })
  if (duplicates.length > 0) {
    throw new Error(`Preset "${presetId}" has duplicate module IDs: ${duplicates.join(', ')}`)
  }

  const ownFilesToRemove = preset.files?.remove ?? []
  const filesToRemove = [...new Set([...parentFilesToRemove, ...ownFilesToRemove])]

  return {
    id: preset.id,
    modules,
    filesToRemove,
    ui: preset.ui,
    isClassic: presetId === DEFAULT_PRESET_ID,
  }
}

export function generateModulesTs(modules: ModuleEntry[]): string {
  const moduleLines = modules
    .map((m) => `  { id: '${m.id}', from: '${m.from}' },`)
    .join('\n')

  const template = readFileSync(join(__dirname, 'templates', 'modules-ts.template'), 'utf8')
  return template.replace('{{MODULES}}', moduleLines)
}

export function applyStarterPreset(presetId: string, targetDir: string): void {
  const resolved = resolvePreset(presetId)

  if (resolved.isClassic) return

  writeFileSync(join(targetDir, 'src', 'modules.ts'), generateModulesTs(resolved.modules))

  for (const relativePath of resolved.filesToRemove) {
    rmSync(join(targetDir, relativePath), { recursive: true, force: true })
  }

  writeFileSync(
    join(targetDir, '.mercato', 'starter-preset.json'),
    JSON.stringify({ preset: presetId, generatedAt: new Date().toISOString() }, null, 2) + '\n',
  )
}
