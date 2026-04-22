/**
 * OpenAPI JSON Generator
 *
 * Generates a static openapi.generated.json file at build time.
 * This allows CLI tools (like MCP dev server) to access API endpoint
 * information without requiring a running Next.js app.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PackageResolver } from '../resolver'
import {
  calculateChecksum,
  readChecksumRecord,
  writeChecksumRecord,
  logGenerationResult,
  type GeneratorResult,
  createGeneratorResult,
} from '../utils'

export interface GenerateOpenApiOptions {
  resolver: PackageResolver
  quiet?: boolean
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface ApiRouteInfo {
  path: string
  methods: HttpMethod[]
  openApiPath: string
}

function resolveExistingPath(paths: string[]): string | null {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Find all API route files and extract their OpenAPI specs.
 */
async function findApiRoutes(resolver: PackageResolver): Promise<ApiRouteInfo[]> {
  const routes: ApiRouteInfo[] = []
  const enabled = resolver.loadEnabledModules()

  for (const entry of enabled) {
    const modId = entry.id
    const roots = resolver.getModulePaths(entry)

    const apiApp = path.join(roots.appBase, 'api')
    const apiPkg = path.join(roots.pkgBase, 'api')

    // Scan route files
    const routeFiles: Array<{ relativePath: string; fullPath: string }> = []

    const walkDir = (dir: string, rel: string[] = []) => {
      if (!fs.existsSync(dir)) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (e.name === '__tests__' || e.name === '__mocks__') continue
          walkDir(path.join(dir, e.name), [...rel, e.name])
        } else if (e.isFile() && e.name === 'route.ts') {
          routeFiles.push({
            relativePath: [...rel].join('/'),
            fullPath: path.join(dir, e.name),
          })
        }
      }
    }

    // Scan package first, then app (app overrides)
    if (fs.existsSync(apiPkg)) walkDir(apiPkg)
    if (fs.existsSync(apiApp)) walkDir(apiApp)

    // Process unique routes (app overrides package)
    const seen = new Set<string>()
    for (const { relativePath, fullPath } of routeFiles) {
      if (seen.has(relativePath)) continue
      seen.add(relativePath)

      // Build API path
      const routeSegs = relativePath ? relativePath.split('/') : []
      const apiPath = `/api/${modId}${routeSegs.length ? '/' + routeSegs.join('/') : ''}`
        // Convert [param] to {param} for OpenAPI format
        .replace(/\[([^\]]+)\]/g, '{$1}')

      routes.push({
        path: fullPath,
        methods: await detectMethods(fullPath),
        openApiPath: apiPath,
      })
    }
  }

  return routes
}

/**
 * Detect which HTTP methods are exported from a route file.
 */
async function detectMethods(filePath: string): Promise<HttpMethod[]> {
  const methods: HttpMethod[] = []
  const content = fs.readFileSync(filePath, 'utf-8')

  const methodPatterns: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  for (const method of methodPatterns) {
    // Check for export { GET }, export const GET, export async function GET
    const patterns = [
      new RegExp(`export\\s+(const|async\\s+function|function)\\s+${method}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`),
    ]
    if (patterns.some((p) => p.test(content))) {
      methods.push(method)
    }
  }

  return methods
}

/**
 * Parse openApi export from route file source code statically.
 * This extracts basic operation info without needing to compile the file.
 */
