import { execFileSync } from 'node:child_process'
import { X509Certificate, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebhookVerificationUnavailableError } from '@open-mercato/shared/modules/payment_gateways/types'
import { TPAY_JWS_TRUST, TPAY_KIP_ROOT_CA_SHA256, type TpayJwsTrustConfig } from '../lib/certificates'
import { TPAY_KIP_HA_CA_SHA256, TPAY_PRODUCTION_JWS_ROOT_PEM } from '../lib/certificates/production'
import { TPAY_KIP_SANDBOX_CA_SHA256, TPAY_SANDBOX_JWS_ROOT_PEM } from '../lib/certificates/sandbox'
import {
  fetchTpayCertificatePem,
  resetTpayJwsCache,
  TpayJwsError,
  verifyTpayJws,
  type TpayCertificateFetcher,
  type TpayJwsErrorReason,
} from '../lib/jws'
import type { TpayEnvironment } from '../lib/tpay-client'

const X5U = 'https://secure.sandbox.tpay.com/x509/notifications-jws.pem'
const LEAF_CN = 'notification.sandbox.tpay.com'
const BODY = Buffer.from('id=12345&tr_id=TR-0001&tr_status=TRUE&md5sum=abc', 'utf8')
const DAY_MS = 24 * 60 * 60 * 1000

type Pki = {
  leafPem: string
  leafKey: string
  wrongCnPem: string
  wrongCnKey: string
  foreignLeafPem: string
  foreignLeafKey: string
  otherLeafKey: string
  anchors: string
  rootFingerprint: string
}

let workDir = ''
let pki: Pki

function openssl(args: string[]): void {
  execFileSync('openssl', args, { cwd: workDir, stdio: 'ignore' })
}

function issue(name: string, subject: string, issuer: string | null, extensions: string, days: number): void {
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', subject])
  const signer = issuer ? ['-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`] : ['-signkey', `${name}.key`]
  openssl([
    'x509', '-req', '-in', `${name}.csr`, ...signer, '-set_serial', String(Date.now() % 100000),
    '-days', String(days), '-extfile', 'ext.cnf', '-extensions', extensions, '-sha256', '-out', `${name}.pem`,
  ])
}

function read(name: string): string {
  return readFileSync(join(workDir, name), 'utf8')
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'tpay-jws-'))
  writeFileSync(
    join(workDir, 'ext.cnf'),
    [
      '[ca]',
      'basicConstraints = critical, CA:TRUE',
      'keyUsage = critical, keyCertSign, cRLSign',
      '[leaf]',
      'basicConstraints = critical, CA:FALSE',
      'keyUsage = critical, digitalSignature',
      '',
    ].join('\n'),
  )
  issue('root', '/O=Test/CN=Test Root CA', null, 'ca', 3650)
  issue('intermediate', '/O=Test/CN=Test Sandbox CA', 'root', 'ca', 3650)
  issue('leaf', `/O=Test/CN=${LEAF_CN}`, 'intermediate', 'leaf', 30)
  issue('wrongcn', '/O=Test/CN=attacker.example.com', 'intermediate', 'leaf', 30)
  issue('foreignroot', '/O=Other/CN=Other Root CA', null, 'ca', 3650)
  issue('foreignintermediate', '/O=Other/CN=Other Sandbox CA', 'foreignroot', 'ca', 3650)
  issue('foreignleaf', `/O=Other/CN=${LEAF_CN}`, 'foreignintermediate', 'leaf', 30)
  issue('otherleaf', `/O=Test/CN=${LEAF_CN}`, 'intermediate', 'leaf', 30)
  pki = {
    leafPem: read('leaf.pem'),
    leafKey: read('leaf.key'),
    wrongCnPem: read('wrongcn.pem'),
    wrongCnKey: read('wrongcn.key'),
    foreignLeafPem: read('foreignleaf.pem'),
    foreignLeafKey: read('foreignleaf.key'),
    otherLeafKey: read('otherleaf.key'),
    anchors: `${read('intermediate.pem')}${read('root.pem')}`,
    rootFingerprint: new X509Certificate(read('root.pem')).fingerprint256,
  }
})

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

let currentTime = Date.now()

beforeEach(() => {
  resetTpayJwsCache()
  currentTime = Date.now()
  jest.restoreAllMocks()
})

