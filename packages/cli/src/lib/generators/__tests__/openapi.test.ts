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
})
