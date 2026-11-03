import { createServer as createHttpServer, request as sendHttp, type IncomingHttpHeaders, type Server } from 'node:http'
import { connect as netConnect, createServer as createTcpServer, isIP, type AddressInfo, type Socket } from 'node:net'
import type { LookupFn } from '@open-mercato/web-research'
import { pinnedConnect, startEgressProxy, type EgressDialTarget, type EgressProxy } from '../egressProxy'

const PUBLIC_IP = '93.184.216.34'
const RESET_IP = '93.184.216.35'
const DEAD_IP = '93.184.216.36'
const MALFORMED_IP = '93.184.216.37'
const PUBLIC_IPV6 = '2606:2800:220:1:248:1893:25c8:1946'
const PUBLIC_6TO4 = '2002:808:808::1'

type Recorded = { host: string | undefined; url: string | undefined; headers: IncomingHttpHeaders }

type Harness = {
  proxy: EgressProxy
  proxyPort: number
  dials: EgressDialTarget[]
  privateConnections: () => number
  publicRequests: Recorded[]
  publicSockets: Set<Socket>
  flipAnswers: string[]
}

const servers: Server[] = []
const tcpServers: Array<ReturnType<typeof createTcpServer>> = []
let harness: Harness

async function listen(server: Server | ReturnType<typeof createTcpServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  return (server.address() as AddressInfo).port
}

function closeAll(): Promise<void[]> {
  const closing = [...servers, ...tcpServers].map(
    (server) =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  )
  servers.length = 0
  tcpServers.length = 0
  return Promise.all(closing)
}

async function buildHarness(): Promise<Harness> {
  let privateHits = 0
  const privateServer = createTcpServer((socket) => {
    privateHits += 1
    socket.on('error', () => undefined)
    socket.end('HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nSECRET')
  })
  tcpServers.push(privateServer)
  const privatePort = await listen(privateServer)

  const publicRequests: Recorded[] = []
  const publicSockets = new Set<Socket>()
  const publicServer = createHttpServer((req, res) => {
    publicRequests.push({ host: req.headers.host, url: req.url, headers: req.headers })
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://private.test/secret' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`public:${req.url}`)
  })
  publicServer.on('connection', (socket) => {
    publicSockets.add(socket)
    socket.once('close', () => publicSockets.delete(socket))
  })
  servers.push(publicServer)
  const publicPort = await listen(publicServer)

  const resetServer = createTcpServer((socket) => {
    socket.on('error', () => undefined)
    socket.resetAndDestroy()
  })
  tcpServers.push(resetServer)
  const resetPort = await listen(resetServer)

  const malformedServer = createTcpServer((socket) => {
    socket.on('error', () => undefined)
    let head = ''
    socket.on('data', (chunk: Buffer) => {
      head += chunk.toString('latin1')
      if (!head.includes('\r\n\r\n')) return
      const statusLine = head.startsWith('GET /low-status') ? 'HTTP/1.1 099 X' : 'HTTP/1.1 200 O\x01K'
      socket.end(`${statusLine}\r\nContent-Length: 2\r\n\r\nok`)
    })
  })
  tcpServers.push(malformedServer)
  const malformedPort = await listen(malformedServer)

  const deadServer = createTcpServer()
  const deadPort = await listen(deadServer)
  await new Promise<void>((resolve) => deadServer.close(() => resolve()))

  const flipAnswers: string[] = []
  const table: Record<string, string> = {
    'public.test': PUBLIC_IP,
    'redirect.test': PUBLIC_IP,
    'private.test': '10.0.0.5',
    'metadata.test': '169.254.169.254',
    'local-translation.test': '64:ff9b:1::a00:1',
    'private-6to4.test': '2002:a00:1::1',
    'reset.test': RESET_IP,
    'dead.test': DEAD_IP,
    'malformed.test': MALFORMED_IP,
    'under_score.test': PUBLIC_IP,
  }
  const lookup: LookupFn = async (hostname) => {
    if (hostname === 'flip.test') {
      const address = flipAnswers.shift()
      if (!address) throw new Error('no answer')
      return [{ address, family: isIP(address) }]
    }
    const address = table[hostname]
    if (!address) throw new Error(`ENOTFOUND ${hostname}`)
    return [{ address, family: isIP(address) }]
  }

  const dials: EgressDialTarget[] = []
  const portFor = (addresses: readonly string[]): number => {
    if (addresses.length === 1 && [PUBLIC_IP, PUBLIC_IPV6, PUBLIC_6TO4].includes(addresses[0])) return publicPort
    if (addresses.length === 1 && addresses[0] === RESET_IP) return resetPort
    if (addresses.length === 1 && addresses[0] === DEAD_IP) return deadPort
    if (addresses.length === 1 && addresses[0] === MALFORMED_IP) return malformedPort
    return privatePort
  }
  const proxy = await startEgressProxy({
    lookup,
    connect: (target) => {
      dials.push(target)
      return netConnect({ host: '127.0.0.1', port: portFor(target.addresses) })
    },
  })
  return {
    proxy,
    proxyPort: Number(new URL(proxy.url).port),
    dials,
    privateConnections: () => privateHits,
    publicRequests,
    publicSockets,
    flipAnswers,
  }
}

