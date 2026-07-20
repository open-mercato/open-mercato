import { readPushEnvelope, resolvePushBody } from '../push-envelope'
import type { MessageContent } from '../adapter'

describe('readPushEnvelope', () => {
  it('assembles title/body/data/options/silent from a well-formed envelope', () => {
    const content: MessageContent = {
      text: 'fallback text',
      raw: {
        title: 'Hello',
        body: 'Body text',
        data: { type: 'orders.shipped', notificationId: 'n1' },
        options: { sound: 'chime.caf', badge: 2 },
        silent: true,
      },
    }
    expect(readPushEnvelope(content)).toEqual({
      title: 'Hello',
      body: 'Body text',
      data: { type: 'orders.shipped', notificationId: 'n1' },
      options: { sound: 'chime.caf', badge: 2 },
      silent: true,
    })
  })

  it('defaults options to {} and silent to false', () => {
    const envelope = readPushEnvelope({ raw: { title: 'Hi' } })
    expect(envelope.options).toEqual({})
    expect(envelope.silent).toBe(false)
    expect(readPushEnvelope({ raw: { silent: 'yes' } }).silent).toBe(false)
  })

  it('falls back to content.text when raw.body is absent', () => {
    const content: MessageContent = {
      text: 'fallback text',
      raw: { title: 'Hello' },
    }
    expect(readPushEnvelope(content).body).toBe('fallback text')
  })

  it('defaults body to an empty string when neither raw.body nor text exist', () => {
    expect(readPushEnvelope({ raw: { title: 'Hello' } }).body).toBe('')
  })

  it('defaults title to an empty string when raw.title is missing or non-string', () => {
    expect(readPushEnvelope({ raw: {} }).title).toBe('')
    expect(readPushEnvelope({ raw: { title: 42 } }).title).toBe('')
  })

  it('coerces non-string data values via String()', () => {
    const content: MessageContent = {
      raw: { data: { count: 3, active: true } },
    }
    expect(readPushEnvelope(content).data).toEqual({ count: '3', active: 'true' })
  })

  it('drops null and undefined data entries', () => {
    const content: MessageContent = {
      raw: { data: { keep: 'yes', skipNull: null, skipUndefined: undefined } },
    }
    expect(readPushEnvelope(content).data).toEqual({ keep: 'yes' })
  })

  it('returns an empty data record when data is missing or not an object', () => {
    expect(readPushEnvelope({ raw: {} }).data).toEqual({})
    expect(readPushEnvelope({ raw: { data: 'nope' } }).data).toEqual({})
  })

  it('is defensive against an undefined content', () => {
    expect(readPushEnvelope(undefined)).toEqual({ title: '', body: '', data: {}, options: {}, silent: false })
  })
})

describe('resolvePushBody', () => {
  it('returns the envelope body when no options.body override is set', () => {
    expect(resolvePushBody(readPushEnvelope({ raw: { body: 'Body text' } }))).toBe('Body text')
  })

  it('prefers options.body when provided', () => {
    expect(resolvePushBody(readPushEnvelope({ raw: { body: 'Body text', options: { body: 'override' } } }))).toBe('override')
  })

  it('ignores an empty-string override and keeps the envelope body', () => {
    expect(resolvePushBody(readPushEnvelope({ raw: { body: 'Body text', options: { body: '' } } }))).toBe('Body text')
  })
})