function parseOpenApiFromSource(filePath: string): Record<string, any> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')

    // Check if file exports openApi
    if (!content.includes('export const openApi') && !content.includes('export { openApi')) {
      return null
    }

    // Extract operationId, summary, description from the source
    const result: Record<string, any> = {}
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

    for (const method of methods) {
      // Look for method specs in the openApi object
      // Pattern: GET: { operationId: '...', summary: '...', ... }
      const methodPattern = new RegExp(
        `${method}\\s*:\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`,
        's'
      )
      const methodMatch = content.match(methodPattern)

      if (methodMatch) {
        const methodContent = methodMatch[1]
        const spec: Record<string, any> = {}

        // Extract operationId
        const opIdMatch = methodContent.match(/operationId\s*:\s*['"]([^'"]+)['"]/)
        if (opIdMatch) spec.operationId = opIdMatch[1]

        // Extract summary
        const summaryMatch = methodContent.match(/summary\s*:\s*['"]([^'"]+)['"]/)
        if (summaryMatch) spec.summary = summaryMatch[1]

        // Extract description
        const descMatch = methodContent.match(/description\s*:\s*['"]([^'"]+)['"]/)
        if (descMatch) spec.description = descMatch[1]

        // Extract tags
        const tagsMatch = methodContent.match(/tags\s*:\s*\[([^\]]*)\]/)
        if (tagsMatch) {
          const tagsContent = tagsMatch[1]
          const tags = tagsContent.match(/['"]([^'"]+)['"]/g)
          if (tags) {
            spec.tags = tags.map(t => t.replace(/['"]/g, ''))
          }
        }

        if (Object.keys(spec).length > 0) {
          result[method] = spec
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null
  } catch {
    return null
  }
}

/**
 * Generate a complete OpenAPI document by bundling route files with esbuild
 * and executing the bundle to call buildOpenApiDocument from @open-mercato/shared.
 *
 * esbuild compiles TypeScript with legacy decorator support (reads experimentalDecorators
 * from tsconfig.json), avoiding the TC39 decorator mismatch that breaks tsx-based imports.
 * External packages (zod, mikro-orm, etc.) are resolved from node_modules at runtime.
 */
async function generateOpenApiViaBundle(
  routes: ApiRouteInfo[],
  resolver: PackageResolver,
  quiet: boolean
): Promise<Record<string, any> | null> {
  let esbuild: typeof import('esbuild')
  try {
    esbuild = await import('esbuild')
  } catch {
    if (!quiet) console.log('[OpenAPI] esbuild not available, skipping bundle approach')
    return null
  }

  const { execFileSync } = await import('node:child_process')

  const rootDir = resolver.getRootDir()
  const appDir = resolver.getAppDir()
  const sharedPackageRoot = resolver.getPackageRoot('@open-mercato/shared')
  const corePackageRoot = resolver.getPackageRoot('@open-mercato/core')
  const tsconfigPath = resolveExistingPath([
    path.join(appDir, 'tsconfig.json'),
    path.join(rootDir, 'tsconfig.base.json'),
    path.join(rootDir, 'tsconfig.json'),
  ])
  const generatorPath = path.join(sharedPackageRoot, 'src', 'lib', 'openapi', 'generator.ts')
  const coreGeneratedRoot = path.join(corePackageRoot, 'generated')

  if (!fs.existsSync(generatorPath)) {
    if (!quiet) {
      console.log(`[OpenAPI] Generator source not found at ${generatorPath}, skipping bundle approach`)
    }
    return null
  }

  const cacheDir = path.join(rootDir, 'node_modules', '.cache')
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })

  const bundlePath = path.join(cacheDir, '_openapi-bundle.mjs')

  // Build the entry script that imports all routes and calls buildOpenApiDocument
  const importLines: string[] = [
    `import { buildOpenApiDocument } from ${JSON.stringify(generatorPath)};`,
  ]
  const routeMapLines: string[] = []

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]
    importLines.push(`import * as R${i} from ${JSON.stringify(route.path)};`)
    // Use [param] format so normalizePath in buildOpenApiDocument extracts path params
    const bracketPath = route.openApiPath.replace(/\{([^}]+)\}/g, '[$1]')
    routeMapLines.push(`  [${JSON.stringify(bracketPath)}, R${i}],`)
  }

  const entryScript = `${importLines.join('\n')}

const routeEntries = [
${routeMapLines.join('\n')}
];

const modules = new Map();
for (const [apiPath, mod] of routeEntries) {
  const moduleId = apiPath.replace(/^\\/api\\//, '').split('/')[0];
  if (!modules.has(moduleId)) modules.set(moduleId, { id: moduleId, apis: [] });
  modules.get(moduleId).apis.push({
    path: apiPath,
    handlers: mod,
    metadata: mod.metadata,
  });
}

const doc = buildOpenApiDocument([...modules.values()], {
  title: 'Open Mercato API',
  version: '1.0.0',
  description: 'Auto-generated OpenAPI specification',
  servers: [{ url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000' }],
});

// Deep-clone to break shared object references before serializing.
// The zodToJsonSchema memo cache returns the same object instance for
// fields like currencyCode that appear on both parent and child schemas.
// A naive WeakSet-based circular-ref guard would drop the second occurrence,
// causing properties to vanish from the generated spec (while the field
// still appears in the 'required' array, since those are plain strings).
const deepClone = (v, ancestors = []) => {
  if (v === null || typeof v !== 'object') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'function') return undefined;
  if (ancestors.includes(v)) return undefined;  // true circular ref
  const next = [...ancestors, v];
  if (Array.isArray(v)) return v.map((item) => deepClone(item, next));
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    const cloned = deepClone(val, next);
    if (cloned !== undefined) out[k] = cloned;
  }
  return out;
};
process.stdout.write(JSON.stringify(deepClone(doc), (_, v) =>
  typeof v === 'bigint' ? Number(v) : v
));
`

  // Plugin: stub next/* imports (not available outside Next.js app context)
  const stubNextPlugin = {
    name: 'stub-next',
    setup(build: any) {
      build.onResolve({ filter: /^next($|\/)/ }, () => ({
        path: 'next-stub',
        namespace: 'next-stub',
      }))
      build.onLoad({ filter: /.*/, namespace: 'next-stub' }, () => ({
        contents: [
          'const p = new Proxy(function(){}, {',
          '  get(_, k) { return k === "__esModule" ? true : k === "default" ? p : p; },',
          '  apply() { return p; },',
          '  construct() { return p; },',
          '});',
          'export default p;',
          'export const NextRequest = p, NextResponse = p, headers = p, cookies = p;',
          'export const redirect = p, notFound = p, useRouter = p, usePathname = p;',
          'export const useSearchParams = p, permanentRedirect = p, revalidatePath = p;',
        ].join('\n'),
        loader: 'js' as const,
      }))
    },
  }

  // Plugin: resolve workspace imports, aliases, and subpath imports
  const resolveProjectImportsPlugin = {
    name: 'resolve-project-imports',
    setup(build: any) {
      // @open-mercato/<pkg>/<path> → packageRoot/src/<path>.ts
      build.onResolve({ filter: /^@open-mercato\// }, (args: any) => {
        const withoutScope = args.path.slice('@open-mercato/'.length)
        const slashIdx = withoutScope.indexOf('/')
        const pkg = slashIdx === -1 ? withoutScope : withoutScope.slice(0, slashIdx)
        const rest = slashIdx === -1 ? '' : withoutScope.slice(slashIdx + 1)
        const packageName = `@open-mercato/${pkg}`
        const packageRoot = resolver.getPackageRoot(packageName)

        const base = rest
          ? path.join(packageRoot, 'src', rest)
          : path.join(packageRoot, 'src', 'index')

        for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
          if (fs.existsSync(base + ext)) return { path: base + ext }
        }
        return undefined
      })

      // @/.mercato/* → app/.mercato/* (tsconfig paths)
      build.onResolve({ filter: /^@\/\.mercato\// }, (args: any) => {
        const rest = args.path.slice('@/'.length) // '.mercato/generated/...'
        const base = path.join(appDir, rest)
        for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
          if (fs.existsSync(base + ext)) return { path: base + ext }
        }
        return undefined
      })

      // @/* → app/src/* (tsconfig paths)
      build.onResolve({ filter: /^@\// }, (args: any) => {
        const rest = args.path.slice('@/'.length)
        const base = path.join(appDir, 'src', rest)
        for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
          if (fs.existsSync(base + ext)) return { path: base + ext }
        }
        return undefined
      })

      // #generated/* → core package generated/* (Node subpath imports)
      build.onResolve({ filter: /^#generated\// }, (args: any) => {
        const rest = args.path.slice('#generated/'.length)
        const base = path.join(coreGeneratedRoot, rest)
        for (const ext of ['.ts', '/index.ts']) {
          if (fs.existsSync(base + ext)) return { path: base + ext }
        }
        return undefined
      })
    },
  }

  // Plugin: externalize installed packages, stub missing ones
  const nodeBuiltins = new Set([
    'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
    'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
    'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
    'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
    'sys', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
    'worker_threads', 'zlib', 'async_hooks', 'diagnostics_channel', 'inspector',
    'trace_events',
  ])
  const externalNonWorkspacePlugin = {
    name: 'external-non-workspace',
    setup(build: any) {
      build.onResolve({ filter: /^[^./]/ }, (args: any) => {
        if (args.path.startsWith('@open-mercato/')) return undefined
        if (args.path.startsWith('@/')) return undefined
        if (args.path.startsWith('#generated/')) return undefined
        if (args.path.startsWith('next')) return undefined
        // Let esbuild handle Node builtins (with or without node: prefix)
        if (args.path.startsWith('node:')) return undefined
        const topLevel = args.path.split('/')[0]
        if (nodeBuiltins.has(topLevel)) return undefined

        // Extract package name (handle scoped packages like @mikro-orm/core)
        const pkgName = args.path.startsWith('@')
          ? args.path.split('/').slice(0, 2).join('/')
          : topLevel
        const pkgDir = path.join(rootDir, 'node_modules', pkgName)
        if (fs.existsSync(pkgDir)) return { external: true }

        // Package not installed — provide CJS stub (allows any named import)
        return { path: args.path, namespace: 'missing-pkg' }
      })
      build.onLoad({ filter: /.*/, namespace: 'missing-pkg' }, () => ({
        contents: 'var h={get:(_,k)=>k==="__esModule"?true:p};var p=new Proxy(function(){return p},{get:h.get,apply:()=>p,construct:()=>p});module.exports=p;',
        loader: 'js' as const,
      }))
    },
  }

  try {
    await esbuild.build({
      stdin: {
        contents: entryScript,
        resolveDir: appDir,
        sourcefile: 'openapi-entry.ts',
        loader: 'ts',
      },
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node18',
      outfile: bundlePath,
      write: true,
      ...(tsconfigPath ? { tsconfig: tsconfigPath } : {}),
      logLevel: 'silent',
      jsx: 'automatic',
      plugins: [stubNextPlugin, resolveProjectImportsPlugin, externalNonWorkspacePlugin],
    })

    const stdout = execFileSync(process.execPath, [bundlePath], {
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf-8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      cwd: rootDir,
    })

    const lastLine = stdout.trim().split('\n').pop()!
    const doc = JSON.parse(lastLine) as Record<string, any>

    if (!quiet) {
      const pathCount = Object.keys(doc.paths || {}).length
      const withBody = Object.values(doc.paths || {}).reduce((n: number, methods: any) => {
        for (const m of Object.values(methods)) {
          if ((m as any)?.requestBody) n++
        }
        return n
      }, 0)
      console.log(`[OpenAPI] Bundle approach: ${pathCount} paths, ${withBody} with requestBody schemas`)
    }

    return doc
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const stderr = (err as any)?.stderr
    const esbuildErrors = (err as any)?.errors as Array<{ text: string; location?: { file: string } }> | undefined
    if (!quiet) {
      console.log(`[OpenAPI] Bundle approach failed, will use static fallback: ${errMsg.split('\n')[0]}`)
      if (esbuildErrors?.length) {
        const unique = new Map<string, string>()
        for (const e of esbuildErrors) {
          const key = e.text
          if (!unique.has(key)) unique.set(key, e.location?.file ?? '')
        }
        for (const [text, file] of [...unique.entries()].slice(0, 10)) {
          console.log(`[OpenAPI]   ${text}${file ? ` (${path.basename(file)})` : ''}`)
        }
        if (unique.size > 10) console.log(`[OpenAPI]   ... and ${unique.size - 10} more`)
      }
      if (stderr) {
        for (const line of String(stderr).trim().split('\n').slice(0, 3)) {
          console.log(`[OpenAPI]   ${line}`)
        }
      }
    }
    return null
  } finally {
    // Clean up old files from previous tsx-based approach
    for (const file of ['_openapi-register.mjs', '_openapi-loader.mjs', '_next-stub.cjs']) {
      try { fs.unlinkSync(path.join(cacheDir, file)) } catch {}
    }
  }
}

