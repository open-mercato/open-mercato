import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as registry from '@open-mercato/shared/modules/registry'
import {
  rewriteGeneratedAliasImports,
  collectAppLocalSpecifiers,
  escapeUnsafeJsStringChars,
  findGeneratedFile,
  compileAndImportGenerated,
  ensureApiRouteManifestsRegistered,
} from '../generated-registry-loader'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'om-gen-loader-'))
}

// The compile path needs a real app tsconfig: it is what esbuild reads for the
// app's TypeScript settings, and its absence is the loader's "not an app root"
// signal.
function makeTempAppRoot(): string {
  const appRoot = makeTempDir()
  fs.writeFileSync(
    path.join(appRoot, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler' } }),
  )
  return appRoot
}

// Mirror the production sanitizer so expectations match how the rewriter
// embeds a resolved path into the generated source. For ordinary file URLs the
// escape is a no-op, but routing the expected literal through the same helper
// keeps the test honest if the rewriter's escaping ever changes.
function safeJsLiteral(value: string): string {
  return escapeUnsafeJsStringChars(JSON.stringify(value))
}

describe('Next.js bundle boundary', () => {
  it('keeps runtime-only imports out of the Next.js bundle', () => {
    const loaderSource = fs.readFileSync(
      path.join(__dirname, '..', 'generated-registry-loader.ts'),
      'utf8',
    )

    expect(loaderSource).toMatch(
      /await import\(\s*\/\* webpackIgnore: true \*\/\s*\/\* turbopackIgnore: true \*\/\s*pathToFileURL\(jsPath\)\.href\s*\)/,
    )
    expect(loaderSource).toMatch(
      /await import\(\s*\/\* webpackIgnore: true \*\/\s*\/\* turbopackIgnore: true \*\/\s*'@open-mercato\/shared\/lib\/bootstrap\/dynamicLoader'\s*\)/,
    )
  })
})

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

  it('prefers a compiled artifact over the raw `.ts` target when one was built', () => {
    const appRoot = makeTempDir()
    const moduleDir = path.join(appRoot, 'src', 'modules', 'media_campaigns')
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.writeFileSync(path.join(moduleDir, 'ai-tools.ts'), 'export const aiTools = []\n')
    const artifact = path.join(appRoot, '.mercato', 'generated', 'app-modules', 'ai-tools.mjs')

    const out = rewriteGeneratedAliasImports(
      `import * as AI_TOOLS from "../../src/modules/media_campaigns/ai-tools"`,
      appRoot,
      new Map([['../../src/modules/media_campaigns/ai-tools', artifact]]),
    )

    expect(out).toBe(`import * as AI_TOOLS from ${safeJsLiteral(pathToFileURL(artifact).href)}`)
    expect(out).not.toContain('ai-tools.ts')
  })
})

describe('collectAppLocalSpecifiers', () => {
  it('collects static and dynamic @app specifiers once each, and nothing else', () => {
    const source = [
      `import * as A from "../../src/modules/example/ai-tools"`,
      `const b = () => import("../../src/modules/example/ai-agents")`,
      `import * as C from "../../src/modules/example/ai-tools"`,
      `import { z } from "zod"`,
      `import D from "@/.mercato/generated/entities"`,
      `import E from "@open-mercato/core/modules/customers/ai-tools"`,
    ].join('\n')

    expect(collectAppLocalSpecifiers(source)).toEqual([
      '../../src/modules/example/ai-agents',
      '../../src/modules/example/ai-tools',
    ])
  })

  it('returns nothing for a registry that only references package-backed modules', () => {
    expect(collectAppLocalSpecifiers(`import * as A from "@open-mercato/core/x"`)).toEqual([])
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
    const appRoot = makeTempAppRoot()
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

  // Regression for the TC-INT-AI-TOOLS failure on the first @app-local
  // `ai-tools.ts`: the tool-test CLI died with
  //   "Cannot find module '.../src/modules/example/di' imported from
  //    .../src/modules/example/ai-tools.ts"
  // before producing a report, so the whole tool registry failed to load.
  // Pointing Node at the raw `.ts` only works while the module's entire graph
  // stays inside what type stripping accepts — an extensionless relative
  // specifier already breaks it, and the enum below breaks it again even with
  // the extension spelled out.
  it('loads an @app module whose own graph Node cannot import as raw TypeScript', async () => {
    const appRoot = makeTempAppRoot()
    const generatedDir = path.join(appRoot, '.mercato', 'generated')
    const moduleDir = path.join(appRoot, 'src', 'modules', 'example')
    fs.mkdirSync(generatedDir, { recursive: true })
    fs.mkdirSync(moduleDir, { recursive: true })

    fs.writeFileSync(
      path.join(moduleDir, 'di.ts'),
      'export const EXAMPLE_TODO_SUMMARY_SERVICE = "exampleTodoSummaryService"\n',
    )
    fs.writeFileSync(
      path.join(moduleDir, 'entities.ts'),
      'export enum ExampleCustomerPriority { High = "high" }\n',
    )
    fs.writeFileSync(
      path.join(moduleDir, 'ai-tools.ts'),
      [
        `import { EXAMPLE_TODO_SUMMARY_SERVICE } from './di'`,
        `import { ExampleCustomerPriority } from './entities'`,
        'export const aiTools = [{ name: "example.get_todo_summary", service: EXAMPLE_TODO_SUMMARY_SERVICE, priority: ExampleCustomerPriority.High }]',
      ].join('\n'),
    )

    const generatedPath = path.join(generatedDir, 'ai-tools.generated.ts')
    fs.writeFileSync(
      generatedPath,
      [
        'import * as ExampleTools from "../../src/modules/example/ai-tools"',
        'export const aiToolConfigEntries = ExampleTools.aiTools',
      ].join('\n'),
    )

    const mod = await compileAndImportGenerated(generatedPath)

    expect(mod.aiToolConfigEntries).toEqual([
      { name: 'example.get_todo_summary', service: 'exampleTodoSummaryService', priority: 'high' },
    ])
    expect(fs.existsSync(path.join(generatedDir, 'app-modules'))).toBe(true)
  })

  it('falls back to the raw source path when the app module cannot be compiled', async () => {
    // No tsconfig.json, so the root is not a compilable app: the loader must
    // degrade to the previous behavior rather than drop the module's entries.
    const appRoot = makeTempDir()
    const generatedDir = path.join(appRoot, '.mercato', 'generated')
    const moduleDir = path.join(appRoot, 'src', 'modules', 'example')
    fs.mkdirSync(generatedDir, { recursive: true })
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.writeFileSync(path.join(moduleDir, 'ai-tools.ts'), 'export const aiTools = [{ name: "example.raw" }]\n')

    const generatedPath = path.join(generatedDir, 'ai-tools.generated.ts')
    fs.writeFileSync(
      generatedPath,
      [
        'import * as ExampleTools from "../../src/modules/example/ai-tools"',
        'export const aiToolConfigEntries = ExampleTools.aiTools',
      ].join('\n'),
    )

    const mod = await compileAndImportGenerated(generatedPath)

    expect(mod.aiToolConfigEntries).toEqual([{ name: 'example.raw' }])
    expect(fs.existsSync(path.join(generatedDir, 'app-modules'))).toBe(false)
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