type ConnectResult = { status: number; socket: Socket }

function openConnect(authority: string): Promise<ConnectResult> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: '127.0.0.1', port: harness.proxyPort })
    let buffered = ''
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString('latin1')
      const end = buffered.indexOf('\r\n\r\n')
      if (end === -1) return
      socket.removeListener('data', onData)
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(buffered)?.[1] ?? 0)
      resolve({ status, socket })
    }
    socket.on('data', onData)
    socket.on('error', reject)
    socket.once('close', () => resolve({ status: Number(/^HTTP\/1\.1 (\d{3})/.exec(buffered)?.[1] ?? 0), socket }))
    socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)
  })
}

async function connectStatus(authority: string): Promise<number> {
  const { status, socket } = await openConnect(authority)
  socket.destroy()
  return status
}

function readAll(socket: Socket): Promise<string> {
  return new Promise((resolve) => {
    let text = ''
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
    })
    socket.once('close', () => resolve(text))
  })
}

type ProxiedResponse = { status: number; headers: IncomingHttpHeaders; body: string }

function proxiedRequest(path: string, headers: Record<string, string> = {}): Promise<ProxiedResponse> {
  return new Promise((resolve, reject) => {
    const request = sendHttp(
      { host: '127.0.0.1', port: harness.proxyPort, path, method: 'GET', headers, agent: false },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          body += chunk
        })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }))
      },
    )
    request.on('error', reject)
    request.end()
  })
}

