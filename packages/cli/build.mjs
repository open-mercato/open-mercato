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

    // Discover standalone guides across sibling packages.
    const packagesDir = join(packageDir, '..')
    const guidesDestDir = join(outdir, 'agentic', 'guides')
    mkdirSync(guidesDestDir, { recursive: true })

    // Clean stale per-module artifacts before regenerating so an incremental dist never
    // retains a removed module's full guide or fact-sheet. The legacy `core.<module>.md`
    // redirect stubs are no longer emitted (#3754); this purge also deletes any that linger
    // in an incremental `dist/` from an older build. Mirrors packages/create-app/build.mjs;
    // the conceptual `module-system.md` and the single-dot package guides are
    // re-copied/re-discovered below.
    rmSync(join(guidesDestDir, 'modules'), { recursive: true, force: true })
    for (const entry of readdirSync(guidesDestDir)) {
      if (/^core\..+\.md$/.test(entry)) {
        rmSync(join(guidesDestDir, entry))
      }
    }

    let guidesFound = 0
    for (const pkg of readdirSync(packagesDir)) {
      const guideSource = join(packagesDir, pkg, 'agentic', 'standalone-guide.md')
      if (existsSync(guideSource)) {
        cpSync(guideSource, join(guidesDestDir, `${pkg}.md`))
        guidesFound++
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
    // hardcoded packages/* path (.ai/lessons.md §161-169).
    const { extractAllModuleFacts, renderModuleFactsJson } = await import(
      pathToFileURL(join(outdir, 'lib', 'generators', 'module-facts.js')).href
    )
    const { discoverPackageModuleSources } = await import(
      pathToFileURL(join(outdir, 'lib', 'generators', 'module-facts-discovery.js')).href
    )
    const { createResolver } = await import(pathToFileURL(join(outdir, 'lib', 'resolver.js')).href)

    const sources = discoverPackageModuleSources(createResolver(join(packagesDir, '..')))
    if (sources.length > 0) {
      const registryPath = join(packagesDir, '..', 'apps', 'mercato', '.mercato', 'generated', 'modules.runtime.generated.ts')
      let coreVersion = null
      try {
        coreVersion = JSON.parse(readFileSync(join(packagesDir, 'core', 'package.json'), 'utf8')).version ?? null
      } catch {
        coreVersion = null
      }

      const { factsByModule, markdownByModule, warnings } = extractAllModuleFacts({
        sources,
        registryPath: existsSync(registryPath) ? registryPath : null,
        coreVersion,
      })

      const modulesGuidesDir = join(guidesDestDir, 'modules')
      mkdirSync(modulesGuidesDir, { recursive: true })
      for (const [moduleId, markdown] of Object.entries(markdownByModule)) {
        writeFileSync(join(modulesGuidesDir, `${moduleId}.md`), markdown)
      }
      writeFileSync(join(guidesDestDir, 'module-facts.json'), renderModuleFactsJson(factsByModule))

      for (const warning of warnings) console.warn(warning)
      console.log(`Generated ${Object.keys(markdownByModule).length} module fact-sheets → dist/agentic/guides/modules/`)
    } else {
      console.warn('[module-facts] no package modules discovered; skipping fact-sheet generation')
    }
  },
})
