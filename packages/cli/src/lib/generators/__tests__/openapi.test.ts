import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { generateOpenApi } from '../openapi'

describe('resolveOpenApiGeneratorProjectRoot', () => {
  it('resolves the monorepo root from a POSIX module URL', async () => {
    const { resolveOpenApiGeneratorProjectRoot } = await import('../openapi-paths')

    expect(
      resolveOpenApiGeneratorProjectRoot(
        'file:///Users/test/open-mercato/packages/cli/src/lib/generators/openapi.ts',
        { windows: false },
      )
    ).toBe('/Users/test/open-mercato')
  })

  it('resolves the monorepo root from a Windows module URL', async () => {
    const { resolveOpenApiGeneratorProjectRoot } = await import('../openapi-paths')

    expect(
      resolveOpenApiGeneratorProjectRoot(
        'file:///C:/open-mercato/packages/cli/src/lib/generators/openapi.ts',
        { windows: true }
      )
    ).toBe('C:\\open-mercato')
  })

  it('resolves Windows module URLs with POSIX separators when windows is false', async () => {
    const { resolveOpenApiGeneratorProjectRoot } = await import('../openapi-paths')

    expect(
      resolveOpenApiGeneratorProjectRoot(
        'file:///C:/open-mercato/packages/cli/src/lib/generators/openapi.ts',
        { windows: false }
      )
    ).toBe('/C:/open-mercato')
  })
})

