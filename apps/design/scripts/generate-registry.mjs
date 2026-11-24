import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { SPECIFIER_ALIASES, appRoot, resolveWorkspaceSource } from './workspace-resolve.mjs'

const outfile = path.join(appRoot, '.cache', 'registry-snapshot.cjs')
await mkdir(path.dirname(outfile), { recursive: true })

const workspaceSourcePlugin = {
  name: 'open-mercato-workspace-source',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^#generated\// }, (args) => {
      const aliased = SPECIFIER_ALIASES[args.path]
      return aliased ? { path: aliased } : undefined
    })
    pluginBuild.onResolve({ filter: /^@open-mercato\// }, (args) => {
      const resolved = resolveWorkspaceSource(args.path)
      return resolved ? { path: resolved } : undefined
    })
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@open-mercato/')) return undefined
      if (path.isAbsolute(args.path) || args.path.startsWith('#')) return undefined
      return { path: args.path, external: true }
    })
  },
}

await build({
  entryPoints: [path.join(appRoot, 'scripts', 'registry-snapshot.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  jsx: 'automatic',
  logLevel: 'warning',
  loader: { '.png': 'empty', '.svg': 'empty', '.jpg': 'empty', '.webp': 'empty', '.css': 'empty' },
  plugins: [workspaceSourcePlugin],
})

const snapshot = await import(pathToFileURL(outfile).href)
const run = snapshot.default?.run ?? snapshot.run
await run()
