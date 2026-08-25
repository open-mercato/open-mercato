import { createLogger } from '../logger'
import { CLIENT_ONLY_STUB_NAMESPACE, createClientOnlyStubPlugin } from './clientOnlyModules'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

let activeBootstrapLoads = 0
let esbuildRuntime: typeof import('esbuild') | null = null
let esbuildStopPromise: Promise<void> | null = null

const logger = createLogger('shared').child({ component: 'bootstrap' })

async function getEsbuildRuntime(): Promise<typeof import('esbuild')> {
  if (esbuildStopPromise) await esbuildStopPromise
  if (esbuildRuntime) return esbuildRuntime

  const loadedRuntime = await import('esbuild')
  esbuildRuntime ??= loadedRuntime
  return esbuildRuntime
}

export async function withEsbuildLifecycle<T>(load: () => Promise<T>): Promise<T> {
  activeBootstrapLoads += 1

  try {
    return await load()
  } finally {
    activeBootstrapLoads -= 1
    if (activeBootstrapLoads === 0 && esbuildRuntime) {
      // esbuild keeps a helper process alive after build(). Bootstrap compilation
      // is a bounded phase, so release it once every concurrent loader is done.
      // A later build() call transparently starts a fresh helper process.
      const runtimeToStop = esbuildRuntime
      esbuildRuntime = null
      const stopPromise = runtimeToStop.stop().catch((err) => {
        logger.warn('Failed to stop the bootstrap compiler service', { err })
      })
      esbuildStopPromise = stopPromise
      try {
        await stopPromise
      } finally {
        if (esbuildStopPromise === stopPromise) esbuildStopPromise = null
      }
    }
  }
}

/**
 * Thrown when an expected generated source file is absent.
 *
 * Optional registries treat this as the supported compatibility case (an app
 * that never generated the file), which is what makes it distinguishable from
 * a file that exists but fails to compile or import.
 */
export class GeneratedFileNotFoundError extends Error {
  readonly filePath: string

  constructor(filePath: string) {
    super(`Generated file not found: ${filePath}`)
    this.name = 'GeneratedFileNotFoundError'
    this.filePath = filePath
  }
}

/**
 * esbuild plugins for the CLI bundle, in resolution order. The client-only stub must come
 * first so it wins over the alias and external plugins for `*.client` dynamic imports.
 *
 * Exported so the wiring itself is testable: a test that only exercises
 * `createClientOnlyStubPlugin` in isolation stays green if the plugin is dropped from this
 * list, which would silently reintroduce #4623.
 */
export function createCliBundlePlugins(appRoot: string): import('esbuild').Plugin[] {
  const aliasPlugin: import('esbuild').Plugin = {
    name: 'alias-resolver',
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const rest = args.path.slice('@/'.length)
        const bases = rest.startsWith('.mercato/')
          ? [path.join(appRoot, rest)]
          : [path.join(appRoot, 'src', rest), path.join(appRoot, rest)]
        for (const base of bases) {
          if (fs.existsSync(base) && fs.statSync(base).isFile()) {
            return { path: base }
          }
          for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
            if (fs.existsSync(base + suffix)) {
              return { path: base + suffix }
            }
          }
        }
        return { path: path.join(appRoot, rest) }
      })
    },
  }

  const externalNonJsonPlugin: import('esbuild').Plugin = {
    name: 'external-non-json',
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        if (/^[a-zA-Z]:/.test(args.path)) {
          return null
        }
        if (args.path.endsWith('.json')) {
          return null
        }
        return { path: args.path, external: true }
      })
    },
  }

  return [createClientOnlyStubPlugin(), aliasPlugin, externalNonJsonPlugin]
}

const DYNAMIC_LOADER_CACHE_VERSION = 4

type DynamicLoaderCacheMetadata = {
  version: number
  inputHash: string
  outputHash: string
  dependencies: Record<string, string>
}

function cacheMetadataPath(jsPath: string): string {
  return `${jsPath}.cache.json`
}

