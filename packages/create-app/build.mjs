import * as esbuild from 'esbuild'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join, basename, resolve } from 'path'

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

// Auto-discover standalone guides from sibling packages
// Each package can provide packages/<name>/agentic/standalone-guide.md
const packagesDir = join('..') // packages/create-app/.. = packages/
const guidesDestDir = join('dist', 'agentic', 'guides')
mkdirSync(guidesDestDir, { recursive: true })

// Clean stale per-module artifacts before regenerating so an incremental dist never
// retains a removed module's full guide or fact-sheet. The legacy `core.<module>.md`
// redirect stubs are no longer emitted (#3754); this purge also deletes any that linger
// in an incremental `dist/` from an older build. The conceptual `module-system.md` and the
// single-dot package guides (`core.md`, …) are re-emitted below (or copied from `agentic/`),
// so they are intentionally left alone here.
rmSync(join(guidesDestDir, 'modules'), { recursive: true, force: true })
for (const entry of readdirSync(guidesDestDir)) {
  if (/^core\..+\.md$/.test(entry)) {
    rmSync(join(guidesDestDir, entry))
  }
}

let guidesFound = 0
for (const pkg of readdirSync(packagesDir)) {
  // Package-level guide: packages/<pkg>/agentic/standalone-guide.md → <pkg>.md
  const guideSource = join(packagesDir, pkg, 'agentic', 'standalone-guide.md')
  if (existsSync(guideSource)) {
    cpSync(guideSource, join(guidesDestDir, `${pkg}.md`))
    guidesFound++
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
// Emits one markdown sheet per discovered module plus a combined JSON sidecar; a
// scaffold links only its enabled subset (packages/create-app/src/setup/tools/shared.ts).
// Auth comes from the generated module registry (`apis[].metadata`); a missing registry
// yields warnings, never a crash. Discovery goes through the resolver, never a hardcoded
// packages/* path (.ai/lessons.md §161-169).
const { extractAllModuleFacts, renderModuleFactsJson } = await import(
  '@open-mercato/cli/lib/generators/module-facts'
)
const { discoverPackageModuleSources } = await import(
  '@open-mercato/cli/lib/generators/module-facts-discovery'
)
const { createResolver } = await import('@open-mercato/cli/lib/resolver')

const sources = discoverPackageModuleSources(createResolver(resolve(packagesDir, '..')))
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

console.log('Build complete: dist/index.js')
