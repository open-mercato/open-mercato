import { DEFAULT_MCP_HOST, isLoopbackHost, resolveMcpHost } from '../mcp-host-resolution'

describe('resolveMcpHost', () => {
  test('defaults to loopback when nothing is set', () => {
    expect(resolveMcpHost(undefined, undefined)).toBe(DEFAULT_MCP_HOST)
    expect(resolveMcpHost('', '')).toBe(DEFAULT_MCP_HOST)
  })

  test('an explicit host wins over the env var', () => {
    expect(resolveMcpHost('0.0.0.0', '10.0.0.5')).toBe('0.0.0.0')
  })

  test('the env var is used when no explicit host is given', () => {
    expect(resolveMcpHost(undefined, '0.0.0.0')).toBe('0.0.0.0')
  })

  test('trims whitespace and treats a blank value as unset', () => {
    expect(resolveMcpHost('  ', '  0.0.0.0  ')).toBe('0.0.0.0')
    expect(resolveMcpHost(' 10.0.0.5 ', undefined)).toBe('10.0.0.5')
  })
})

describe('isLoopbackHost', () => {
  test('recognizes every loopback alias', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(isLoopbackHost('LOCALHOST')).toBe(true)
  })

  test('rejects a real bind-everywhere or LAN address', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('10.0.0.5')).toBe(false)
    expect(isLoopbackHost('host.docker.internal')).toBe(false)
  })
})
