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

export interface ModuleFactsOptions {
  resolver: PackageResolver
  quiet?: boolean
}

function readCoreVersion(coreSrcRoot: string): string | null {
  const corePackageJsonPath = path.resolve(coreSrcRoot, '..', '..', 'package.json')
  if (!fs.existsSync(corePackageJsonPath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(corePackageJsonPath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/**
 * Emits the ephemeral `.mercato/generated/module-facts.generated.json` artifact from
 * monorepo core module sources. Must run AFTER `generateModuleRegistry` because
 * per-route API auth is read from the generated `modules.runtime.generated.ts`
 * registry (`apis[].metadata`). Registry-derived warnings are non-fatal.
 */
export async function generateModuleFacts(options: ModuleFactsOptions): Promise<GeneratorResult> {
  const { resolver, quiet } = options
  const result = createGeneratorResult()

  const rootDir = resolver.getRootDir()
  const coreSrcRoot = path.join(rootDir, 'packages', 'core', 'src', 'modules')
  if (!fs.existsSync(coreSrcRoot)) {
    if (!quiet) {
      console.warn(`[module-facts] core module sources not found at ${coreSrcRoot}; skipping module-facts generation`)
    }
    return result
  }

  const registryPath = path.join(resolver.getOutputDir(), 'modules.runtime.generated.ts')
  const coreVersion = readCoreVersion(coreSrcRoot)

  const { factsByModule, warnings } = extractAllModuleFacts({ coreSrcRoot, registryPath, coreVersion })
  for (const warning of warnings) {
    console.warn(warning)
  }

  const content = renderModuleFactsJson(factsByModule)
  const outFile = path.join(resolver.getOutputDir(), 'module-facts.generated.json')
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
