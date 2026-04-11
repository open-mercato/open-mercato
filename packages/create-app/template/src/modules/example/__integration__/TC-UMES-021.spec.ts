import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

interface OpenApiOperation {
  summary?: string
}

interface OpenApiDocument {
  openapi?: string
  paths?: Record<string, Record<string, OpenApiOperation | undefined> | undefined>
}

const isStandaloneApp = fs.existsSync(path.join(process.cwd(), 'src', 'modules.ts'))
const generatedOpenApiPath = path.join(process.cwd(), '.mercato', 'generated', 'openapi.generated.json')

function readGeneratedOpenApi(): OpenApiDocument {
  return JSON.parse(fs.readFileSync(generatedOpenApiPath, 'utf8')) as OpenApiDocument
}

test.describe('TC-UMES-021: Standalone OpenAPI generator parity', () => {
  test.skip(!isStandaloneApp, 'This parity check is specific to scaffolded standalone apps.')

  test('generated OpenAPI artifact includes local and installed module routes', async ({ request }) => {
    const docsResponse = await request.get('/api/docs/openapi')
    expect(docsResponse.ok()).toBeTruthy()

    expect(fs.existsSync(generatedOpenApiPath)).toBe(true)

    const generatedDoc = readGeneratedOpenApi()
    const runtimeDoc = (await docsResponse.json()) as OpenApiDocument

    expect(generatedDoc.openapi).toBe('3.1.0')

    expect(generatedDoc.paths?.['/api/example/blog/{id}']?.get?.summary).toBe('Fetch demo blog payload')
    expect(generatedDoc.paths?.['/api/example/blog/{id}']?.post?.summary).toBe('Create demo blog payload')
    expect(runtimeDoc.paths?.['/api/example/blog/{id}']?.get?.summary).toBe('Fetch demo blog payload')
    expect(runtimeDoc.paths?.['/api/example/blog/{id}']?.post?.summary).toBe('Create demo blog payload')

    expect(generatedDoc.paths?.['/api/example/organizations']?.get?.summary).toBe('Resolve organization labels')
    expect(runtimeDoc.paths?.['/api/example/organizations']?.get?.summary).toBe('Resolve organization labels')

    expect(generatedDoc.paths?.['/api/customers/people']).toBeTruthy()
    expect(runtimeDoc.paths?.['/api/customers/people']).toBeTruthy()
  })
})