function trust(): Record<TpayEnvironment, TpayJwsTrustConfig> {
  const sandbox: TpayJwsTrustConfig = {
    x5u: X5U,
    expectedLeafCommonName: LEAF_CN,
    anchors: pki.anchors,
    rootFingerprint256: pki.rootFingerprint,
  }
  return { sandbox, production: { ...sandbox, x5u: 'https://secure.tpay.com/x509/notifications-jws.pem' } }
}

function encodeHeader(header: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(header), 'utf8').toString('base64url')
}

function signJws(
  body: Buffer,
  key: string,
  header: Record<string, unknown> = { alg: 'RS256', x5u: X5U },
): string {
  const protectedSegment = encodeHeader(header)
  const signature = sign('RSA-SHA256', Buffer.from(`${protectedSegment}.${body.toString('base64url')}`), key)
  return `${protectedSegment}..${signature.toString('base64url')}`
}

function fetcherFor(...pems: string[]): jest.Mock<Promise<string>, [string]> {
  const queue = [...pems]
  return jest.fn(async () => queue.shift() ?? pems[pems.length - 1])
}

async function run(header: string, fetchCertificate: TpayCertificateFetcher, body: Buffer = BODY): Promise<void> {
  return verifyTpayJws(
    { header, rawBody: body, environment: 'sandbox', fetchCertificate },
    { trust: trust(), now: () => new Date(currentTime) },
  )
}

async function reasonOf(promise: Promise<void>): Promise<TpayJwsErrorReason | null> {
  try {
    await promise
    return null
  } catch (error) {
    if (error instanceof TpayJwsError) return error.reason
    throw error
  }
}

