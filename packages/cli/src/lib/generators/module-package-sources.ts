import path from 'node:path'
import { readOfficialModulePackageFromRoot, resolveInstalledPackageRoot } from '../module-package'
import type { PackageResolver } from '../resolver'
import { calculateChecksum, createGeneratorResult, type GeneratorResult, writeGeneratedFile } from '../utils'

export interface ModulePackageSourcesOptions {
  resolver: PackageResolver
  quiet?: boolean
}

function normalizeCssSourcePath(value: string): string {
  const normalized = value.split(path.sep).join('/')
  return normalized.startsWith('.') ? normalized : `./${normalized}`
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
  const checksumInputs = new Set<string>()

  for (const entry of resolver.loadEnabledModules()) {
    if (!entry.from || entry.from === '@app' || entry.from === '@open-mercato/core') continue

    const packageRoot = resolveInstalledPackageRoot(resolver, entry.from)

    let modulePackage
    try {
      modulePackage = readOfficialModulePackageFromRoot(packageRoot, entry.from, entry.id)
    } catch {
      continue
    }

    const packageSourceRoot = path.join(modulePackage.packageRoot, 'src')
    checksumInputs.add(JSON.stringify({
      entry: {
        from: entry.from,
        id: entry.id,
      },
      packageName: modulePackage.packageName,
      packageRoot: path.resolve(modulePackage.packageRoot),
      packageJson: modulePackage.packageJson,
      packageSourceRoot,
      sourceModuleDir: path.resolve(modulePackage.sourceModuleDir),
      distModuleDir: path.resolve(modulePackage.distModuleDir),
    }))
    const relativeSourcePath = normalizeCssSourcePath(path.relative(path.dirname(outFile), packageSourceRoot))
    sourcePaths.add(`@source "${relativeSourcePath}/**/*.{ts,tsx}";`)
  }

  const content = `${Array.from(sourcePaths).sort((left, right) => left.localeCompare(right)).join('\n')}${sourcePaths.size > 0 ? '\n' : ''}`
  const structureChecksum = calculateChecksum(
    Array.from(checksumInputs).sort((left, right) => left.localeCompare(right)).join('\n'),
  )

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
