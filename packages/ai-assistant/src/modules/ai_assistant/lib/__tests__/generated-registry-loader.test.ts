import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as registry from '@open-mercato/shared/modules/registry'
import {
  rewriteGeneratedAliasImports,
  escapeUnsafeJsStringChars,
  findGeneratedFile,
  compileAndImportGenerated,
  ensureApiRouteManifestsRegistered,
} from '../generated-registry-loader'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'om-gen-loader-'))
}

// Mirror the production sanitizer so expectations match how the rewriter
// embeds a resolved path into the generated source. For ordinary file URLs the
// escape is a no-op, but routing the expected literal through the same helper
// keeps the test honest if the rewriter's escaping ever changes.
function safeJsLiteral(value: string): string {
  return escapeUnsafeJsStringChars(JSON.stringify(value))
}

describe('rewriteGeneratedAliasImports', () => {
  // Regression for the MCP dev-server crash:
  //   "Cannot find package '@/.mercato' imported from .../tool-loader.js"
  // Generated registries use the Next.js `@/` alias, which a standalone Node
  // process cannot resolve. The rewrite turns it into an absolute file URL.

  it('rewrites a static `from "@/..."` import to an absolute file URL', () => {
    const appRoot = makeTempDir()
    const out = rewriteGeneratedAliasImports(
      `import { x } from '@/.mercato/generated/entities'`,
      appRoot,
    )
    const expectedUrl = pathToFileURL(
      path.join(appRoot, '.mercato/generated/entities'),
    ).href
    expect(out).toBe(`import { x } from ${safeJsLiteral(expectedUrl)}`)
    expect(out).not.toContain('@/')
  })

  it('rewrites a dynamic `import("@/...")` call to an absolute file URL', () => {
    const appRoot = makeTempDir()
    const aliasSpecifier = '"@/.mercato/generated/ai-tools.generated"'
    const source = `const tools = () => import(${aliasSpecifier})`
    const out = rewriteGeneratedAliasImports(source, appRoot)
    const expectedUrl = pathToFileURL(
      path.join(appRoot, '.mercato/generated/ai-tools.generated'),
    ).href
    const expected = source.replace(aliasSpecifier, safeJsLiteral(expectedUrl))
    expect(out).toBe(expected)
    expect(out).not.toContain('@/')
  })

  it('appends `.ts` when the aliased target exists only as a TypeScript file', () => {
    const appRoot = makeTempDir()
    fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true })
    fs.writeFileSync(path.join(appRoot, 'src', 'thing.ts'), 'export const a = 1\n')

    const out = rewriteGeneratedAliasImports(`import x from '@/src/thing'`, appRoot)

    const expectedUrl = pathToFileURL(path.join(appRoot, 'src', 'thing.ts')).href
    expect(out).toBe(`import x from ${safeJsLiteral(expectedUrl)}`)
  })

  it('leaves non-alias imports untouched', () => {
    const source = [
      `import { z } from 'zod'`,
      `import x from './local'`,
      `import y from '@open-mercato/shared/x'`,
    ].join('\n')
    expect(rewriteGeneratedAliasImports(source, makeTempDir())).toBe(source)
  })

  // Regression for issue #3524: the MCP dev server crashed with
  //   "ERR_MODULE_NOT_FOUND: Cannot find module '.../src/modules/<id>/ai-tools'"
  // because the generator emits `../../src/modules/<id>/ai-tools` relative
  // imports for @app local modules, which the rewriter previously left intact.
  // esbuild.transform keeps them verbatim, so Node ESM can't resolve the
  // extensionless `.ts`-only specifier from the compiled `.mjs`.

  it('rewrites a `../../src/...` @app relative import to an absolute file URL', () => {
    const appRoot = makeTempDir()
    const out = rewriteGeneratedAliasImports(
      `import * as AI_TOOLS from "../../src/modules/media_campaigns/ai-tools"`,
      appRoot,
    )
    const expectedUrl = pathToFileURL(
      path.join(appRoot, 'src', 'modules', 'media_campaigns', 'ai-tools'),
    ).href
    expect(out).toBe(`import * as AI_TOOLS from ${safeJsLiteral(expectedUrl)}`)
    expect(out).not.toContain('../../src/')
  })

  it('rewrites a dynamic `import("../../src/...")` @app call to an absolute file URL', () => {
    const appRoot = makeTempDir()
    const specifier = '"../../src/modules/media_campaigns/ai-tools"'
    const source = `const load = () => import(${specifier})`
    const out = rewriteGeneratedAliasImports(source, appRoot)
    const expectedUrl = pathToFileURL(
      path.join(appRoot, 'src', 'modules', 'media_campaigns', 'ai-tools'),
    ).href
    expect(out).toBe(source.replace(specifier, safeJsLiteral(expectedUrl)))
    expect(out).not.toContain('../../src/')
  })

  it('appends `.ts` for a `../../src/...` @app import that exists only as TypeScript', () => {
    const appRoot = makeTempDir()
    const moduleDir = path.join(appRoot, 'src', 'modules', 'media_campaigns')
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.writeFileSync(path.join(moduleDir, 'ai-tools.ts'), 'export const aiTools = []\n')

    const out = rewriteGeneratedAliasImports(
      `import * as AI_TOOLS from "../../src/modules/media_campaigns/ai-tools"`,
      appRoot,
    )

    const expectedUrl = pathToFileURL(path.join(moduleDir, 'ai-tools.ts')).href
    expect(out).toBe(`import * as AI_TOOLS from ${safeJsLiteral(expectedUrl)}`)
  })
})

