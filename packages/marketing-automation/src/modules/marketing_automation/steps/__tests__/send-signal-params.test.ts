import { sendSignalStep } from '../send-signal'
import { notifyStep } from '../notify'

/**
 * The two new steps' parameter contracts.
 *
 * Both are authored through a plain text inspector, so what a person can type has to arrive as the structure
 * the step needs — and a malformed topic has to be refused at SAVE time, because the alternative is a campaign
 * that looks saved and posts nothing anybody can match on.
 */
describe('send_signal parameters', () => {
  const parse = (params: unknown) => sendSignalStep.paramsSchema.safeParse(params)

  test('key=value lines become a map', () => {
    const result = parse({ topic: 'vip.unhappy', data: 'plan=gold\nscore={{survey.nps}}' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data).toEqual({ plan: 'gold', score: '{{survey.nps}}' })
    }
  })

  test('a map is accepted unchanged, so a tool can pass the structure', () => {
    const result = parse({ topic: 'vip.unhappy', data: { plan: 'gold' } })
    expect(result.success && result.data.data).toEqual({ plan: 'gold' })
  })

  /**
   * A line without `=` is dropped rather than guessed at: inventing a key for it would put a field the author
   * never wrote into somebody else's integration.
   */
  test('a line with no separator is dropped, not guessed at', () => {
    const result = parse({ topic: 'x', data: 'plan=gold\njust some words\n=novalue' })
    expect(result.success && result.data.data).toEqual({ plan: 'gold' })
  })

  test('only the FIRST separator splits, so a value may contain more', () => {
    const result = parse({ topic: 'x', data: 'url=https://shop.example/?a=1&b=2' })
    expect(result.success && result.data.data).toEqual({ url: 'https://shop.example/?a=1&b=2' })
  })

  test('blank lines and stray spacing are forgiven', () => {
    const result = parse({ topic: 'x', data: '\n  plan = gold  \n\n' })
    expect(result.success && result.data.data).toEqual({ plan: 'gold' })
  })

  /**
   * The topic ends up in somebody's integration code as a comparison, so a space or a quote in it is a topic
   * that gets mistyped there. Refused at save time rather than at send time.
   */
  test.each(['', 'has space', 'UPPER', 'quote"s', '.leading'])('refuses the topic %p', (topic) => {
    expect(parse({ topic }).success).toBe(false)
  })

  test.each(['vip.unhappy', 'order_placed', 'a-b.c_d', 'x1'])('accepts the topic %p', (topic) => {
    expect(parse({ topic }).success).toBe(true)
  })

  test('data defaults to empty, so a signal can be just a topic', () => {
    const result = parse({ topic: 'ping' })
    expect(result.success && result.data.data).toEqual({})
  })
})

describe('notify parameters', () => {
  const parse = (params: unknown) => notifyStep.paramsSchema.safeParse(params)

  test('defaults to the customer owner and to information', () => {
    const result = parse({ message: 'This VIP is unhappy' })
    expect(result.success && result.data).toMatchObject({ audience: 'owner', severity: 'info' })
  })

  test('a message is required, because a notice with no sentence says nothing', () => {
    expect(parse({}).success).toBe(false)
    expect(parse({ message: '' }).success).toBe(false)
  })

  /**
   * Two audiences and no more. "One named person" would embed a user id in a campaign definition, which then
   * outlives that person's employment — the same reason the rep pool stores ids and reads the directory.
   */
  test('refuses an audience it does not have', () => {
    expect(parse({ message: 'x', audience: 'everybody' }).success).toBe(false)
    expect(parse({ message: 'x', audience: 'team' }).success).toBe(true)
  })
})
