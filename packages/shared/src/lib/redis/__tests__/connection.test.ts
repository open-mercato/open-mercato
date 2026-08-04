import { parseRedisUrl } from '../connection'

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
    })
  })
})
