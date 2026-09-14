import fs from 'node:fs'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import { createGeneratorResult, type GeneratorResult } from '../utils'
import { discoverAppLocalModuleSources, discoverPackageModuleSources } from './module-facts-discovery'
import { extractLocalReferenceModuleFacts } from './module-facts'

export interface AppLocalModuleFactsOptions {
  resolver: PackageResolver
  quiet?: boolean
}

function writeIfChanged(file: string, content: string, result: GeneratorResult): void {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return
  fs.writeFileSync(file, content)
  result.filesWritten.push(file)
}

/**
 * Projects each enabled `@app` module's fact sheet into `.ai/guides/app-modules/<id>/`,
 * mirroring the sectioned layout of the installed-package sheets under
 * `.ai/guides/modules/`. Package output stays untouched: every projection runs through
 * the disposable activated batch in `extractLocalReferenceModuleFacts`, so the
 * package-only invariant on normal fact output holds.
 *
 * Gated on the installed agent harness, not repo topology: `apps/mercato` has no
 * `.ai/guides` tree and must keep producing byte-identical generator output, while every
 * scaffolded standalone app ships one. Extraction failures degrade to a warning for that
 * module; the knowledge layer must never block code generation.
 */
export async function generateAppLocalModuleFacts(
  options: AppLocalModuleFactsOptions,
): Promise<GeneratorResult> {
  const { resolver, quiet } = options
  const result = createGeneratorResult()
  const guidesDir = path.join(resolver.getAppDir(), '.ai', 'guides')
  if (!fs.existsSync(guidesDir)) return result
  const outputRoot = path.join(guidesDir, 'app-modules')
  const sources = discoverAppLocalModuleSources(resolver)
  const emitted = new Set<string>()

  if (sources.length > 0) {
    let packageSources: ReturnType<typeof discoverPackageModuleSources>
    try {
      packageSources = discoverPackageModuleSources(resolver)
    } catch {
      packageSources = []
    }
    const registryPath = path.join(resolver.getOutputDir(), 'modules.runtime.generated.ts')
    let coreVersion: string | null = null
    try {
      const corePackage = path.join(resolver.getAppDir(), 'node_modules', '@open-mercato', 'core', 'package.json')
      coreVersion = (JSON.parse(fs.readFileSync(corePackage, 'utf8')) as { version?: string }).version ?? null
    } catch {
      coreVersion = null
    }

    for (const reference of sources) {
      try {
        const { directory, warnings } = extractLocalReferenceModuleFacts({
          packageSources,
          reference,
          registryPath: fs.existsSync(registryPath) ? registryPath : null,
          coreVersion,
        })
        const moduleDir = path.join(outputRoot, reference.moduleId)
        fs.mkdirSync(moduleDir, { recursive: true })
        const expected = new Set(['index.md', ...directory.sections.map((section) => `${section.slug}.md`)])
        writeIfChanged(path.join(moduleDir, 'index.md'), directory.index, result)
        for (const section of directory.sections) {
          writeIfChanged(path.join(moduleDir, `${section.slug}.md`), section.markdown, result)
        }
        for (const stale of fs.readdirSync(moduleDir)) {
          if (expected.has(stale)) continue
          fs.rmSync(path.join(moduleDir, stale), { recursive: true, force: true })
          result.filesWritten.push(path.join(moduleDir, stale))
        }
        emitted.add(reference.moduleId)
        if (!quiet) for (const warning of warnings) console.warn(warning)
      } catch (error) {
        if (!quiet) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[module-facts][app-local] skipped ${reference.moduleId}: ${message}`)
        }
      }
    }
  }

  if (fs.existsSync(outputRoot)) {
    for (const staleModule of fs.readdirSync(outputRoot)) {
      if (emitted.has(staleModule)) continue
      fs.rmSync(path.join(outputRoot, staleModule), { recursive: true, force: true })
      result.filesWritten.push(path.join(outputRoot, staleModule))
    }
    if (fs.readdirSync(outputRoot).length === 0) fs.rmdirSync(outputRoot)
  }

  if (!quiet && emitted.size > 0) {
    console.log(`[module-facts] projected ${emitted.size} app-local module fact sheet(s) → .ai/guides/app-modules/`)
  }
  return result
}
