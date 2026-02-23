#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRootDir = path.resolve(scriptDir, '..')

const sourceInput =
  process.env.OPEN_MERCATO_OPENAPI_SOURCE ??
  process.env.OPEN_MERCATO_BASE_URL ??
  process.argv[2] ??
  'http://localhost:3000'
const outputPath = process.env.OPEN_MERCATO_OPENAPI_OUT
  ? path.resolve(process.env.OPEN_MERCATO_OPENAPI_OUT)
  : path.resolve(packageRootDir, 'src/resources/openapi.generated.json')

function isHttpSource(value) {
  return value.startsWith('http://') || value.startsWith('https://')
}

async function loadFromHttp(baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/docs/openapi`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(30000)
  })

  if (!response.ok) {
    throw new Error(`OpenAPI request failed: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

async function loadFromFile(inputPath) {
  const absolutePath = path.resolve(inputPath)
  const fileContents = await readFile(absolutePath, 'utf-8')
  return JSON.parse(fileContents)
}

async function main() {
  const openApiDocument = isHttpSource(sourceInput)
    ? await loadFromHttp(sourceInput)
    : await loadFromFile(sourceInput)

  if (!openApiDocument || typeof openApiDocument !== 'object') {
    throw new Error('OpenAPI response is not a JSON object')
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(openApiDocument, null, 2)}\n`, 'utf-8')

  const pathCount = Object.keys(openApiDocument.paths ?? {}).length
  console.log(`[n8n-open-mercato] OpenAPI written to ${outputPath}`)
  console.log(`[n8n-open-mercato] Source: ${sourceInput}`)
  console.log(`[n8n-open-mercato] API paths: ${pathCount}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[n8n-open-mercato] OpenAPI generation failed: ${message}`)
  process.exit(1)
})