/**
 * Build OpenAPI paths from discovered routes.
 * Extracts basic operation info from route files statically.
 */
function buildOpenApiPaths(routes: ApiRouteInfo[]): Record<string, any> {
  const paths: Record<string, any> = {}

  for (const route of routes) {
    const pathEntry: Record<string, any> = {}

    // Try to extract OpenAPI specs from source
    const openApiSpec = parseOpenApiFromSource(route.path)

    for (const method of route.methods) {
      const methodLower = method.toLowerCase()
      const spec = openApiSpec?.[method]

      // Generate a default operationId if not found
      const pathSegments = route.openApiPath
        .replace(/^\/api\//, '')
        .replace(/\{[^}]+\}/g, 'by_id')
        .split('/')
        .filter(Boolean)
        .join('_')
      const defaultOperationId = `${methodLower}_${pathSegments}`

      pathEntry[methodLower] = {
        operationId: spec?.operationId || defaultOperationId,
        summary: spec?.summary || `${method} ${route.openApiPath}`,
        description: spec?.description || `${method} operation for ${route.openApiPath}`,
        tags: spec?.tags || [route.openApiPath.split('/')[2] || 'api'],
        responses: {
          '200': {
            description: 'Successful response',
          },
        },
      }
    }

    if (Object.keys(pathEntry).length > 0) {
      paths[route.openApiPath] = pathEntry
    }
  }

  return paths
}

