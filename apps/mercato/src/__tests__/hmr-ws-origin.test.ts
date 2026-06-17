// Regression guard for issue #2446: the dev HMR WebSocket (`/_next/webpack-hmr`)
// must honor the same `allowedDevOrigins` allowlist as HTTP `_next` resources, so
// dev mode is usable behind a reverse proxy / Tailscale host — while still blocking
// cross-site WebSocket hijacking (CSWSH) from non-allowlisted origins.
//
// This exercises Next.js' real `blockCrossSiteDEV` (the function the dev server's
// upgrade handler calls in `next/dist/server/lib/router-server.js`) fed with the
// origins Open Mercato resolves from `APP_URL` / `APP_ALLOWED_ORIGINS`. It is the
// integration point that broke on Next 16.2.6 and is asserted here so a future
// Next bump or helper change cannot silently regress remote dev access.
import { resolveAllowedDevOrigins } from '../lib/dev-origins'

// Deep import into Next internals is deliberate: it makes this test a tripwire for
// changes to the dev-server origin guard. If Next relocates or reshapes this module,
// fail loudly with an actionable message instead of a confusing resolution error so
// the maintainer re-verifies the HMR WebSocket origin handling for #2446.
type BlockCrossSiteDEV = (
  req: { url?: string; headers: Record<string, string | string[] | undefined> },
  res: { end: (body?: string) => void; statusCode?: number },
  allowedDevOrigins: string[] | undefined,
  hostname: string | undefined,
) => boolean

function loadBlockCrossSiteDEV(): BlockCrossSiteDEV {
  const modulePath = 'next/dist/server/lib/router-utils/block-cross-site-dev'
  let mod: { blockCrossSiteDEV?: unknown }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require(modulePath)
  } catch (err) {
    throw new Error(
      `Could not load Next.js dev cross-site guard from "${modulePath}". Next internals moved; ` +
        're-verify the HMR WebSocket origin handling for issue #2446 and update this path. ' +
        `Original error: ${(err as Error).message}`,
    )
  }
  if (typeof mod.blockCrossSiteDEV !== 'function') {
    throw new Error(
      'Next.js no longer exports blockCrossSiteDEV; re-verify the HMR WebSocket origin handling for issue #2446.',
    )
  }
  return mod.blockCrossSiteDEV as BlockCrossSiteDEV
}

// Mirror how `router-server.js` invokes the guard for a WebSocket upgrade:
//   blockCrossSiteDEV(req, socket, development.config.allowedDevOrigins, opts.hostname)
// A `true` return means the upgrade was blocked (socket ended → non-101 response).
function isHmrUpgradeBlocked(options: {
  allowedDevOrigins: string[]
  origin?: string
  hostname?: string
  url?: string
}): boolean {
  const blockCrossSiteDEV = loadBlockCrossSiteDEV()
  const headers: Record<string, string | string[] | undefined> = {}
  if (options.origin !== undefined) headers['origin'] = options.origin
  const req = { url: options.url ?? '/_next/webpack-hmr?page=%2F', headers }
  let ended = false
  const socket = {
    statusCode: undefined as number | undefined,
    end: () => {
      ended = true
    },
  }
  const returnedBlock = blockCrossSiteDEV(req, socket, options.allowedDevOrigins, options.hostname ?? 'localhost')
  return returnedBlock || ended
}

describe('dev HMR WebSocket origin allowlist (issue #2446)', () => {
  const publicHostConfig = {
    APP_URL: 'http://localhost:3000',
    NEXT_PUBLIC_APP_URL: '',
    APP_ALLOWED_ORIGINS: 'https://dev.example.com',
  }

  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    // Next's guard logs a one-time warning when it blocks; keep test output clean.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('allows the HMR upgrade from a public host configured via APP_ALLOWED_ORIGINS', () => {
    const allowedDevOrigins = resolveAllowedDevOrigins(publicHostConfig)
    expect(allowedDevOrigins).toContain('dev.example.com')
    expect(isHmrUpgradeBlocked({ allowedDevOrigins, origin: 'https://dev.example.com' })).toBe(false)
  })

  it('allows the HMR upgrade from localhost and same-host loopback aliases', () => {
    const allowedDevOrigins = resolveAllowedDevOrigins(publicHostConfig)
    expect(isHmrUpgradeBlocked({ allowedDevOrigins, origin: 'http://localhost:3000' })).toBe(false)
    expect(isHmrUpgradeBlocked({ allowedDevOrigins, origin: 'http://127.0.0.1:3000' })).toBe(false)
  })

  it('allows the HMR upgrade when no Origin header is present (same-origin GET)', () => {
    const allowedDevOrigins = resolveAllowedDevOrigins(publicHostConfig)
    expect(isHmrUpgradeBlocked({ allowedDevOrigins, origin: undefined })).toBe(false)
  })

  it('blocks the HMR upgrade from a non-allowlisted origin (CSWSH protection)', () => {
    const allowedDevOrigins = resolveAllowedDevOrigins(publicHostConfig)
    expect(isHmrUpgradeBlocked({ allowedDevOrigins, origin: 'https://evil.example.com' })).toBe(true)
  })

  it('blocks a public host that was never added to the allowlist (reporter failure mode)', () => {
    // No APP_ALLOWED_ORIGINS / APP_URL host configured: the proxied public origin is
    // rejected. This is exactly what remote users saw before configuring the allowlist
    // (and why the Docker dev compose must forward APP_ALLOWED_ORIGINS — see #2449).
    const allowedDevOrigins = resolveAllowedDevOrigins({ APP_URL: '', NEXT_PUBLIC_APP_URL: '', APP_ALLOWED_ORIGINS: '' })
    expect(isHmrUpgradeBlocked({ allowedDevOrigins, origin: 'https://dev.example.com' })).toBe(true)
  })

  it('honors wildcard host patterns for the HMR upgrade', () => {
    const allowedDevOrigins = resolveAllowedDevOrigins({
      APP_URL: '',
      NEXT_PUBLIC_APP_URL: '',
      APP_ALLOWED_ORIGINS: '*.preview.example.com',
    })
    expect(isHmrUpgradeBlocked({ allowedDevOrigins, origin: 'https://pr-42.preview.example.com' })).toBe(false)
    expect(isHmrUpgradeBlocked({ allowedDevOrigins, origin: 'https://preview.example.com' })).toBe(true)
  })
})