describe('verifyTpayJws', () => {
  it('accepts a valid detached RS256 signature', async () => {
    const fetchCertificate = fetcherFor(pki.leafPem)
    await expect(run(signJws(BODY, pki.leafKey), fetchCertificate)).resolves.toBeUndefined()
    expect(fetchCertificate).toHaveBeenCalledWith(X5U)
  })

  it('rejects an altered body', async () => {
    const header = signJws(BODY, pki.leafKey)
    const altered = Buffer.from(BODY.toString('utf8').replace('TR-0001', 'TR-0002'), 'utf8')
    expect(await reasonOf(run(header, fetcherFor(pki.leafPem), altered))).toBe('signatureMismatch')
  })

  it('rejects an unsupported algorithm', async () => {
    const header = signJws(BODY, pki.leafKey, { alg: 'HS256', x5u: X5U })
    expect(await reasonOf(run(header, fetcherFor(pki.leafPem)))).toBe('unsupportedAlgorithm')
  })

  it('rejects a critical header', async () => {
    const header = signJws(BODY, pki.leafKey, { alg: 'RS256', x5u: X5U, crit: ['b64'], b64: false })
    expect(await reasonOf(run(header, fetcherFor(pki.leafPem)))).toBe('unsupportedCritical')
  })

  it('rejects a non-empty payload segment', async () => {
    const [protectedSegment, , signature] = signJws(BODY, pki.leafKey).split('.')
    const header = `${protectedSegment}.${BODY.toString('base64url')}.${signature}`
    expect(await reasonOf(run(header, fetcherFor(pki.leafPem)))).toBe('malformed')
  })

  it.each([
    ['empty', ''],
    ['two segments', 'abc.def'],
    ['four segments', 'a..b.c'],
    ['invalid characters', 'ab+c..def'],
    ['non-json header', `${Buffer.from('nope').toString('base64url')}..abc`],
    ['array header', `${Buffer.from('[]').toString('base64url')}..abc`],
    ['missing signature', `${encodeHeader({ alg: 'RS256', x5u: X5U })}..`],
  ])('rejects malformed input: %s', async (_label, header) => {
    expect(await reasonOf(run(header, fetcherFor(pki.leafPem)))).toBe('malformed')
  })

  it.each([
    ['other host', 'https://evil.example.com/x509/notifications-jws.pem'],
    ['production url in sandbox', 'https://secure.tpay.com/x509/notifications-jws.pem'],
    ['other path', 'https://secure.sandbox.tpay.com/x509/other.pem'],
    ['query string', `${X5U}?v=1`],
    ['fragment', `${X5U}#x`],
    ['plain http', 'http://secure.sandbox.tpay.com/x509/notifications-jws.pem'],
    ['user info', 'https://user@secure.sandbox.tpay.com/x509/notifications-jws.pem'],
    ['missing', undefined],
  ])('rejects an untrusted x5u: %s', async (_label, x5u) => {
    const fetchCertificate = fetcherFor(pki.leafPem)
    const header = signJws(BODY, pki.leafKey, { alg: 'RS256', x5u })
    expect(await reasonOf(run(header, fetchCertificate))).toBe('untrustedCertificateUrl')
    expect(fetchCertificate).not.toHaveBeenCalled()
  })

  it('rejects an expired leaf', async () => {
    currentTime = Date.now() + 60 * DAY_MS
    expect(await reasonOf(run(signJws(BODY, pki.leafKey), fetcherFor(pki.leafPem)))).toBe('certificateNotValidNow')
  })

  it('rejects a leaf with an unexpected common name', async () => {
    const header = signJws(BODY, pki.wrongCnKey)
    expect(await reasonOf(run(header, fetcherFor(pki.wrongCnPem)))).toBe('unexpectedCommonName')
  })

  it('rejects a leaf issued by a foreign chain', async () => {
    const header = signJws(BODY, pki.foreignLeafKey)
    expect(await reasonOf(run(header, fetcherFor(pki.foreignLeafPem)))).toBe('untrustedChain')
  })

  it('rejects anchors whose root does not match the pinned fingerprint', async () => {
    const header = signJws(BODY, pki.leafKey)
    const pinned = trust()
    pinned.sandbox = { ...pinned.sandbox, rootFingerprint256: TPAY_KIP_ROOT_CA_SHA256 }
    const result = verifyTpayJws(
      { header, rawBody: BODY, environment: 'sandbox', fetchCertificate: fetcherFor(pki.leafPem) },
      { trust: pinned, now: () => new Date(currentTime) },
    )
    expect(await reasonOf(result)).toBe('untrustedChain')
  })

  it('rejects a certificate response without a certificate', async () => {
    expect(await reasonOf(run(signJws(BODY, pki.leafKey), fetcherFor('not a pem')))).toBe('invalidCertificate')
  })

  it('reuses the cached leaf for subsequent verifications', async () => {
    const fetchCertificate = fetcherFor(pki.leafPem)
    await run(signJws(BODY, pki.leafKey), fetchCertificate)
    await run(signJws(BODY, pki.leafKey), fetchCertificate)
    expect(fetchCertificate).toHaveBeenCalledTimes(1)
  })

  it('refetches after the cache ttl elapses', async () => {
    const fetchCertificate = fetcherFor(pki.leafPem)
    await run(signJws(BODY, pki.leafKey), fetchCertificate)
    currentTime += 61 * 60 * 1000
    await run(signJws(BODY, pki.leafKey), fetchCertificate)
    expect(fetchCertificate).toHaveBeenCalledTimes(2)
  })

  it('refreshes the cached leaf once after a signature failure', async () => {
    const fetchCertificate = fetcherFor(pki.leafPem, read('otherleaf.pem'))
    await run(signJws(BODY, pki.leafKey), fetchCertificate)
    currentTime += 31 * 1000
    await expect(run(signJws(BODY, pki.otherLeafKey), fetchCertificate)).resolves.toBeUndefined()
    expect(fetchCertificate).toHaveBeenCalledTimes(2)
  })

  it('fails after a single refresh when the refreshed leaf still does not match', async () => {
    const fetchCertificate = fetcherFor(pki.leafPem)
    await run(signJws(BODY, pki.leafKey), fetchCertificate)
    currentTime += 31 * 1000
    expect(await reasonOf(run(signJws(BODY, pki.otherLeafKey), fetchCertificate))).toBe('signatureMismatch')
    expect(fetchCertificate).toHaveBeenCalledTimes(2)
  })

  it('does not refetch for a signature failure right after a fetch', async () => {
    const fetchCertificate = fetcherFor(pki.leafPem)
    await run(signJws(BODY, pki.leafKey), fetchCertificate)
    expect(await reasonOf(run(signJws(BODY, pki.otherLeafKey), fetchCertificate))).toBe('signatureMismatch')
    expect(fetchCertificate).toHaveBeenCalledTimes(1)
  })

  it('negative-caches certificate fetch failures for 30 seconds', async () => {
    const fetchCertificate = jest.fn(async () => {
      throw new WebhookVerificationUnavailableError('[internal] down')
    })
    const header = signJws(BODY, pki.leafKey)
    await expect(run(header, fetchCertificate)).rejects.toBeInstanceOf(WebhookVerificationUnavailableError)
    await expect(run(header, fetchCertificate)).rejects.toBeInstanceOf(WebhookVerificationUnavailableError)
    expect(fetchCertificate).toHaveBeenCalledTimes(1)
    currentTime += 31 * 1000
    await expect(run(header, fetchCertificate)).rejects.toBeInstanceOf(WebhookVerificationUnavailableError)
    expect(fetchCertificate).toHaveBeenCalledTimes(2)
  })

  it('maps unexpected fetcher errors to verification unavailable', async () => {
    const fetchCertificate = jest.fn(async (): Promise<string> => {
      throw new Error('boom')
    })
    await expect(run(signJws(BODY, pki.leafKey), fetchCertificate)).rejects.toBeInstanceOf(
      WebhookVerificationUnavailableError,
    )
  })
})