/**
 * Generate the OpenAPI JSON file.
 */
export async function generateOpenApi(options: GenerateOpenApiOptions): Promise<GeneratorResult> {
  const { resolver, quiet = false } = options
  const result = createGeneratorResult()

  const outputDir = resolver.getOutputDir()
  const outFile = path.join(outputDir, 'openapi.generated.json')
  const checksumFile = path.join(outputDir, 'openapi.generated.checksum')

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Find all API routes
  const routes = await findApiRoutes(resolver)

  if (!quiet) {
    console.log(`[OpenAPI] Found ${routes.length} API route files`)
  }

  // Determine project root (cli package is at packages/cli/src/lib/generators/)
  // Try esbuild bundle approach first — produces full requestBody/response schemas
  let doc: Record<string, any> | null = await generateOpenApiViaBundle(routes, resolver, quiet)

  // Fallback to static regex approach (extracts operationId/summary/tags but no schemas)
  if (!doc) {
    if (!quiet) {
      console.log('[OpenAPI] Falling back to static regex approach')
    }
    const paths = buildOpenApiPaths(routes)
    doc = {
      openapi: '3.1.0',
      info: {
        title: 'Open Mercato API',
        version: '1.0.0',
        description: 'Auto-generated OpenAPI specification',
      },
      servers: [
        { url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000' },
      ],
      paths,
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Send an `Authorization: Bearer <token>` header with a valid API token.',
          },
        },
      },
    }
  }

  const output = JSON.stringify(doc, null, 2)
  const checksum = calculateChecksum(output)

  // Check if unchanged
  const existingChecksums = readChecksumRecord(checksumFile)
  if (existingChecksums && existingChecksums.content === checksum && fs.existsSync(outFile)) {
    result.filesUnchanged.push(outFile)
    if (!quiet) {
      console.log(`[OpenAPI] Skipped (unchanged): ${outFile}`)
    }
    return result
  }

  // Write the file
  fs.writeFileSync(outFile, output)
  writeChecksumRecord(checksumFile, { content: checksum, structure: '' })

  result.filesWritten.push(outFile)

  if (!quiet) {
    logGenerationResult(outFile, true)
    const pathCount = Object.keys(doc.paths || {}).length
    console.log(`[OpenAPI] Generated ${pathCount} API paths`)
  }

  return result
}