export function contentHash(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function parseJsonConfig(content: string): unknown {
  let normalized = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    const nextCharacter = content[index + 1]

    if (inString) {
      normalized += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
      normalized += character
      continue
    }

    if (character === '/' && nextCharacter === '/') {
      while (index < content.length && content[index] !== '\n') index += 1
      normalized += '\n'
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      index += 2
      while (index < content.length && !(content[index] === '*' && content[index + 1] === '/')) {
        index += 1
      }
      index += 1
      continue
    }

    if (character === ',') {
      let lookahead = index + 1
      while (lookahead < content.length && /\s/.test(content[lookahead])) lookahead += 1
      if (content[lookahead] === '}' || content[lookahead] === ']') continue
    }

    normalized += character
  }

  return JSON.parse(normalized)
}

function resolveExistingConfigPath(candidate: string): string | null {
  for (const configPath of [candidate, `${candidate}.json`, path.join(candidate, 'tsconfig.json')]) {
    if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) return configPath
  }
  return null
}

function resolvePackageConfig(configPath: string, reference: string): string | null {
  try {
    const resolved = createRequire(pathToFileURL(configPath)).resolve(reference)
    return path.extname(resolved) === '.json' ? resolved : null
  } catch {
    return null
  }
}

function resolveExtendedConfig(configPath: string, reference: string): string {
  if (path.isAbsolute(reference) || reference.startsWith('.')) {
    const resolved = resolveExistingConfigPath(path.resolve(path.dirname(configPath), reference))
    if (resolved) return resolved
  } else {
    for (const packageReference of [reference, `${reference}/tsconfig.json`]) {
      const resolved = resolvePackageConfig(configPath, packageReference)
      if (resolved) return resolved
    }
  }

  throw new Error(`[internal] TypeScript config extends target not found: ${reference}`)
}

