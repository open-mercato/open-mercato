import path from 'node:path'

jest.mock('@open-mercato/telemetry/nextjs-config', () => ({ telemetryServerExternalPackages: [] }), { virtual: true })

type HeaderEntry = { key: string; value: string }
type HeaderRule = { source: string; headers: HeaderEntry[] }
type LoadedNextConfig = { headers: () => Promise<HeaderRule[]> }

const configFiles = {
  app: path.resolve(__dirname, '../../next.config.ts'),
  template: path.resolve(__dirname, '../../../../packages/create-app/template/next.config.ts'),
}

async function loadHeaderRules(configFile: string, nodeEnv: string): Promise<HeaderRule[]> {
  const previousNodeEnv = process.env.NODE_ENV
  const mutableEnv = process.env as Record<string, string | undefined>
  mutableEnv.NODE_ENV = nodeEnv
  try {
    let loaded: LoadedNextConfig | undefined
    jest.isolateModules(() => {
      const configModule = require(configFile) as { default: LoadedNextConfig }
      loaded = configModule.default
    })
    if (!loaded) throw new Error('[internal] next.config did not load')
    return await loaded.headers()
  } finally {
    mutableEnv.NODE_ENV = previousNodeEnv
  }
}

function findHeader(rules: HeaderRule[], source: string, key: string): string | undefined {
  const rule = rules.find((entry) => entry.source === source)
  return rule?.headers.find((header) => header.key === key)?.value
}

function frameAncestorsOf(rules: HeaderRule[]): string | undefined {
  const csp = findHeader(rules, '/:path*', 'Content-Security-Policy') ?? ''
  return csp
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('frame-ancestors'))
}

describe.each(Object.entries(configFiles))('%s next.config frame headers', (_label, configFile) => {
  it('lets loopback origins frame the app in development without X-Frame-Options', async () => {
    const rules = await loadHeaderRules(configFile, 'development')

    expect(frameAncestorsOf(rules)).toBe("frame-ancestors 'self' http://localhost:* http://127.0.0.1:*")
    expect(findHeader(rules, '/:path*', 'X-Frame-Options')).toBeUndefined()
    expect(findHeader(rules, '/:path*', 'X-Content-Type-Options')).toBe('nosniff')
  })

  it('keeps same-origin framing and X-Frame-Options in production', async () => {
    const rules = await loadHeaderRules(configFile, 'production')

    expect(frameAncestorsOf(rules)).toBe("frame-ancestors 'self'")
    expect(findHeader(rules, '/:path*', 'X-Frame-Options')).toBe('SAMEORIGIN')
  })

  it.each(['development', 'production'])('keeps the attachment download sandbox in %s', async (nodeEnv) => {
    const rules = await loadHeaderRules(configFile, nodeEnv)

    expect(findHeader(rules, '/api/attachments/file/:path*', 'Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    expect(findHeader(rules, '/api/attachments/file/:path*', 'X-Frame-Options')).toBe('SAMEORIGIN')
  })
})
