import {
  validateMcpServerUrl,
  validateMcpServerConfig,
  saveMcpServerConfig,
  updateMcpServerConfig,
  type McpServerConfig,
} from '../mcp-server-config'

function makeResolver(initial: McpServerConfig[] = []) {
  const store: { value: McpServerConfig[] } = { value: initial }
  const service = {
    async getValue<T>(_module: string, _key: string, opts?: { defaultValue?: T }) {
      return (store.value as unknown as T) ?? (opts?.defaultValue as T)
    },
    async setValue(_module: string, _key: string, value: McpServerConfig[]) {
      store.value = value
    },
  }
  const resolver = {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'moduleConfigService') return service as unknown as T
      throw new Error(`unexpected resolve: ${name}`)
    },
  }
  return { resolver, store }
}

describe('issue #2672 — MCP server-config hardening', () => {
  describe('validateMcpServerUrl — protocol allowlist', () => {
    it.each(['file:///etc/passwd', 'gopher://example.com', 'data:text/plain,hi', 'ftp://example.com'])(
      'rejects non-http(s) protocol: %s',
      (url) => {
        expect(validateMcpServerUrl(url).valid).toBe(false)
      },
    )

    it('accepts a public https URL', () => {
      expect(validateMcpServerUrl('https://mcp.example.com/sse')).toEqual({ valid: true })
    })

    it('accepts a public http URL', () => {
      expect(validateMcpServerUrl('http://203.0.113.5:3001/mcp')).toEqual({ valid: true })
    })

    it('rejects a malformed URL', () => {
      expect(validateMcpServerUrl('not a url').valid).toBe(false)
    })
  })

  describe('validateMcpServerUrl — private / loopback / link-local hosts', () => {
    it.each([
      'http://localhost:3001/mcp',
      'http://sub.localhost/mcp',
      'http://127.0.0.1/mcp',
      'http://127.5.6.7/mcp',
      'http://0.0.0.0/mcp',
      'http://10.0.0.5/mcp',
      'http://172.16.0.9/mcp',
      'http://172.31.255.1/mcp',
      'http://192.168.1.1/mcp',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/mcp',
      'http://[fe80::1]/mcp',
      'http://[fc00::1]/mcp',
      'http://[::ffff:127.0.0.1]/mcp',
    ])('rejects blocked host: %s', (url) => {
      expect(validateMcpServerUrl(url).valid).toBe(false)
    })

    it('does not block a public host in the 172.x range outside RFC1918', () => {
      expect(validateMcpServerUrl('http://172.32.0.1/mcp')).toEqual({ valid: true })
    })
  })

  describe('validateMcpServerConfig', () => {
    it('rejects an http config whose URL is a loopback address', () => {
      const result = validateMcpServerConfig({
        name: 'evil',
        type: 'http',
        url: 'http://127.0.0.1/mcp',
        enabled: true,
      })
      expect(result.valid).toBe(false)
    })

    it('accepts an http config with a public URL', () => {
      const result = validateMcpServerConfig({
        name: 'good',
        type: 'http',
        url: 'https://mcp.example.com/sse',
        enabled: true,
      })
      expect(result).toEqual({ valid: true })
    })

    it('requires a command for stdio configs', () => {
      expect(validateMcpServerConfig({ name: 'x', type: 'stdio', enabled: true }).valid).toBe(false)
    })
  })

  describe('saveMcpServerConfig — fail-closed + CSPRNG id', () => {
    it('generates a UUID-based id and persists a valid config', async () => {
      const { resolver, store } = makeResolver()
      const saved = await saveMcpServerConfig(resolver, {
        name: 'good',
        type: 'http',
        url: 'https://mcp.example.com/sse',
        enabled: true,
      })
      expect(saved.id).toMatch(
        /^mcp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
      expect(store.value).toHaveLength(1)
    })

    it('refuses to persist a config with an SSRF-prone URL', async () => {
      const { resolver, store } = makeResolver()
      await expect(
        saveMcpServerConfig(resolver, {
          name: 'evil',
          type: 'http',
          url: 'http://169.254.169.254/latest/meta-data',
          enabled: true,
        }),
      ).rejects.toThrow(/Invalid MCP server config/i)
      expect(store.value).toHaveLength(0)
    })
  })

  describe('updateMcpServerConfig — fail-closed', () => {
    it('refuses an update that introduces a blocked URL', async () => {
      const existing: McpServerConfig = {
        id: 'mcp_existing',
        name: 'good',
        type: 'http',
        url: 'https://mcp.example.com/sse',
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const { resolver, store } = makeResolver([existing])
      await expect(
        updateMcpServerConfig(resolver, 'mcp_existing', { url: 'file:///etc/passwd' }),
      ).rejects.toThrow(/Invalid MCP server config/i)
      expect(store.value[0]!.url).toBe('https://mcp.example.com/sse')
    })
  })
})