function collectTsconfigPaths(entryPath: string, visited: Set<string> = new Set()): string[] {
  const configPath = path.resolve(entryPath)
  if (visited.has(configPath)) return []
  visited.add(configPath)

  const parsed = parseJsonConfig(fs.readFileSync(configPath, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('extends' in parsed)) return [configPath]

  const extendsValue = parsed.extends
  const references = typeof extendsValue === 'string'
    ? [extendsValue]
    : Array.isArray(extendsValue) && extendsValue.every((value) => typeof value === 'string')
      ? extendsValue
      : []

  return [
    ...references.flatMap((reference) => collectTsconfigPaths(
      resolveExtendedConfig(configPath, reference),
      visited,
    )),
    configPath,
  ]
}

function hashFilesRelativeTo(appRoot: string, filePaths: string[]): Record<string, string> {
  return Object.fromEntries(filePaths.map((filePath) => [
    path.relative(appRoot, filePath).split(path.sep).join('/'),
    contentHash(fs.readFileSync(filePath)),
  ]))
}

function cacheInputHash(tsPath: string, appRoot: string, tsconfigPaths: string[]): string {
  const hash = crypto.createHash('sha256')
  hash.update(JSON.stringify({
    version: DYNAMIC_LOADER_CACHE_VERSION,
    sourceHash: contentHash(fs.readFileSync(tsPath)),
    tsconfigHashes: hashFilesRelativeTo(appRoot, tsconfigPaths),
  }))
  return hash.digest('hex')
}

function dependenciesAreValid(appRoot: string, dependencies: Record<string, string>): boolean {
  return Object.entries(dependencies).every(([relativePath, expectedHash]) => {
    const dependencyPath = path.resolve(appRoot, relativePath)
    return fs.existsSync(dependencyPath)
      && contentHash(fs.readFileSync(dependencyPath)) === expectedHash
  })
}

function collectDependencyHashes(
  appRoot: string,
  inputs: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(inputs)
      .filter((inputPath) => !inputPath.startsWith(`${CLIENT_ONLY_STUB_NAMESPACE}:`))
      .map((inputPath) => {
        const absolutePath = path.isAbsolute(inputPath)
          ? inputPath
          : path.resolve(appRoot, inputPath)
        const relativePath = path.relative(appRoot, absolutePath).split(path.sep).join('/')
        return [relativePath, contentHash(fs.readFileSync(absolutePath))]
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function readCacheMetadata(metadataPath: string): DynamicLoaderCacheMetadata | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'version' in parsed
      && parsed.version === DYNAMIC_LOADER_CACHE_VERSION
      && 'inputHash' in parsed
      && typeof parsed.inputHash === 'string'
      && 'outputHash' in parsed
      && typeof parsed.outputHash === 'string'
      && 'dependencies' in parsed
      && typeof parsed.dependencies === 'object'
      && parsed.dependencies !== null
      && Object.values(parsed.dependencies).every((hash) => typeof hash === 'string')
    ) {
      return {
        version: parsed.version,
        inputHash: parsed.inputHash,
        outputHash: parsed.outputHash,
        dependencies: parsed.dependencies as Record<string, string>,
      }
    }
  } catch {
    return null
  }
  return null
}

function cacheIsValid(
  appRoot: string,
  jsPath: string,
  metadataPath: string,
  expectedInputHash: string,
): boolean {
  if (!fs.existsSync(jsPath)) return false
  const metadata = readCacheMetadata(metadataPath)
  if (!metadata || metadata.inputHash !== expectedInputHash) return false
  return contentHash(fs.readFileSync(jsPath)) === metadata.outputHash
    && dependenciesAreValid(appRoot, metadata.dependencies)
}

/**
 * Options for `compileAppSourceFile`.
 *
 * `appRoot` anchors the tsconfig, the `@/` alias resolution and the dependency
 * cache; `outFile` is the absolute path of the artifact to write. `format`
 * selects the module system of that artifact — `'cjs'` exists for the Jest
 * runtime, which cannot `import()` an ESM sibling.
 */
export type CompileAppSourceOptions = {
  appRoot: string
  outFile: string
  format?: 'esm' | 'cjs'
}

/**
 * Compile one app-owned TypeScript source and its relative import graph into a
 * single JavaScript artifact, leaving every package import external.
 *
 * This is the only supported way to load app source (`apps/<app>/src/**`,
 * `.mercato/generated/**`) from a plain Node process. Those files are never
 * compiled to `dist`, and Node's own type stripping cannot load them: it
 * requires explicit file extensions on relative specifiers and rejects the
 * decorator and enum syntax the entities and DI files use.
 *
 * The artifact is cached against the content of the entry, its whole bundled
 * dependency graph, and the tsconfig chain, so an edit anywhere in the graph
 * invalidates it.
 *
 * The build runs inside the shared esbuild lifecycle. Callers outside a
 * bootstrap load — the generated-registry loader compiling an `@app` module —
 * would otherwise hold a build on a service another scope is entitled to
 * `stop()`, and would leave the helper process running afterwards. Nesting is
 * safe: the scope only releases the service when the last participant exits.
 */
export async function compileAppSourceFile(
  tsPath: string,
  options: CompileAppSourceOptions,
): Promise<string> {
  return withEsbuildLifecycle(() => compileAppSourceFileWithActiveEsbuild(tsPath, options))
}

async function compileAppSourceFileWithActiveEsbuild(
  tsPath: string,
  options: CompileAppSourceOptions,
): Promise<string> {
  const { appRoot, outFile } = options
  const format = options.format ?? 'esm'
  const appTsconfig = path.join(appRoot, 'tsconfig.json')
  const metadataPath = cacheMetadataPath(outFile)

  if (!fs.existsSync(tsPath)) {
    throw new GeneratedFileNotFoundError(tsPath)
  }
  if (!fs.existsSync(appTsconfig)) {
    throw new Error(`App TypeScript config not found: ${appTsconfig}`)
  }

  const tsconfigPaths = collectTsconfigPaths(appTsconfig)
  const expectedInputHash = cacheInputHash(tsPath, appRoot, tsconfigPaths)

  if (cacheIsValid(appRoot, outFile, metadataPath, expectedInputHash)) {
    return outFile
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const esbuild = await getEsbuildRuntime()
  const result = await esbuild.build({
    entryPoints: [tsPath],
    outfile: outFile,
    absWorkingDir: appRoot,
    bundle: true,
    metafile: true,
    format,
    platform: 'node',
    target: 'node18',
    tsconfig: appTsconfig,
    plugins: createCliBundlePlugins(appRoot),
    loader: { '.json': 'json' },
  })
  const metadata: DynamicLoaderCacheMetadata = {
    version: DYNAMIC_LOADER_CACHE_VERSION,
    inputHash: expectedInputHash,
    outputHash: contentHash(fs.readFileSync(outFile)),
    dependencies: {
      ...collectDependencyHashes(appRoot, result.metafile.inputs),
      ...hashFilesRelativeTo(appRoot, tsconfigPaths),
    },
  }
  fs.writeFileSync(metadataPath, JSON.stringify(metadata))

  return outFile
}
