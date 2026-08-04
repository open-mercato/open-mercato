import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    const agenticSrc = join(packageDir, '..', 'create-app', 'agentic')
    if (existsSync(agenticSrc)) {
      rmSync(join(outdir, 'agentic'), { recursive: true, force: true })
      cpSync(agenticSrc, join(outdir, 'agentic'), { recursive: true })
      console.log('Copied create-app/agentic/ → dist/agentic/')
    }

    const repositoryRoot = join(packageDir, '..', '..')
    const upstreamDir = join(outdir, 'agentic', 'guides', 'upstream')
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
    const guidesDestDir = join(outdir, 'agentic', 'guides')
    mkdirSync(guidesDestDir, { recursive: true })

    // Clean stale per-module artifacts before regenerating so an incremental dist never
    // retains a removed module's full guide or fact-sheet. The legacy `core.<module>.md`
    // redirect stubs are no longer emitted (#3754); this purge also deletes any that linger
    // in an incremental `dist/` from an older build. Mirrors packages/create-app/build.mjs;
    // conceptual guides remain while stale single-dot package guides are removed below.
    rmSync(join(guidesDestDir, 'modules'), { recursive: true, force: true })
    rmSync(join(guidesDestDir, 'reference-modules'), { recursive: true, force: true })
    rmSync(join(guidesDestDir, 'reference-module-facts.json'), { force: true })
    for (const entry of readdirSync(guidesDestDir)) {
      if (/^core\..+\.md$/.test(entry)) {
        rmSync(join(guidesDestDir, entry))
      }
    }

    let guidesFound = 0
    for (const pkg of readdirSync(packagesDir)) {
      // Package-level source guides remain for monorepo context, but standalone apps route
      // through conceptual and module-level guides, so remove their stale emitted copies.
      const guideSource = join(packagesDir, pkg, 'agentic', 'standalone-guide.md')
      if (existsSync(guideSource)) {
        rmSync(join(guidesDestDir, `${pkg}.md`), { force: true })
      }

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
      console.log(`Discovered ${guidesFound} standalone guides → dist/agentic/guides/`)
    }

    // Generate per-module fact-sheets (Layer 2) for every package-provided module via
    // the freshly built ts-morph extractor + resolver-routed discovery, so
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

      const { factsByModule, markdownByModule, frameworkMarkdown, warnings } = extractAllModuleFacts({
        sources,
        registryPath: existsSync(registryPath) ? registryPath : null,
        coreVersion,
      })

      assertPackageModuleFactsOnly(factsByModule)

      const modulesGuidesDir = join(guidesDestDir, 'modules')
      mkdirSync(modulesGuidesDir, { recursive: true })
      for (const [moduleId, markdown] of Object.entries(markdownByModule)) {
        writeFileSync(join(modulesGuidesDir, `${moduleId}.md`), markdown)
      }
      writeFileSync(join(guidesDestDir, 'module-facts.json'), renderModuleFactsJson(factsByModule))
      writeFileSync(join(guidesDestDir, 'framework-extension-points.md'), frameworkMarkdown)

      for (const warning of warnings) console.warn(warning)
      console.log(`Generated ${Object.keys(markdownByModule).length} module fact-sheets → dist/agentic/guides/modules/`)

      const referenceBundle = {}
      const referenceGuidesDir = join(guidesDestDir, 'reference-modules')
      const templateRoot = join(packagesDir, 'create-app', 'template')
      for (const moduleId of REFERENCE_MODULE_IDS) {
        const reference = discoverLocalReferenceModuleSource({ appRoot: templateRoot, moduleId })
        if (!reference) {
          throw new Error(`[module-facts] reference module "${moduleId}" is missing from the create-app template`)
        }
        const { entry, markdown, warnings: referenceWarnings, unresolvedTargets } = extractLocalReferenceModuleFacts({
          packageSources: sources,
          reference,
          registryPath: existsSync(registryPath) ? registryPath : null,
          coreVersion,
        })
        referenceBundle[moduleId] = entry
        mkdirSync(referenceGuidesDir, { recursive: true })
        writeFileSync(join(referenceGuidesDir, `${moduleId}.md`), markdown)
        for (const warning of referenceWarnings) console.warn(warning)
        for (const target of unresolvedTargets) {
          console.warn(`[module-facts][reference] unresolved first-party target: ${target}`)
        }
      }
      writeFileSync(join(guidesDestDir, 'reference-module-facts.json'), renderReferenceModuleFactsJson(referenceBundle))
      console.log(
        `Generated ${REFERENCE_MODULE_IDS.length} local reference projection(s) → dist/agentic/guides/reference-modules/`,
      )
    } else {
      console.warn('[module-facts] no package modules discovered; skipping fact-sheet generation')
    }
  },
})
