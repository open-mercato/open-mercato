import { parseRedisUrl } from '../connection'

describe('parseRedisUrl', () => {
  it('adds tls config for rediss URLs', () => {
    expect(parseRedisUrl('rediss://:secret@example.cache.amazonaws.com:6379/2')).toEqual({
      host: 'example.cache.amazonaws.com',
      port: 6379,
      password: 'secret',
      db: 2,
      tls: {},
    })
  })

  it('keeps tls undefined for plain redis URLs', () => {
    expect(parseRedisUrl('redis://:secret@localhost:6379/0')).toEqual({
      host: 'localhost',
      port: 6379,
      password: 'secret',
      db: 0,
      tls: undefined,
    })
  })
})