describe('fetchTpayCertificatePem', () => {
  it('fetches with redirects disabled and a timeout signal', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('PEM', { status: 200 }))
    await expect(fetchTpayCertificatePem(X5U)).resolves.toBe('PEM')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(X5U)
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ['timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ['redirect', () => Promise.reject(new TypeError('fetch failed: unexpected redirect'))],
    ['server error', () => Promise.resolve(new Response('oops', { status: 503 }))],
    ['redirect status', () => Promise.resolve(new Response(null, { status: 302 }))],
    [
      'declared oversize',
      () => Promise.resolve(new Response('x', { status: 200, headers: { 'content-length': String(65 * 1024) } })),
    ],
    ['streamed oversize', () => Promise.resolve(new Response('x'.repeat(65 * 1024), { status: 200 }))],
  ])('throws verification unavailable on %s', async (_label, implementation) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(implementation)
    await expect(fetchTpayCertificatePem(X5U)).rejects.toBeInstanceOf(WebhookVerificationUnavailableError)
  })

  it('surfaces fetch failures from verifyTpayJws as verification unavailable', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    const header = signJws(BODY, pki.leafKey)
    await expect(
      verifyTpayJws({ header, rawBody: BODY, environment: 'sandbox' }, { trust: trust() }),
    ).rejects.toBeInstanceOf(WebhookVerificationUnavailableError)
  })
})

describe('bundled Tpay trust anchors', () => {
  function chainOf(pem: string): X509Certificate[] {
    return (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map(
      (block) => new X509Certificate(block),
    )
  }

  it.each([
    ['production', TPAY_PRODUCTION_JWS_ROOT_PEM, TPAY_KIP_HA_CA_SHA256, 'KIP SA HA CA'],
    ['sandbox', TPAY_SANDBOX_JWS_ROOT_PEM, TPAY_KIP_SANDBOX_CA_SHA256, 'KIP SA Sandbox CA'],
  ])('%s anchors parse, chain to the pinned root, and match fingerprints', (environment, pem, caFingerprint, caName) => {
    const [intermediate, root] = chainOf(pem)
    expect(intermediate.fingerprint256).toBe(caFingerprint)
    expect(root.fingerprint256).toBe(TPAY_KIP_ROOT_CA_SHA256)
    expect(intermediate.subject).toContain(`CN=${caName}`)
    expect(root.subject).toContain('CN=KIP SA Root CA')
    expect(intermediate.ca).toBe(true)
    expect(root.ca).toBe(true)
    expect(intermediate.checkIssued(root)).toBe(true)
    expect(intermediate.verify(root.publicKey)).toBe(true)
    expect(root.verify(root.publicKey)).toBe(true)
    const config = TPAY_JWS_TRUST[environment as TpayEnvironment]
    expect(config.anchors).toBe(pem)
    expect(config.rootFingerprint256).toBe(TPAY_KIP_ROOT_CA_SHA256)
  })

  it('pins exact per-environment certificate urls and leaf names', () => {
    expect(TPAY_JWS_TRUST.production.x5u).toBe('https://secure.tpay.com/x509/notifications-jws.pem')
    expect(TPAY_JWS_TRUST.production.expectedLeafCommonName).toBe('notification.tpay.com')
    expect(TPAY_JWS_TRUST.sandbox.x5u).toBe('https://secure.sandbox.tpay.com/x509/notifications-jws.pem')
    expect(TPAY_JWS_TRUST.sandbox.expectedLeafCommonName).toBe('notification.sandbox.tpay.com')
  })
})
