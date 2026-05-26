import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
      cpSync(agenticSrc, join(outdir, 'agentic'), { recursive: true })
      console.log('Copied create-app/agentic/ → dist/agentic/')
    }

    // Discover standalone guides across sibling packages.
    const packagesDir = join(packageDir, '..')
    const guidesDestDir = join(outdir, 'agentic', 'guides')
    mkdirSync(guidesDestDir, { recursive: true })

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
  },
})
