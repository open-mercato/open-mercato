#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startDashboardServer } from './server.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, '../..')
export function parseArgs(argv) {
  const options = { experiments: [], port: 8768 }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') return { ...options, help: true }
    if (!['--experiment', '--port'].includes(argument) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Use --experiment <directory> repeatedly and optionally --port <0-65535>')
    const value = argv[++index]
    if (argument === '--experiment') options.experiments.push(path.resolve(value))
    else {
      if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) throw new Error('Invalid dashboard port')
      options.port = Number(value)
    }
  }
  if (!options.experiments.length) throw new Error('At least one explicit --experiment directory is required')
  return options
}
export function extractFoundations(css) {
  const blocks = []
  const selector = /(?:^|\n)\s*(:root|\.dark)\s*\{/g
  for (const match of css.matchAll(selector)) {
    const start = match.index + match[0].indexOf(match[1])
    let position = css.indexOf('{', start) + 1
    let depth = 1
    while (position < css.length && depth) {
      if (css[position] === '{') depth++
      else if (css[position] === '}') depth--
      position++
    }
    if (depth) throw new Error('Unterminated foundation token block')
    blocks.push(css.slice(start, position))
  }
  if (!blocks.some(block => block.startsWith(':root'))) throw new Error('Foundation tokens are unavailable')
  return blocks.join('\n\n') + '\n'
}
export async function buildDashboardAssets({ root = repository, cacheDir } = {}) {
  const { build } = await import('esbuild')
  const source = path.join(root, 'scripts/experiment-dashboard/ui')
  const cacheParent = path.join(root, '.ai/reports')
  await fs.mkdir(cacheParent, { recursive: true })
  const output = cacheDir || await fs.mkdtemp(path.join(cacheParent, 'experiment-dashboard-assets-'))
  await fs.mkdir(output, { recursive: true })
  try {
    await build({
      entryPoints: [path.join(source, 'main.tsx')], outfile: path.join(output, 'app.js'), bundle: true,
      platform: 'browser', format: 'esm', target: ['es2022'], jsx: 'automatic', sourcemap: false,
      minify: true, define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [{ name: 'workspace-source-imports', setup(builder) {
        builder.onResolve({ filter: /^@open-mercato\/(?:ui|shared)\// }, async args => {
          const match = /^@open-mercato\/(ui|shared)\/(.+)$/.exec(args.path)
          const base = path.join(root, 'packages', match[1], 'src', match[2])
          for (const suffix of ['', '.tsx', '.ts', '.mjs', '.js', '/index.tsx', '/index.ts']) {
            try { if ((await fs.stat(base + suffix)).isFile()) return { path: base + suffix } } catch {}
          }
          return undefined
        })
      } }],
    })
    const html = await fs.readFile(path.join(source, 'index.html'), 'utf8').catch(() => '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Experiment dashboard</title><link rel="stylesheet" href="/foundation.css"><link rel="stylesheet" href="/styles.css"><script type="module" src="/app.js"></script></head><body><div id="root"></div></body></html>')
    await fs.writeFile(path.join(output, 'index.html'), html)
    await fs.copyFile(path.join(source, 'styles.css'), path.join(output, 'styles.css'))
    const css = await fs.readFile(path.join(root, 'apps/mercato/src/app/globals.css'), 'utf8')
    await fs.writeFile(path.join(output, 'foundation.css'), extractFoundations(css))
    return output
  } catch (error) {
    if (!cacheDir) await fs.rm(output, { recursive: true, force: true })
    throw error
  }
}
export async function runDashboardCLI(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write('Usage: yarn experiments:dashboard --experiment <directory> [--experiment <directory>] [--port <port>]\nRead-only dashboard, bound to 127.0.0.1.\n')
    return null
  }
  const assetsDir = await buildDashboardAssets()
  let dashboard
  try { dashboard = await startDashboardServer({ ...options, assetsDir }) } catch (error) { await fs.rm(assetsDir, { recursive: true, force: true }); throw error }
  process.stdout.write('Experiment dashboard: ' + dashboard.url + '\n')
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await dashboard.close()
    await fs.rm(assetsDir, { recursive: true, force: true })
  }
  process.once('SIGINT', () => close().then(() => process.exit(0)))
  process.once('SIGTERM', () => close().then(() => process.exit(0)))
  return { ...dashboard, close }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runDashboardCLI().catch(error => { process.stderr.write('Experiment dashboard: ' + error.message + '\n'); process.exitCode = 1 })
}
