import * as http from 'node:http'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const ENTRY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'flashHandoverHarnessEntry.tsx')

const HTML_SHELL = (bundledScript: string) => `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <div id="root"></div>
    <script>${bundledScript}</script>
  </body>
</html>`

export type FlashHandoverHarnessServer = {
  url: string
  close: () => Promise<void>
}

/**
 * Bundles the test-only harness entry with esbuild and serves it from an
 * ephemeral local HTTP server, so Playwright can `page.goto()` a real URL
 * (exercising the same `history.replaceState`/query-param flow the real app
 * uses) without needing a running Next.js app or a shipped route.
 */
export async function serveFlashHandoverHarness(): Promise<FlashHandoverHarnessServer> {
  const bundle = await esbuild.build({
    entryPoints: [ENTRY_FILE],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    target: 'es2020',
  })
  const bundledScript = bundle.outputFiles[0].text

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(HTML_SHELL(bundledScript))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('[internal] Failed to determine ephemeral port for the FlashMessages test harness server')
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    }),
  }
}