describe('generateOpenApi', () => {
  let tmpDir: string

  const sharedGeneratorSource = `
export function buildOpenApiDocument(modules: any[], options: any) {
  const paths: Record<string, any> = {}
  for (const module of modules) {
    for (const api of module.apis ?? []) {
      const methods: Record<string, any> = {}
      for (const [method, spec] of Object.entries(api.handlers.openApi ?? {})) {
        methods[method.toLowerCase()] = spec
      }
      paths[api.path.replace(/\\[([^\\]]+)\\]/g, '{$1}')] = methods
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: options.title, version: options.version, description: options.description },
    servers: options.servers,
    paths,
  }
}
`

  function touchFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
  }

  function createMockResolver(enabled: ModuleEntry[]): PackageResolver {
    const outputDir = path.join(tmpDir, 'output', 'generated')
    fs.mkdirSync(outputDir, { recursive: true })

    return {
      isMonorepo: () => true,
      getRootDir: () => tmpDir,
      getAppDir: () => path.join(tmpDir, 'app'),
      getOutputDir: () => outputDir,
      getModulesConfigPath: () => path.join(tmpDir, 'app', 'src', 'modules.ts'),
      discoverPackages: () => [],
      loadEnabledModules: () => enabled,
      getModulePaths: (entry: ModuleEntry) => ({
        appBase: path.join(tmpDir, 'app', 'src', 'modules', entry.id),
        pkgBase: path.join(tmpDir, 'packages', 'core', 'src', 'modules', entry.id),
      }),
      getModuleImportBase: (entry: ModuleEntry) => ({
        appBase: `@/modules/${entry.id}`,
        pkgBase: `@open-mercato/core/modules/${entry.id}`,
      }),
      getPackageOutputDir: () => outputDir,
      getPackageRoot: (from?: string) => {
        if (!from || from === '@open-mercato/core') {
          return path.join(tmpDir, 'packages', 'core')
        }
        return path.join(tmpDir, 'packages', from.replace('@open-mercato/', ''))
      },
    }
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-generator-test-'))
    touchFile(
      path.join(tmpDir, 'packages', 'shared', 'src', 'lib', 'openapi', 'generator.ts'),
      sharedGeneratorSource,
    )
    touchFile(path.join(tmpDir, 'package.json'), '{"private":true}\n')
    touchFile(path.join(tmpDir, 'yarn.lock'), '# test lockfile\n')
    touchFile(path.join(tmpDir, 'app', 'package.json'), '{"private":true}\n')
    touchFile(path.join(tmpDir, 'app', 'tsconfig.json'), '{"compilerOptions":{}}\n')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('lets app route files override package route files while preserving package-only routes', async () => {
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'demo', 'api', 'health', 'route.ts'),
      [
        'export async function GET() { return new Response("pkg-health") }',
        'export const openApi = {',
        "  GET: { summary: 'package health' }",
        '}',
        '',
      ].join('\n'),
    )
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'demo', 'api', 'details', 'route.ts'),
      [
        'export async function GET() { return new Response("pkg-details") }',
        'export const openApi = {',
        "  GET: { summary: 'package details' }",
        '}',
        '',
      ].join('\n'),
    )
    touchFile(
      path.join(tmpDir, 'app', 'src', 'modules', 'demo', 'api', 'health', 'route.ts'),
      [
        'export async function GET() { return new Response("app-health") }',
        'export const openApi = {',
        "  GET: { summary: 'app health' }",
        '}',
        '',
      ].join('\n'),
    )

    const resolver = createMockResolver([{ id: 'demo', from: '@open-mercato/core' }])
    const result = await generateOpenApi({ resolver, quiet: true })

    expect(result.errors).toEqual([])

    const generatedPath = path.join(tmpDir, 'output', 'generated', 'openapi.generated.json')
    const openApiDoc = JSON.parse(fs.readFileSync(generatedPath, 'utf8')) as {
      paths: Record<string, { get?: { summary?: string } }>
    }

    expect(openApiDoc.paths['/api/demo/health']?.get?.summary).toBe('app health')
    expect(openApiDoc.paths['/api/demo/details']?.get?.summary).toBe('package details')
  })

  it('skips route discovery and bundling when all tracked inputs are unchanged', async () => {
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'demo', 'api', 'health', 'route.ts'),
      [
        'export async function GET() { return new Response("ok") }',
        "export const openApi = { GET: { summary: 'health' } }",
        '',
      ].join('\n'),
    )
    const resolver = createMockResolver([{ id: 'demo', from: '@open-mercato/core' }])

    await generateOpenApi({ resolver, quiet: true })
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    const result = await generateOpenApi({ resolver, quiet: false })

    const generatedPath = path.join(tmpDir, 'output', 'generated', 'openapi.generated.json')
    expect(result.filesWritten).toEqual([])
    expect(result.filesUnchanged).toEqual([generatedPath])
    expect(consoleSpy).toHaveBeenCalledWith(`[OpenAPI] Skipped (inputs unchanged): ${generatedPath}`)
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('[OpenAPI] Found'))
    consoleSpy.mockRestore()
  })

  it('invalidates the early cache when a transitive route dependency changes', async () => {
    const moduleRoot = path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'demo')
    const schemaPath = path.join(moduleRoot, 'schema.ts')
    touchFile(schemaPath, "export const summary = 'first schema'\n")
    touchFile(
      path.join(moduleRoot, 'api', 'health', 'route.ts'),
      [
        "import { summary } from '../../schema'",
        'export async function GET() { return new Response("ok") }',
        'export const openApi = { GET: { summary } }',
        '',
      ].join('\n'),
    )
    const resolver = createMockResolver([{ id: 'demo', from: '@open-mercato/core' }])
    await generateOpenApi({ resolver, quiet: true })

    touchFile(schemaPath, "export const summary = 'second schema'\n")
    const result = await generateOpenApi({ resolver, quiet: true })
    const generatedPath = path.join(tmpDir, 'output', 'generated', 'openapi.generated.json')
    const openApiDoc = JSON.parse(fs.readFileSync(generatedPath, 'utf8')) as {
      paths: Record<string, { get?: { summary?: string } }>
    }

    expect(result.filesWritten).toEqual([generatedPath])
    expect(openApiDoc.paths['/api/demo/health']?.get?.summary).toBe('second schema')
  })

  it('invalidates the early cache when enabled modules change', async () => {
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'first', 'api', 'route.ts'),
      "export async function GET() {}\nexport const openApi = { GET: { summary: 'first' } }\n",
    )
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'second', 'api', 'route.ts'),
      "export async function GET() {}\nexport const openApi = { GET: { summary: 'second' } }\n",
    )
    let enabled: ModuleEntry[] = [{ id: 'first', from: '@open-mercato/core' }]
    const delegate = createMockResolver(enabled)
    const resolver: PackageResolver = {
      ...delegate,
      loadEnabledModules: () => enabled,
    }
    await generateOpenApi({ resolver, quiet: true })

    enabled = [{ id: 'second', from: '@open-mercato/core' }]
    await generateOpenApi({ resolver, quiet: true })
    const generatedPath = path.join(tmpDir, 'output', 'generated', 'openapi.generated.json')
    const openApiDoc = JSON.parse(fs.readFileSync(generatedPath, 'utf8')) as {
      paths: Record<string, unknown>
    }

    expect(openApiDoc.paths['/api/first']).toBeUndefined()
    expect(openApiDoc.paths['/api/second']).toBeDefined()
  })

  it('rebuilds when the generated document is missing or tampered with', async () => {
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'demo', 'api', 'health', 'route.ts'),
      "export async function GET() {}\nexport const openApi = { GET: { summary: 'health' } }\n",
    )
    const resolver = createMockResolver([{ id: 'demo', from: '@open-mercato/core' }])
    const generatedPath = path.join(tmpDir, 'output', 'generated', 'openapi.generated.json')
    await generateOpenApi({ resolver, quiet: true })

    fs.unlinkSync(generatedPath)
    const restored = await generateOpenApi({ resolver, quiet: true })
    expect(restored.filesWritten).toEqual([generatedPath])

    fs.writeFileSync(generatedPath, '{"tampered":true}')
    const repaired = await generateOpenApi({ resolver, quiet: true })
    expect(repaired.filesWritten).toEqual([generatedPath])
    expect(JSON.parse(fs.readFileSync(generatedPath, 'utf8'))).toHaveProperty('openapi', '3.1.0')
  })

  it('invalidates the early cache when the generated server URL changes', async () => {
    const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'demo', 'api', 'route.ts'),
      "export async function GET() {}\nexport const openApi = { GET: { summary: 'demo' } }\n",
    )
    const resolver = createMockResolver([{ id: 'demo', from: '@open-mercato/core' }])
    const generatedPath = path.join(tmpDir, 'output', 'generated', 'openapi.generated.json')

    try {
      process.env.NEXT_PUBLIC_APP_URL = 'https://first.example.test'
      await generateOpenApi({ resolver, quiet: true })
      process.env.NEXT_PUBLIC_APP_URL = 'https://second.example.test'
      const result = await generateOpenApi({ resolver, quiet: true })
      const openApiDoc = JSON.parse(fs.readFileSync(generatedPath, 'utf8')) as {
        servers: Array<{ url: string }>
      }

      expect(result.filesWritten).toEqual([generatedPath])
      expect(openApiDoc.servers[0]?.url).toBe('https://second.example.test')
    } finally {
      if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
      else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl
    }
  })

  it('does not cache a static fallback after a bundle failure', async () => {
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'demo', 'api', 'route.ts'),
      "export async function GET() {}\nexport const openApi = { GET: { summary: 'demo' } }\n",
    )
    const resolver = createMockResolver([{ id: 'demo', from: '@open-mercato/core' }])
    const generatorPath = path.join(tmpDir, 'packages', 'shared', 'src', 'lib', 'openapi', 'generator.ts')
    const manifestPath = path.join(tmpDir, 'output', 'generated', 'openapi.generated.inputs.json')
    await generateOpenApi({ resolver, quiet: true })

    fs.unlinkSync(generatorPath)
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await generateOpenApi({ resolver, quiet: false })
    await generateOpenApi({ resolver, quiet: false })

    expect(consoleSpy.mock.calls.filter(([message]) =>
      typeof message === 'string' && message.startsWith('[OpenAPI] Found'),
    )).toHaveLength(2)
    expect(fs.existsSync(manifestPath)).toBe(false)
    consoleSpy.mockRestore()
  })
})
