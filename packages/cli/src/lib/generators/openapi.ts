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

  // Build OpenAPI paths from routes
  const paths = buildOpenApiPaths(routes)
  const pathCount = Object.keys(paths).length

  // Build OpenAPI document
  const doc = {
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

  const output = JSON.stringify(doc, null, 2)
  const checksum = calculateChecksum(output)

  // Check if unchanged
  const existingChecksums = readChecksumRecord(checksumFile)
  if (existingChecksums && existingChecksums.content === checksum && fs.existsSync(outFile)) {
    result.skipped = true
    if (!quiet) {
      console.log(`[OpenAPI] Skipped (unchanged): ${outFile}`)
    }
    return result
  }

  // Write the file
  fs.writeFileSync(outFile, output)
  writeChecksumRecord(checksumFile, { content: checksum, structure: '' })

  result.written = true
  result.outputPath = outFile

  if (!quiet) {
    logGenerationResult('[OpenAPI]', outFile, result)
    console.log(`[OpenAPI] Generated ${pathCount} API paths`)
  }

  return result
}
