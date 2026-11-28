const { readFileSync } = require('node:fs')
const { createServer } = require('node:http')
const { join } = require('node:path')

const config = JSON.parse(readFileSync(join(__dirname, 'vercel.json'), 'utf8'))
const legacyHost = 'docs.openmercato.com'
const redirects = new Map(
  config.redirects
    .filter((route) => route.has?.some((rule) => rule.type === 'host' && rule.value === legacyHost))
    .map((route) => [route.source.replace(/\{\/\}\?$/, ''), route.destination])
)

function findRedirect(host, requestTarget) {
  if (host?.split(':')[0].toLowerCase() !== legacyHost) return null
  const queryStart = requestTarget.indexOf('?')
  const path = queryStart === -1 ? requestTarget : requestTarget.slice(0, queryStart)
  const source = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  const destination = redirects.get(source)
  if (!destination) return null
  return queryStart === -1 ? destination : destination + requestTarget.slice(queryStart)
}

function createDocsServer(serveStatic) {
  return createServer((req, res) => {
    const destination = findRedirect(req.headers.host, req.url)
    if (destination) {
      res.writeHead(308, { Location: destination })
      res.end()
      return
    }
    return serveStatic(req, res, {
      public: join(__dirname, 'build'),
      rewrites: [{ source: '**', destination: '/index.html' }],
    })
  })
}

if (require.main === module) {
  createDocsServer(require('serve-handler')).listen(Number(process.env.PORT || 4000))
}

module.exports = { createDocsServer, findRedirect }
