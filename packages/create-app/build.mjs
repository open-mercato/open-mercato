import * as esbuild from 'esbuild'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join, basename, resolve } from 'path'
import { pathToFileURL } from 'node:url'

const shebang = '#!/usr/bin/env node\n'

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outdir: 'dist',
  packages: 'external',
  banner: {
    js: shebang,
  },
})

// Make the output executable
chmodSync('dist/index.js', 0o755)

// Copy lib template assets to dist/ so they can be read at runtime
if (existsSync('src/lib/templates')) {
  cpSync('src/lib/templates', 'dist/templates', { recursive: true })
  console.log('Copied src/lib/templates/ → dist/templates/')
}

// Copy agentic source content to dist/ so generators can read it at runtime
if (existsSync('agentic')) {
  rmSync('dist/agentic', { recursive: true, force: true })
  cpSync('agentic', 'dist/agentic', { recursive: true })
  console.log('Copied agentic/ → dist/agentic/')
}

// Bundle the release-matched upstream instruction boundary used by standalone
// apps when installed package/module context is not enough. Both files remain
// read-only reference material in the generated app.
const repositoryRoot = resolve('..', '..')
const upstreamDir = join('dist', 'agentic', 'guides', 'upstream')
mkdirSync(upstreamDir, { recursive: true })
const createAppVersion = JSON.parse(readFileSync('package.json', 'utf8')).version ?? null
const upstreamManifest = { version: 1, generator: `create-mercato-app@${createAppVersion ?? 'unknown'}`, files: {} }
for (const file of ['AGENTS.md', 'BACKWARD_COMPATIBILITY.md']) {
  const source = join(repositoryRoot, file)
  const destination = join(upstreamDir, file)
  cpSync(source, destination)
  upstreamManifest.files[file] = createHash('sha256').update(readFileSync(source)).digest('hex')
}
writeFileSync(join(upstreamDir, 'manifest.json'), `${JSON.stringify(upstreamManifest, null, 2)}\n`)

// Auto-discover module-specific standalone guides from sibling packages.
// Package-level guides are intentionally not shipped: the routed conceptual guides and
// generated module fact-sheets are the standalone sources of truth.
const packagesDir = join('..') // packages/create-app/.. = packages/
const guidesDestDir = join('dist', 'agentic', 'guides')
mkdirSync(guidesDestDir, { recursive: true })

// Clean stale per-module artifacts before regenerating so an incremental dist never
// retains a removed module's full guide or fact-sheet. The legacy `core.<module>.md`
// redirect stubs are no longer emitted (#3754); this purge also deletes any that linger
// in an incremental `dist/` from an older build. The conceptual `module-system.md` remains;
// stale single-dot package guides (`core.md`, …) are removed below.
rmSync(join(guidesDestDir, 'modules'), { recursive: true, force: true })
rmSync(join(guidesDestDir, 'reference-modules'), { recursive: true, force: true })
rmSync(join(guidesDestDir, 'reference-module-facts.json'), { force: true })
rmSync(join(guidesDestDir, 'module-facts.v2.json'), { force: true })
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

  // Module-level guides: packages/<pkg>/src/modules/<mod>/agentic/standalone-guide.md → <pkg>.<mod>.md
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
// the reusable ts-morph extractor + resolver-routed discovery in @open-mercato/cli.
// Emits one markdown sheet per discovered module plus legacy-v1 and corrected-v2
// JSON sidecars. A scaffold links only its enabled subset; shared.ts owns that filtering.
// Auth comes from the generated module registry (`apis[].metadata`); a missing registry
// yields warnings, never a crash. Discovery goes through the resolver, never a hardcoded
// packages/* path (.ai/lessons/standalone-scaffolding-and-generators-must-not-assume.md).
const workspaceCliDist = join(repositoryRoot, 'packages', 'cli', 'dist', 'lib')
const resolveCliBuildImport = (relativePath, packageImport) => {
  const workspacePath = join(workspaceCliDist, relativePath)
  return existsSync(workspacePath) ? pathToFileURL(workspacePath).href : packageImport
}

const {
  assertPackageModuleFactsOnly,
  extractAllModuleFacts,
  extractLocalReferenceModuleFacts,
  renderModuleFactsJson,
  renderReferenceModuleFactsJson,
} = await import(resolveCliBuildImport('generators/module-facts.js', '@open-mercato/cli/lib/generators/module-facts'))
const { discoverLocalReferenceModuleSource, discoverPackageModuleSources } = await import(
  resolveCliBuildImport(
    'generators/module-facts-discovery.js',
    '@open-mercato/cli/lib/generators/module-facts-discovery',
  )
)
const { createResolver } = await import(resolveCliBuildImport('resolver.js', '@open-mercato/cli/lib/resolver'))

// The app-local example is disabled in every preset, so it is never a package module and
// never enters the normal outputs. It is projected into its own reference bundle from the
// template root here; scaffold setup and `mercato agentic:init` recompute the same bundle
// from the generated app's own `src/modules/example`.
const REFERENCE_MODULE_IDS = ['example']

const sources = discoverPackageModuleSources(createResolver(resolve(packagesDir, '..')))
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
  const { factsByModule: legacyFactsByModule } = extractAllModuleFacts({
    sources,
    registryPath: existsSync(registryPath) ? registryPath : null,
    coreVersion,
    factsContractVersion: 1,
  })

  const extractedModuleIds = Object.keys(markdownByModule)
  if (extractedModuleIds.length === 0) {
    throw new Error(
      '[module-facts] package sources were discovered but produced no fact-sheets; refusing to build an empty knowledge layer',
    )
  }

  assertPackageModuleFactsOnly(factsByModule)
  assertPackageModuleFactsOnly(legacyFactsByModule)

  const modulesGuidesDir = join(guidesDestDir, 'modules')
  mkdirSync(modulesGuidesDir, { recursive: true })
  for (const [moduleId, markdown] of Object.entries(markdownByModule)) {
    writeFileSync(join(modulesGuidesDir, `${moduleId}.md`), markdown)
  }
  writeFileSync(join(guidesDestDir, 'module-facts.json'), renderModuleFactsJson(legacyFactsByModule))
  writeFileSync(join(guidesDestDir, 'module-facts.v2.json'), renderModuleFactsJson(factsByModule))
  writeFileSync(join(guidesDestDir, 'framework-extension-points.md'), frameworkMarkdown)

  for (const warning of warnings) console.warn(warning)
  console.log(`Generated ${extractedModuleIds.length} module fact-sheets → dist/agentic/guides/modules/`)

  const referenceBundle = {}
  const referenceGuidesDir = join(guidesDestDir, 'reference-modules')
  for (const moduleId of REFERENCE_MODULE_IDS) {
    const reference = discoverLocalReferenceModuleSource({ appRoot: 'template', moduleId })
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
  throw new Error(
    '[module-facts] no readable package module sources were discovered; refusing to build an empty knowledge layer',
  )
}

console.log('Build complete: dist/index.js')
