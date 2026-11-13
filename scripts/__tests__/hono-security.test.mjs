import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const requireAssistant = createRequire(new URL('../../packages/ai-assistant/package.json', import.meta.url))
const requireSdk = createRequire(requireAssistant.resolve('@modelcontextprotocol/sdk/server/mcp.js'))
const { Hono } = requireSdk('hono')
const { csrf } = requireSdk('hono/csrf')
const { createCssContext } = requireSdk('hono/css')
const { mount } = requireSdk('hono/mount')
const { validator } = requireSdk('hono/validator')

for (const [middlewarePath, routePath, requestPath] of [
  ['/api/:tenant{[^/]+}/admin/*', '/api/:tenant/admin/:id', '/api/acme/admin/secret'],
  ['/admin/*', '/admin*', '/admin/secret'],
]) {
  test(`Hono applies ${middlewarePath} authorization to ${routePath}`, async () => {
    const app = new Hono()
    app.use(middlewarePath, (context) => context.text('unauthorized', 401))
    app.get(routePath, (context) => context.text('protected'))
    const response = await app.request(requestPath)
    assert.equal(response.status, 401)
  })
}

for (const encodedTerminator of ['%0A', '%0D', '%E2%80%A8', '%E2%80%A9']) {
  test(`Hono applies wildcard authorization before not-found for ${encodedTerminator}`, async () => {
    const app = new Hono()
    app.use('*', (context) => context.text('unauthorized', 401))
    const response = await app.request(`/missing${encodedTerminator}path`)
    assert.equal(response.status, 401)
  })
}

for (const mountApi of ['mount', 'app.mount']) {
  test(`Hono ${mountApi} cannot normalize an unprotected path into a protected route`, async () => {
    const inner = new Hono()
    inner.get('/admin/secret', (context) => context.text('protected'))
    inner.get('/public', (context) => context.text('public'))
    const outer = new Hono()
    outer.use('/app/admin/*', (context) => context.text('unauthorized', 401))
    if (mountApi === 'mount') {
      outer.all('/app/*', mount(inner.fetch))
    } else {
      outer.mount('/app', inner.fetch)
    }
    const crafted = await outer.request('/app/public%5C..%5Cadmin/secret')
    assert.equal(crafted.status, 404)
    const protectedResponse = await outer.request('/app/admin/secret')
    assert.equal(protectedResponse.status, 401)
    const publicResponse = await outer.request('/app/public')
    assert.equal(publicResponse.status, 200)
    assert.equal(await publicResponse.text(), 'public')
  })
}

for (const extraParameters of ['; charset=utf-8', ';  charset=utf-8']) {
  test(`Hono validates multipart fields with extra parameters ${extraParameters}`, async () => {
    const app = new Hono()
    app.post('/form', validator('form', (value, context) => {
      if (value.role === 'admin') return context.text('forbidden', 403)
      return value
    }), async (context) => context.json(await context.req.parseBody()))
    const form = new FormData()
    form.set('role', 'admin')
    const request = new Request('http://localhost/form', { method: 'POST', body: form })
    request.headers.set('content-type', `${request.headers.get('content-type')}${extraParameters}`)
    const response = await app.request(request)
    assert.equal(response.status, 403)
    const allowedForm = new FormData()
    allowedForm.set('role', 'reader')
    const allowed = await app.request('/form', { method: 'POST', body: allowedForm })
    assert.equal(allowed.status, 200)
    assert.deepEqual(await allowed.json(), { role: 'reader' })
  })
}

for (const adjacentValues of [false, true]) {
  test(`Hono escapes a closing style tag split across ${adjacentValues ? 'adjacent values' : 'template and value'}`, () => {
    const { css, Style } = createCssContext({ id: 'security-regression' })
    const suffix = '/style><script>globalThis.injected=true</script>'
    const styles = adjacentValues ? css`content: '${'<'}${suffix}'` : css`content: '<${suffix}'`
    const rendered = String(Style({ children: styles }))
    assert.equal(rendered.match(/<\/style>/gi)?.length, 1)
    const ordinary = String(Style({ children: css`color: ${'blue'}` }))
    assert.match(ordinary, /color:blue/)
  })
}

test('Hono rejects cross-origin hyperlink pings while accepting same-origin requests', async () => {
  const app = new Hono()
  app.use('*', csrf())
  app.post('/action', (context) => context.text('accepted'))
  for (const [origin, expectedStatus] of [['https://attacker.example', 403], ['http://localhost', 200]]) {
    const response = await app.request('/action', {
      method: 'POST',
      headers: { 'content-type': 'text/ping', origin, 'sec-fetch-site': 'cross-site' },
      body: 'PING',
    })
    assert.equal(response.status, expectedStatus)
  }
})

test('Hono preserves ordinary routing, form validation, CSS and same-origin POSTs', async () => {
  const app = new Hono()
  app.use('*', csrf())
  app.get('/public', (context) => context.text('public'))
  app.use('/admin/*', (context) => context.text('unauthorized', 401))
  app.get('/admin/secret', (context) => context.text('protected'))
  app.post('/form', validator('form', (value) => value),
    (context) => context.json(context.req.valid('form')))
  assert.equal((await app.request('/public')).status, 200)
  assert.equal((await app.request('/admin/secret')).status, 401)
  const form = new FormData()
  form.set('role', 'reader')
  const response = await app.request('/form', {
    method: 'POST', body: form, headers: { origin: 'http://localhost' },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { role: 'reader' })
  const { css, Style } = createCssContext({ id: 'ordinary-style' })
  assert.match(String(Style({ children: css`color: ${'blue'}` })), /color:blue/)
})
