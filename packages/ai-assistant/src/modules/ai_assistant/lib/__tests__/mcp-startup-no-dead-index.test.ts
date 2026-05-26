import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as apiEndpointIndex from '../api-endpoint-index'

const LIB_DIR = join(__dirname, '..')

const MCP_ENTRY_FILES = [
  'http-server.ts',
  'mcp-server.ts',
  'mcp-dev-server.ts',
] as const

describe('issue #1876 — MCP boot must not index dead API endpoints', () => {
  describe('MCP entry points no longer call indexApiEndpoints', () => {
    test.each(MCP_ENTRY_FILES)(
      '%s does not import or call indexApiEndpoints',
      (file) => {
        const source = readFileSync(join(LIB_DIR, file), 'utf-8')
        expect(source).not.toMatch(/indexApiEndpoints/)
      },
    )
  })

  describe('api-endpoint-index public surface', () => {
    it('exports only the symbols Code Mode still relies on', () => {
      expect(typeof apiEndpointIndex.getApiEndpoints).toBe('function')
      expect(typeof apiEndpointIndex.getEndpointByOperationId).toBe('function')
      expect(typeof apiEndpointIndex.getRawOpenApiSpec).toBe('function')
      expect(typeof apiEndpointIndex.loadRichOpenApiSpec).toBe('function')
      expect(typeof apiEndpointIndex.setRawSpecCache).toBe('function')
      expect(typeof apiEndpointIndex.clearRawSpecCache).toBe('function')
      expect(typeof apiEndpointIndex.clearEndpointCache).toBe('function')
      expect(typeof apiEndpointIndex.simplifyRequestBodySchema).toBe('function')
    })

    it.each([
      'indexApiEndpoints',
      'searchEndpoints',
      'searchEndpointsFallback',
      'buildSearchableContent',
      'API_ENDPOINT_ENTITY',
    ])('no longer exports the dead-index symbol %s', (name) => {
      expect((apiEndpointIndex as Record<string, unknown>)[name]).toBeUndefined()
    })

    it('no longer imports SearchService or IndexableRecord types', () => {
      const source = readFileSync(join(LIB_DIR, 'api-endpoint-index.ts'), 'utf-8')
      expect(source).not.toMatch(/SearchService/)
      expect(source).not.toMatch(/IndexableRecord/)
      expect(source).not.toMatch(/bulkIndex/)
      expect(source).not.toMatch(/Promise\.race/)
    })
  })

  describe('legacy files are removed from the tree', () => {
    it.each([
      'api-discovery-tools.ts',
      'entity-graph-tools.ts',
      'api-endpoint-index-config.ts',
    ])('%s no longer exists on disk', (file) => {
      expect(existsSync(join(LIB_DIR, file))).toBe(false)
    })
  })
})
