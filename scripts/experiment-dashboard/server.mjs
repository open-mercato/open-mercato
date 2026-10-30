import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadExperiment, loadCaseDetail } from './adapters.mjs'
import { experimentSummary, MAX_JSON_BYTES } from './model.mjs'

const STATIC = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/app.css', ['app.css', 'text/css; charset=utf-8']], ['/foundation.css', ['foundation.css', 'text/css; charset=utf-8']]])
export async function startDashboardServer({ experiments, port = 8768, assetsDir } = {}) {
  if (!Array.isArray(experiments) || experiments.length === 0 || experiments.length > 32 || experiments.some(root => typeof root !== 'string' || !root)) throw new Error('Register between 1 and 32 experiment directories')
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid dashboard port')
  const roots = [...new Set(await Promise.all(experiments.map(async root => { try { const absolute = path.resolve(root); return (await fs.lstat(absolute)).isSymbolicLink() ? absolute : await fs.realpath(absolute) } catch { return path.resolve(root) } })))]
  const assets = assetsDir ? path.resolve(assetsDir) : null
  let url
  function send(response, status, body, type = 'application/json; charset=utf-8') {
    response.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" })
    response.end(body)
  }
  const server = http.createServer(async (request, response) => {
    try {
      const localPort = server.address().port
      const hosts = new Set(['127.0.0.1:' + localPort, 'localhost:' + localPort])
      const origins = new Set(['http://127.0.0.1:' + localPort, 'http://localhost:' + localPort])
      const rawPath = request.url.split('?')[0]
      const documentNavigation = request.method === 'GET' && ['/', '/index.html'].includes(rawPath) && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document'
      if (!hosts.has(request.headers.host) || request.headers.origin && !origins.has(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site' && !documentNavigation) return send(response, 403, '{"error":"Local same-origin requests only"}')
      if (request.method !== 'GET') return send(response, 405, '{"error":"Read-only dashboard"}')
      let segments
      try { segments = rawPath.slice(1).split('/').map(segment => decodeURIComponent(segment)) } catch { return send(response, 400, '{"error":"Invalid URL encoding"}') }
      if (segments[0] === 'api' && segments[1] === 'experiments') {
        const runs = await Promise.all(roots.map(root => loadExperiment(root)))
        if (segments.length === 2) return send(response, 200, JSON.stringify({ experiments: runs.map(experimentSummary), updatedAt: new Date().toISOString() }))
        const index = runs.findIndex(run => run.id === segments[2])
        if (index < 0) return send(response, 404, '{"error":"Experiment is not registered"}')
        if (segments.length === 3) return send(response, 200, JSON.stringify(runs[index]))
        if (segments.length === 5 && segments[3] === 'cases') {
          const query = new URL(request.url, url).searchParams
          if (!query.has('lane')) return send(response, 400, '{"error":"A lane is required"}')
          const detail = await loadCaseDetail(roots[index], segments[4], query.get('lane'))
          return detail ? send(response, 200, JSON.stringify(detail)) : send(response, 404, '{"error":"Case or lane is unavailable"}')
        }
      }
      const asset = STATIC.get(rawPath)
      if (!asset || !assets) return send(response, 404, '{"error":"Not found"}')
      const file = path.join(assets, asset[0])
      const stat = await fs.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES * 4) return send(response, 404, '{"error":"Asset unavailable"}')
      return send(response, 200, await fs.readFile(file), asset[1])
    } catch (error) {
      if (response.headersSent) return response.end()
      return send(response, error.code === 'ENOENT' ? 404 : 503, JSON.stringify({ error: error.code === 'ENOENT' ? 'Data unavailable' : 'Experiment data is temporarily unavailable' }))
    }
  })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  url = 'http://127.0.0.1:' + server.address().port + '/'
  return { url, server, close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() }) }
}
