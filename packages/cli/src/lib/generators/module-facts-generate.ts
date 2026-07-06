import fs from 'node:fs'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import {
  createGeneratorResult,
  ensureDir,
  logGenerationResult,
  type GeneratorResult,
} from '../utils'
import { extractAllModuleFacts, renderModuleFactsJson } from './module-facts'
import { discoverEnabledModuleSources } from './module-facts-discovery'

export interface ModuleFactsOptions {
  resolver: PackageResolver
  quiet?: boolean
}

function readCoreVersion(resolver: PackageResolver): string | null {
  const corePackageJsonPath = path.join(resolver.getPackageRoot('@open-mercato/core'), 'package.json')
  if (!fs.existsSync(corePackageJsonPath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(corePackageJsonPath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/**
 * Emits the versioned `apps/mercato/src/module-facts.generated.json` artifact from
 * every enabled, source-available module (auto-discovery — core, other packages,
 * enterprise, and standalone app-local modules). Must run AFTER `generateModuleRegistry`
 * because per-route API auth is read from the generated `modules.runtime.generated.ts`
 * registry (`apis[].metadata`). Registry-derived warnings are non-fatal.
 */
export async function generateModuleFacts(options: ModuleFactsOptions): Promise<GeneratorResult> {
  const { resolver, quiet } = options
  const result = createGeneratorResult()

  const sources = discoverEnabledModuleSources(resolver)
  if (sources.length === 0) {
    if (!quiet) {
      console.warn('[module-facts] no enabled source-available modules discovered; skipping module-facts generation')
    }
    return result
  }

  const registryPath = path.join(resolver.getOutputDir(), 'modules.runtime.generated.ts')
  const coreVersion = readCoreVersion(resolver)

  const { factsByModule, warnings } = extractAllModuleFacts({ sources, registryPath, coreVersion })
  for (const warning of warnings) {
    console.warn(warning)
  }

  const content = renderModuleFactsJson(factsByModule)
  const outFile = path.join(resolver.getAppDir(), 'src', 'module-facts.generated.json')
  const existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null
  if (existing === content) {
    result.filesUnchanged.push(outFile)
    return result
  }

  ensureDir(outFile)
  fs.writeFileSync(outFile, content)
  result.filesWritten.push(outFile)
  logGenerationResult(path.relative(process.cwd(), outFile), true)
  return result
}
