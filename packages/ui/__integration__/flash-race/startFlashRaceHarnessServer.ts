import * as http from 'node:http'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

export type FlashRaceHarnessServer = {
  url: string
  close: () => Promise<void>
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Bundles `harnessApp.tsx` (the real `FlashMessages` component plus its
 * primitive dependencies) into a single browser-ready script and serves it
 * from a throwaway HTTP server. Keeps the two-host race harness out of
 * `apps/mercato` and out of this package's shipped `src/`/`dist` output —
 * it exists only for the duration of the Playwright spec that calls this.
 */
export async function startFlashRaceHarnessServer(): Promise<FlashRaceHarnessServer> {
  const result = await esbuild.build({
    entryPoints: [path.join(moduleDir, 'harnessApp.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    target: 'es2020',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })

  const bundleText = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
  const html = `<!doctype html><html><body><div id="app"></div><script>${bundleText}</script></body></html>`

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