describe('escapeUnsafeJsStringChars', () => {
  it('escapes characters JSON.stringify leaves intact in a JS string literal', () => {
    const lineSep = String.fromCharCode(0x2028)
    const paraSep = String.fromCharCode(0x2029)
    const out = escapeUnsafeJsStringChars(`a<b>c${lineSep}d${paraSep}e`)
    expect(out).toBe('a\\u003Cb\\u003Ec\\u2028d\\u2029e')
    expect(out).not.toContain('<')
    expect(out).not.toContain('>')
    expect(out).not.toContain(lineSep)
    expect(out).not.toContain(paraSep)
  })

  it('leaves ordinary file URLs unchanged', () => {
    const url = pathToFileURL(path.join('/tmp', 'app', '.mercato', 'x.generated')).href
    expect(escapeUnsafeJsStringChars(JSON.stringify(url))).toBe(JSON.stringify(url))
  })
})

describe('findGeneratedFile', () => {
  let cwdSpy: jest.SpyInstance

  afterEach(() => {
    cwdSpy?.mockRestore()
  })

  it('returns null when the file exists nowhere on the search path', () => {
    // A name that cannot exist anywhere up the tree or under cwd.
    expect(findGeneratedFile('definitely-not-real-xyz.generated.ts')).toBeNull()
  })

  it('locates the file under <cwd>/.mercato/generated (standalone app layout)', () => {
    const appRoot = makeTempDir()
    const generatedDir = path.join(appRoot, '.mercato', 'generated')
    fs.mkdirSync(generatedDir, { recursive: true })
    const target = path.join(generatedDir, 'unique-standalone.generated.ts')
    fs.writeFileSync(target, 'export const apiRoutes = []\n')
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(appRoot)

    expect(findGeneratedFile('unique-standalone.generated.ts')).toBe(target)
  })

  it('locates the file under <cwd>/apps/mercato/.mercato/generated (monorepo layout)', () => {
    const root = makeTempDir()
    const generatedDir = path.join(root, 'apps', 'mercato', '.mercato', 'generated')
    fs.mkdirSync(generatedDir, { recursive: true })
    const target = path.join(generatedDir, 'unique-monorepo.generated.ts')
    fs.writeFileSync(target, 'export const apiRoutes = []\n')
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(root)

    expect(findGeneratedFile('unique-monorepo.generated.ts')).toBe(target)
  })

  it('prefers the apps/mercato layout over the cwd-root layout when both exist', () => {
    const root = makeTempDir()
    const appsDir = path.join(root, 'apps', 'mercato', '.mercato', 'generated')
    const rootDir = path.join(root, '.mercato', 'generated')
    fs.mkdirSync(appsDir, { recursive: true })
    fs.mkdirSync(rootDir, { recursive: true })
    const fileName = 'unique-both.generated.ts'
    fs.writeFileSync(path.join(appsDir, fileName), 'export const apiRoutes = []\n')
    fs.writeFileSync(path.join(rootDir, fileName), 'export const apiRoutes = []\n')
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(root)

    expect(findGeneratedFile(fileName)).toBe(path.join(appsDir, fileName))
  })
})

describe('compileAndImportGenerated', () => {
  it('uses a Jest-safe CJS artifact instead of an existing ESM .mjs artifact', async () => {
    const appRoot = makeTempDir()
    const generatedDir = path.join(appRoot, '.mercato', 'generated')
    const moduleDir = path.join(appRoot, 'src', 'modules', 'example')
    fs.mkdirSync(generatedDir, { recursive: true })
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.writeFileSync(path.join(moduleDir, 'ai-agents.ts'), 'export const aiAgents = [{ id: "example.agent" }]\n')

    const generatedPath = path.join(generatedDir, 'ai-agents.generated.ts')
    fs.writeFileSync(
      generatedPath,
      [
        'import * as ExampleAgents from "../../src/modules/example/ai-agents"',
        'export const allAiAgents = ExampleAgents.aiAgents',
      ].join('\n'),
    )
    fs.writeFileSync(
      path.join(generatedDir, 'ai-agents.generated.mjs'),
      'import broken from "this-existing-esm-artifact-should-not-be-used";\nexport const allAiAgents = [broken]\n',
    )

    const mod = await compileAndImportGenerated(generatedPath)

    expect(mod.allAiAgents).toEqual([{ id: 'example.agent' }])
    expect(fs.existsSync(path.join(generatedDir, 'ai-agents.generated.jest.cjs'))).toBe(true)
  })
})

describe('ensureApiRouteManifestsRegistered', () => {
  // Regression for "Operation runner manifest unavailable: No API route manifest
  // registered" when calling API-backed module tools over MCP. The standalone
  // MCP servers must register the manifest, but must NOT clobber the in-app
  // agents-framework manifest registered at bootstrap.

  it('is a no-op when a manifest is already registered (does not interfere with bootstrap)', async () => {
    const getSpy = jest
      .spyOn(registry, 'getApiRouteManifests')
      .mockReturnValue([{ id: 'existing' }] as never)
    const registerSpy = jest
      .spyOn(registry, 'registerApiRouteManifests')
      .mockImplementation(() => {})

    const count = await ensureApiRouteManifestsRegistered()

    expect(count).toBe(1)
    expect(registerSpy).not.toHaveBeenCalled()

    getSpy.mockRestore()
    registerSpy.mockRestore()
  })
})
