import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { atomicWriteFileSync } from '../../scripts/lib/add-js-extension.mjs'
import { buildPackage } from '../../scripts/build-package.mjs'

const packageDir = dirname(fileURLToPath(import.meta.url))

await buildPackage(packageDir, {
  name: 'cli',
  entryPoints: 'src/**/*.ts',
  rewriteOptions: {
    // Generated code templates keep `.ts` suffixes and template-literal placeholders
    // (`${...}`) inside import strings; those must survive the rewrite untouched.
    skipExtensions: ['.js', '.json', '.ts'],
    skipTemplateLiterals: true,
  },
  afterBuild: async ({ outdir }) => {
    // Prepend shebang + make bin.js executable. Use atomic write so concurrent
    // consumers (turbo, yarn test:ephemeral pipeline) never observe a half-written file.
    const binPath = join(outdir, 'bin.js')
    const binContent = readFileSync(binPath, 'utf-8')
    atomicWriteFileSync(binPath, '#!/usr/bin/env node\n' + binContent)
    chmodSync(binPath, 0o755)

    // Copy agentic source files from create-app so generators can read them at runtime.
    // The tree is assembled in a staging directory and swapped in at the end of the build: refreshing
    // dist/agentic in place deletes the whole harness plus ~55 fact-sheets and copies them back, which
    // leaves the published tree incomplete for seconds and makes any concurrent reader fail with ENOENT
    // on files that exist (#5059, #5104). Staging also makes stale per-module artifacts structurally
    // impossible, so no purge of previous output is needed — the swapped-in tree only contains what this
    // build wrote. Mirrors packages/create-app/build.mjs, including its single-builder assumption: the
    // staging and previous directory names are fixed, so two concurrent runs would clear each other's
    // staging tree below and the loser would fail loudly on the rename at the end, which beats the silent
    // partial tree the in-place refresh produced.
    const agenticDist = join(outdir, 'agentic')
    const agenticStaging = join(outdir, 'agentic.staging')
    const agenticPrevious = join(outdir, 'agentic.previous')
    for (const leftover of [agenticStaging, agenticPrevious]) rmSync(leftover, { recursive: true, force: true })
    mkdirSync(agenticStaging, { recursive: true })
    const agenticSrc = join(packageDir, '..', 'create-app', 'agentic')
    if (existsSync(agenticSrc)) {
      cpSync(agenticSrc, agenticStaging, { recursive: true })
      console.log('Copied create-app/agentic/ → dist/agentic.staging/')
    }

    const repositoryRoot = join(packageDir, '..', '..')
    const upstreamDir = join(agenticStaging, 'guides', 'upstream')
    mkdirSync(upstreamDir, { recursive: true })
    const cliVersion = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version ?? null
    const upstreamManifest = { version: 1, generator: `@open-mercato/cli@${cliVersion ?? 'unknown'}`, files: {} }
    for (const file of ['AGENTS.md', 'BACKWARD_COMPATIBILITY.md']) {
      const source = join(repositoryRoot, file)
      const destination = join(upstreamDir, file)
      cpSync(source, destination)
      upstreamManifest.files[file] = createHash('sha256').update(readFileSync(source)).digest('hex')
    }
    writeFileSync(join(upstreamDir, 'manifest.json'), `${JSON.stringify(upstreamManifest, null, 2)}\n`)

    // Discover module-specific standalone guides across sibling packages. Package-level
    // guides are intentionally not shipped because they duplicate routed conceptual guides.
    const packagesDir = join(packageDir, '..')
    const guidesDestDir = join(agenticStaging, 'guides')
    mkdirSync(guidesDestDir, { recursive: true })

    // Nothing stale can survive here: the staged tree is built from create-app/agentic alone, so the
    // legacy `core.<module>.md` redirect stubs (#3754) and the unreachable package-level `<pkg>.md`
    // guides are absent unless this build writes them — which it does not. The conceptual guides remain.

    let guidesFound = 0
    for (const pkg of readdirSync(packagesDir)) {
      const modulesDir = join(packagesDir, pkg, 'src', 'modules')
      if (!existsSync(modulesDir)) continue

      for (const mod of readdirSync(modulesDir)) {
        const moduleGuideSource = join(modulesDir, mod, 'agentic', 'standalone-guide.md')
        if (existsSync(moduleGuideSource)) {
          cpSync(moduleGuideSource, join(guidesDestDir, `${pkg}.${mod}.md`))
          guidesFound++
        }
      }
    }

    if (guidesFound > 0) {
      console.log(`Discovered ${guidesFound} standalone guides → dist/agentic.staging/guides/`)
    }

    // Generate per-module fact-sheets plus legacy-v1 and corrected-v2 JSON sidecars
    // for every package-provided module via the freshly built ts-morph extractor and
    // resolver-routed discovery, so
    // `mercato agentic:init` bundles the same guides as a create-mercato-app scaffold
    // (packages/create-app/build.mjs). Discovery goes through the resolver, never a
    // hardcoded packages/* path (.ai/lessons/standalone-scaffolding-and-generators-must-not-assume.md).
    const {
      assertPackageModuleFactsOnly,
      extractAllModuleFacts,
      extractLocalReferenceModuleFacts,
      renderModuleFactsJson,
      renderReferenceModuleFactsJson,
    } = await import(pathToFileURL(join(outdir, 'lib', 'generators', 'module-facts.js')).href)
    const { discoverLocalReferenceModuleSource, discoverPackageModuleSources } = await import(
      pathToFileURL(join(outdir, 'lib', 'generators', 'module-facts-discovery.js')).href
    )
    const { createResolver } = await import(pathToFileURL(join(outdir, 'lib', 'resolver.js')).href)

    // Mirrors packages/create-app/build.mjs: the disabled app-local example never enters
    // the normal package outputs and is projected into its own reference bundle so
    // `mercato agentic:init` bundles exactly what a create-mercato-app scaffold does.
    const REFERENCE_MODULE_IDS = ['example']

    const sources = discoverPackageModuleSources(createResolver(join(packagesDir, '..')))
    if (sources.length > 0) {
      const registryPath = join(packagesDir, '..', 'apps', 'mercato', '.mercato', 'generated', 'modules.runtime.generated.ts')
      let coreVersion = null
      try {
        coreVersion = JSON.parse(readFileSync(join(packagesDir, 'core', 'package.json'), 'utf8')).version ?? null
      } catch {
        coreVersion = null
      }

      const { factsByModule, directoryByModule, frameworkMarkdown, warnings } = extractAllModuleFacts({
        sources,
        registryPath: existsSync(registryPath) ? registryPath : null,
        coreVersion,
      })
      const { factsByModule: legacyFactsByModule } = extractAllModuleFacts({
        sources,
        registryPath: existsSync(registryPath) ? registryPath : null,
        coreVersion,
        factsContractVersion: 1,
      })

      assertPackageModuleFactsOnly(factsByModule)
      assertPackageModuleFactsOnly(legacyFactsByModule)

      const modulesGuidesDir = join(guidesDestDir, 'modules')
      mkdirSync(modulesGuidesDir, { recursive: true })
      for (const [moduleId, directory] of Object.entries(directoryByModule)) {
        const moduleGuidesDir = join(modulesGuidesDir, moduleId)
        mkdirSync(moduleGuidesDir, { recursive: true })
        writeFileSync(join(moduleGuidesDir, 'index.md'), directory.index)
        for (const section of directory.sections) {
          writeFileSync(join(moduleGuidesDir, `${section.slug}.md`), section.markdown)
        }
      }
      writeFileSync(join(guidesDestDir, 'module-facts.json'), renderModuleFactsJson(legacyFactsByModule))
      writeFileSync(join(guidesDestDir, 'module-facts.v2.json'), renderModuleFactsJson(factsByModule))
      writeFileSync(join(guidesDestDir, 'framework-extension-points.md'), frameworkMarkdown)

      for (const warning of warnings) console.warn(warning)
      console.log(
        `Generated ${Object.keys(directoryByModule).length} module fact-sheets → dist/agentic.staging/guides/modules/`,
      )

      const referenceBundle = {}
      const referenceGuidesDir = join(guidesDestDir, 'reference-modules')
      const templateRoot = join(packagesDir, 'create-app', 'template')
      for (const moduleId of REFERENCE_MODULE_IDS) {
        const reference = discoverLocalReferenceModuleSource({ appRoot: templateRoot, moduleId })
        if (!reference) {
          throw new Error(`[module-facts] reference module "${moduleId}" is missing from the create-app template`)
        }
        const { entry, directory, warnings: referenceWarnings, unresolvedTargets } = extractLocalReferenceModuleFacts({
          packageSources: sources,
          reference,
          registryPath: existsSync(registryPath) ? registryPath : null,
          coreVersion,
        })
        referenceBundle[moduleId] = entry
        const referenceModuleGuidesDir = join(referenceGuidesDir, moduleId)
        mkdirSync(referenceModuleGuidesDir, { recursive: true })
        writeFileSync(join(referenceModuleGuidesDir, 'index.md'), directory.index)
        for (const section of directory.sections) {
          writeFileSync(join(referenceModuleGuidesDir, `${section.slug}.md`), section.markdown)
        }
        for (const warning of referenceWarnings) console.warn(warning)
        for (const target of unresolvedTargets) {
          console.warn(`[module-facts][reference] unresolved first-party target: ${target}`)
        }
      }
      writeFileSync(join(guidesDestDir, 'reference-module-facts.json'), renderReferenceModuleFactsJson(referenceBundle))
      console.log(
        `Generated ${REFERENCE_MODULE_IDS.length} local reference projection(s) → dist/agentic.staging/guides/reference-modules/`,
      )
    } else {
      console.warn('[module-facts] no package modules discovered; skipping fact-sheet generation')
    }

    // Publish the staged tree. A reader either sees the complete previous build or the complete new
    // one; the only gap is between the two renames, instead of the multi-second incomplete window an
    // in-place refresh leaves behind (#5059, #5104).
    if (existsSync(agenticDist)) renameSync(agenticDist, agenticPrevious)
    renameSync(agenticStaging, agenticDist)
    rmSync(agenticPrevious, { recursive: true, force: true })
    console.log('Published create-app/agentic/ → dist/agentic/')
  },
})
