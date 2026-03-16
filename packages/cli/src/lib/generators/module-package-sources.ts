import fs from 'node:fs'
import path from 'node:path'
import { readOfficialModulePackageFromRoot, resolveInstalledPackageRoot } from '../module-package'
import type { PackageResolver } from '../resolver'
import { calculateStructureChecksum, createGeneratorResult, type GeneratorResult, writeGeneratedFile } from '../utils'

export interface ModulePackageSourcesOptions {
  resolver: PackageResolver
  quiet?: boolean
}

type PackageJsonWithOpenMercato = {
  name?: string
  'open-mercato'?: {
    kind?: string
    moduleId?: string
  }
}

function normalizeCssSourcePath(value: string): string {
  const normalized = value.split(path.sep).join('/')
  return normalized.startsWith('.') ? normalized : `./${normalized}`
}

function readPackageJson(packageRoot: string): PackageJsonWithOpenMercato | null {
  const packageJsonPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJsonWithOpenMercato
  } catch {
    return null
  }
}

export async function generateModulePackageSources(
  options: ModulePackageSourcesOptions,
): Promise<GeneratorResult> {
  const { resolver, quiet } = options
  const result = createGeneratorResult()
  const outputDir = resolver.getOutputDir()
  const outFile = path.join(outputDir, 'module-package-sources.css')
  const checksumFile = path.join(outputDir, 'module-package-sources.checksum')
  const sourcePaths = new Set<string>()
  const checksumTargets: string[] = []

  for (const entry of resolver.loadEnabledModules()) {
    if (!entry.from || entry.from === '@app' || entry.from === '@open-mercato/core') continue

    const packageRoot = resolveInstalledPackageRoot(resolver, entry.from)
    checksumTargets.push(packageRoot)

    const rawPackageJson = readPackageJson(packageRoot)
    if (!rawPackageJson || rawPackageJson['open-mercato']?.kind !== 'module-package') {
      continue
    }

    const modulePackage = readOfficialModulePackageFromRoot(packageRoot, entry.from)
    if (modulePackage.metadata.moduleId !== entry.id) {
      result.errors.push(
        `Official module package "${entry.from}" declares moduleId "${modulePackage.metadata.moduleId}", but src/modules.ts enables "${entry.id}".`,
      )
      continue
    }

    const packageSourceRoot = path.join(modulePackage.packageRoot, 'src')
    const relativeSourcePath = normalizeCssSourcePath(path.relative(path.dirname(outFile), packageSourceRoot))
    sourcePaths.add(`@source "${relativeSourcePath}/**/*.{ts,tsx}";`)
  }

  const content = `${Array.from(sourcePaths).sort((left, right) => left.localeCompare(right)).join('\n')}${sourcePaths.size > 0 ? '\n' : ''}`
  const structureChecksum = calculateStructureChecksum(checksumTargets)

  writeGeneratedFile({
    outFile,
    checksumFile,
    content,
    structureChecksum,
    result,
    quiet,
  })

  return result
}