describe('browser egress proxy (#7218)', () => {
  beforeEach(async () => {
    harness = await buildHarness()
  })

  afterEach(async () => {
    expect(harness.privateConnections()).toBe(0)
    await harness.proxy.close()
    await closeAll()
  })

  it('refuses a CONNECT to a host that resolves privately without dialling it', async () => {
    expect(await connectStatus('private.test:443')).toBe(403)
    expect(await connectStatus('metadata.test:80')).toBe(403)
    expect(harness.dials).toEqual([])
  })

  it.each([
    '[::1]:443',
    '[::ffff:127.0.0.1]:443',
    '127.0.0.1:443',
    '169.254.169.254:80',
    'localhost:443',
    '0x7f.1:443',
  ])('refuses the private literal %s without dialling it', async (authority) => {
    expect(await connectStatus(authority)).toBe(403)
    expect(harness.dials).toEqual([])
  })

  it.each([
    '[64:ff9b:1::a00:1]',
    '[2002:a00:1::1]',
    'local-translation.test',
    'private-6to4.test',
  ])('refuses CONNECT and HTTP egress to %s before dialling', async (host) => {
    expect(await connectStatus(`${host}:443`)).toBe(403)
    expect((await proxiedRequest(`http://${host}/secret`)).status).toBe(403)
    expect(harness.dials).toEqual([])
  })

  it.each(['a@b:1', 'public.test', 'public.test:0', 'public.test:70000', '[::1:443', 'public.test:443/x'])(
    'answers the malformed authority %s with 400',
    async (authority) => {
      expect(await connectStatus(authority)).toBe(400)
      expect(harness.dials).toEqual([])
    },
  )

  it('tunnels a public CONNECT to exactly the vetted address', async () => {
    const { status, socket } = await openConnect('public.test:443')
    expect(status).toBe(200)
    expect(harness.dials).toEqual([{ host: 'public.test', port: 443, addresses: [PUBLIC_IP] }])

    const received = readAll(socket)
    socket.write('GET /tunnel HTTP/1.1\r\nHost: public.test\r\nConnection: close\r\n\r\n')
    expect(await received).toContain('public:/tunnel')
  })

  it('dials port 80 when the CONNECT authority names it', async () => {
    const { status, socket } = await openConnect('public.test:80')
    socket.destroy()
    expect(status).toBe(200)
    expect(harness.dials[0]?.port).toBe(80)
  })

  it.each([PUBLIC_IPV6, PUBLIC_6TO4])('dials public IPv6 %s through the pinned dial', async (address) => {
    const { status, socket } = await openConnect(`[${address}]:443`)
    socket.destroy()
    expect(status).toBe(200)
    expect(harness.dials).toEqual([{ host: address, port: 443, addresses: [address] }])
  })

  it('re-resolves every connection, so a host that turns private is refused', async () => {
    harness.flipAnswers.push(PUBLIC_IP, '127.0.0.1')

    const first = await openConnect('flip.test:443')
    first.socket.destroy()
    expect(first.status).toBe(200)
    expect(await connectStatus('flip.test:443')).toBe(403)
    expect(harness.dials).toHaveLength(1)
  })

  it('proxies an absolute-form public GET with the vetted Host and no proxy or hop-by-hop headers', async () => {
    const response = await proxiedRequest('http://public.test/hello?q=1', {
      host: 'evil.internal',
      'proxy-authorization': 'Basic c2VjcmV0',
      connection: 'keep-alive, x-hop',
      'x-hop': 'drop-me',
      'x-keep': 'kept',
    })

    expect(response.status).toBe(200)
    expect(response.body).toBe('public:/hello?q=1')
    expect(harness.dials).toEqual([{ host: 'public.test', port: 80, addresses: [PUBLIC_IP] }])
    const seen = harness.publicRequests[0]
    expect(seen?.host).toBe('public.test')
    expect(seen?.headers['proxy-authorization']).toBeUndefined()
    expect(seen?.headers['x-hop']).toBeUndefined()
    expect(seen?.headers['x-keep']).toBe('kept')
  })

  it('refuses an absolute-form GET to a private target', async () => {
    expect((await proxiedRequest('http://private.test/secret')).status).toBe(403)
    expect((await proxiedRequest('http://127.0.0.1:5432/')).status).toBe(403)
    expect((await proxiedRequest('http://[::1]/')).status).toBe(403)
    expect(harness.dials).toEqual([])
  })

  it('re-vets a redirect hop followed as a new request', async () => {
    const redirect = await proxiedRequest('http://redirect.test/redirect')
    expect(redirect.status).toBe(302)
    const location = String(redirect.headers.location)
    expect(location).toBe('http://private.test/secret')

    expect((await proxiedRequest(location)).status).toBe(403)
    expect(harness.dials).toHaveLength(1)
  })

  it('answers an origin-form request with 400', async () => {
    expect((await proxiedRequest('/hello')).status).toBe(400)
    expect(harness.dials).toEqual([])
  })

  it('refuses an absolute-form request that asks for a protocol upgrade', async () => {
    const response = await proxiedRequest('http://public.test/socket', {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-version': '13',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    })

    expect(response.status).toBe(400)
    expect(harness.dials).toEqual([])
    expect(harness.publicRequests).toEqual([])
  })

  it('answers 502 when the vetted address cannot be reached', async () => {
    expect(await connectStatus('dead.test:443')).toBe(502)
    expect((await proxiedRequest('http://dead.test/')).status).toBe(502)
  })

  it('survives an upstream reset', async () => {
    const tunnel = await openConnect('reset.test:443')
    const closed = new Promise<void>((resolve) => tunnel.socket.once('close', () => resolve()))
    tunnel.socket.on('error', () => undefined)
    await closed

    expect((await proxiedRequest('http://reset.test/')).status).toBe(502)
    expect((await proxiedRequest('http://public.test/after')).status).toBe(200)
  })

  it('drops a reason phrase with control bytes instead of crashing on it', async () => {
    const response = await proxiedRequest('http://malformed.test/bad-reason')
    expect(response.status).toBe(200)
    expect(response.body).toBe('ok')
    expect((await proxiedRequest('http://public.test/after')).status).toBe(200)
  })

  it('answers 502 instead of crashing when an upstream sends a status below 200', async () => {
    const outcome = await proxiedRequest('http://malformed.test/low-status').then(
      (response) => response.status,
      () => 'closed',
    )
    expect([502, 'closed']).toContain(outcome)
    expect((await proxiedRequest('http://public.test/after')).status).toBe(200)
  })

  it('accepts an underscore in a CONNECT hostname and still vets it', async () => {
    const { status, socket } = await openConnect('under_score.test:443')
    socket.destroy()
    expect(status).toBe(200)
    expect(harness.dials).toEqual([{ host: 'under_score.test', port: 443, addresses: [PUBLIC_IP] }])
  })

  it('tears down live tunnels on close', async () => {
    const tunnel = await openConnect('public.test:443')
    expect(tunnel.status).toBe(200)
    tunnel.socket.on('error', () => undefined)
    const clientClosed = new Promise<void>((resolve) => tunnel.socket.once('close', () => resolve()))

    await harness.proxy.close()
    await clientClosed

    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(harness.publicSockets.size).toBe(0)
    await expect(
      new Promise((resolve, reject) => {
        const probe = netConnect({ host: '127.0.0.1', port: harness.proxyPort })
        probe.once('connect', () => {
          probe.destroy()
          resolve('connected')
        })
        probe.once('error', reject)
      }),
    ).rejects.toThrow(/ECONNREFUSED/)
  })
})

describe('pinned dial and vetting limits (#7218)', () => {
  it('connects the default dial to the vetted address without resolving the hostname', async () => {
    const target = createTcpServer((socket) => socket.end())
    const port = await listen(target)
    try {
      const socket = pinnedConnect({ host: 'pinned.invalid', port, addresses: ['127.0.0.1'] })
      const remote = await new Promise<string | undefined>((resolve, reject) => {
        socket.once('connect', () => resolve(socket.remoteAddress))
        socket.once('error', reject)
      })
      socket.destroy()
      expect(remote).toBe('127.0.0.1')
    } finally {
      await new Promise<void>((resolve) => target.close(() => resolve()))
    }
  })

  it('fails the default dial when nothing was vetted instead of falling back to DNS', async () => {
    const socket = pinnedConnect({ host: 'localhost', port: 9, addresses: [] })
    await expect(
      new Promise((resolve, reject) => {
        socket.once('connect', () => resolve('connected'))
        socket.once('error', reject)
      }),
    ).rejects.toThrow(/No pinned address/)
    socket.destroy()
  })

  it('refuses a connection whose name cannot be vetted in time', async () => {
    const dials: EgressDialTarget[] = []
    const proxy = await startEgressProxy({
      vetTimeoutMs: 50,
      lookup: () => new Promise(() => undefined),
      connect: (dialTarget) => {
        dials.push(dialTarget)
        return netConnect({ host: '127.0.0.1', port: 9 })
      },
    })
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const socket = netConnect({ host: '127.0.0.1', port: Number(new URL(proxy.url).port) })
        let buffered = ''
        socket.on('data', (chunk: Buffer) => {
          buffered += chunk.toString('latin1')
        })
        socket.once('close', () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(buffered)?.[1] ?? 0)))
        socket.on('error', reject)
        socket.write('CONNECT slow.test:443 HTTP/1.1\r\nHost: slow.test:443\r\n\r\n')
      })
      expect(status).toBe(504)
      expect(dials).toEqual([])
    } finally {
      await proxy.close()
    }
  })

  it('does not dial for a client that left while its destination was being vetted', async () => {
    const dials: EgressDialTarget[] = []
    let answer: (records: Array<{ address: string; family: number }>) => void = () => undefined
    let lookupStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      lookupStarted = resolve
    })
    const proxy = await startEgressProxy({
      lookup: () =>
        new Promise((resolve) => {
          answer = resolve
          lookupStarted()
        }),
      connect: (dialTarget) => {
        dials.push(dialTarget)
        return netConnect({ host: '127.0.0.1', port: 9 })
      },
    })
    try {
      const client = netConnect({ host: '127.0.0.1', port: Number(new URL(proxy.url).port) })
      client.on('error', () => undefined)
      client.write('CONNECT leaving.test:443 HTTP/1.1\r\nHost: leaving.test:443\r\n\r\n')
      await started
      const clientClosed = new Promise<void>((resolve) => client.once('close', () => resolve()))
      client.destroy()
      await clientClosed
      await new Promise((resolve) => setTimeout(resolve, 20))
      answer([{ address: PUBLIC_IP, family: 4 }])
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(dials).toEqual([])
    } finally {
      await proxy.close()
    }
  })
})
