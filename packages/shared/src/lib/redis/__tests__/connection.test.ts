import { parseRedisUrl, REDIS_WIRE_PROTOCOL } from '../connection'

describe('parseRedisUrl', () => {
  it('adds tls config for rediss URLs', () => {
    expect(parseRedisUrl('rediss://:secret@example.cache.amazonaws.com:6379/2')).toEqual({
      host: 'example.cache.amazonaws.com',
      port: 6379,
      username: undefined,
      password: 'secret',
      db: 2,
      tls: {},
      family: undefined,
      protocol: 2,
    })
  })

  it('keeps tls undefined for plain redis URLs', () => {
    expect(parseRedisUrl('redis://:secret@localhost:6379/0')).toEqual({
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: 'secret',
      db: 0,
      tls: undefined,
      family: undefined,
      protocol: 2,
    })
  })

  it('preserves ACL credentials and supported address-family options', () => {
    expect(parseRedisUrl('rediss://app%2Duser:p%40ss@example.com:6380/4?family=6')).toEqual({
      host: 'example.com',
      port: 6380,
      username: 'app-user',
      password: 'p@ss',
      db: 4,
      tls: {},
      family: 6,
      protocol: 2,
    })
  })

  it('pins the wire protocol to RESP2 even on the malformed-URL fallback', () => {
    expect(parseRedisUrl('not a url')).toEqual({
      host: 'localhost',
      port: 6379,
      protocol: 2,
    })
  })
})

describe('REDIS_WIRE_PROTOCOL', () => {
  it('stays on RESP2 so ioredis 6 does not silently negotiate RESP3', () => {
    expect(REDIS_WIRE_PROTOCOL).toBe(2)
  })
})
