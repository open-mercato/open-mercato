/**
 * Callback signature verification — the only thing standing between a stranger
 * and a settled workflow on this connector, since the platform's per-run token
 * proves WHICH run and the signature proves WHO.
 *
 * The raw-bytes rule gets its own test with a body no round trip reproduces,
 * because `JSON.stringify(JSON.parse(body))` passing a test that signs its own
 * re-serialised fixture is the classic way this check is broken silently.
 */

import { createHmac } from 'node:crypto'
import {
  buildSignatureHeaderValue,
  parseSignatureHeader,
  verifyGenericHttpSignature,
} from '../lib/signature'

const SECRET = 'whsec_a_real_looking_shared_secret'

/**
 * Key order and whitespace no serializer reproduces, so a re-serialised body
 * cannot accidentally verify.
 */
const RAW_BODY = '{"zeta":1,\n  "result":   {"answer":"ship it"},"alpha":[1,2,3]}'

describe('generic HTTP callback signature', () => {
  describe('hex scheme', () => {
    it('accepts a correctly signed body', () => {
      const header = buildSignatureHeaderValue({ rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' })
      expect(header).toMatch(/^[0-9a-f]{64}$/)
      expect(
        verifyGenericHttpSignature({ header, rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' }),
      ).toBe(true)
    })

    it('accepts an upper-cased digest — presentation is not the signature', () => {
      const header = buildSignatureHeaderValue({ rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' })
      expect(
        verifyGenericHttpSignature({
          header: header.toUpperCase(),
          rawBody: RAW_BODY,
          secret: SECRET,
          scheme: 'hex',
        }),
      ).toBe(true)
    })

    it('rejects a digest computed with another secret', () => {
      const header = buildSignatureHeaderValue({
        rawBody: RAW_BODY,
        secret: 'whsec_some_other_tenants_secret',
        scheme: 'hex',
      })
      expect(
        verifyGenericHttpSignature({ header, rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' }),
      ).toBe(false)
    })

    it('rejects a tampered body', () => {
      const header = buildSignatureHeaderValue({ rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' })
      const tampered = RAW_BODY.replace('ship it', 'do not ship it')
      expect(
        verifyGenericHttpSignature({ header, rawBody: tampered, secret: SECRET, scheme: 'hex' }),
      ).toBe(false)
    })

    it('verifies the RAW bytes: a re-serialised body does not verify', () => {
      const header = buildSignatureHeaderValue({ rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' })
      const reserialised = JSON.stringify(JSON.parse(RAW_BODY))
      // Same DATA, different BYTES. If this ever passes, the implementation has
      // started hashing something other than what arrived.
      expect(reserialised).not.toEqual(RAW_BODY)
      expect(
        verifyGenericHttpSignature({ header, rawBody: reserialised, secret: SECRET, scheme: 'hex' }),
      ).toBe(false)
    })
  })

  describe('sha256_prefix scheme', () => {
    it('accepts the prefixed form', () => {
      const header = buildSignatureHeaderValue({
        rawBody: RAW_BODY,
        secret: SECRET,
        scheme: 'sha256_prefix',
      })
      expect(header).toMatch(/^sha256=[0-9a-f]{64}$/)
      expect(
        verifyGenericHttpSignature({
          header,
          rawBody: RAW_BODY,
          secret: SECRET,
          scheme: 'sha256_prefix',
        }),
      ).toBe(true)
    })

    it('is the same digest as the hex scheme, only presented differently', () => {
      const bare = createHmac('sha256', SECRET).update(RAW_BODY).digest('hex')
      expect(
        buildSignatureHeaderValue({ rawBody: RAW_BODY, secret: SECRET, scheme: 'sha256_prefix' }),
      ).toBe(`sha256=${bare}`)
    })

    it('refuses a bare digest when the prefixed scheme is configured', () => {
      // Accepting both shapes under either setting would make the credential
      // decorative, and an operator who picked the wrong one would never find out.
      const bare = buildSignatureHeaderValue({ rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' })
      expect(
        verifyGenericHttpSignature({
          header: bare,
          rawBody: RAW_BODY,
          secret: SECRET,
          scheme: 'sha256_prefix',
        }),
      ).toBe(false)
    })

    it('refuses a prefixed digest when the hex scheme is configured', () => {
      const prefixed = buildSignatureHeaderValue({
        rawBody: RAW_BODY,
        secret: SECRET,
        scheme: 'sha256_prefix',
      })
      expect(
        verifyGenericHttpSignature({
          header: prefixed,
          rawBody: RAW_BODY,
          secret: SECRET,
          scheme: 'hex',
        }),
      ).toBe(false)
    })
  })

  describe('malformed input is never "probably fine"', () => {
    const valid = buildSignatureHeaderValue({ rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' })

    it.each([
      ['a missing header', null],
      ['an empty header', ''],
      ['a non-hex digest', 'not-a-digest'],
      ['a truncated digest', valid.slice(0, 32)],
      ['a digest with trailing junk', `${valid}zz`],
      ['a base64 digest', Buffer.from(valid, 'hex').toString('base64')],
    ])('rejects %s', (_label, header) => {
      expect(
        verifyGenericHttpSignature({ header, rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' }),
      ).toBe(false)
    })

    it('rejects everything when the tenant has no signing secret', () => {
      expect(
        verifyGenericHttpSignature({ header: valid, rawBody: RAW_BODY, secret: '', scheme: 'hex' }),
      ).toBe(false)
    })

    it('never throws, whatever it is handed', () => {
      expect(() =>
        verifyGenericHttpSignature({
          header: ',,,=,',
          rawBody: RAW_BODY,
          secret: SECRET,
          scheme: 'sha256_prefix',
        }),
      ).not.toThrow()
    })
  })

  describe('secret rotation', () => {
    it('accepts a header presenting several digests, one of which is ours', () => {
      const ours = buildSignatureHeaderValue({ rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' })
      const theirs = buildSignatureHeaderValue({
        rawBody: RAW_BODY,
        secret: 'whsec_the_previous_secret',
        scheme: 'hex',
      })
      expect(
        verifyGenericHttpSignature({
          header: `${theirs}, ${ours}`,
          rawBody: RAW_BODY,
          secret: SECRET,
          scheme: 'hex',
        }),
      ).toBe(true)
    })

    it('rejects the whole header when one part is malformed, rather than ignoring it', () => {
      const ours = buildSignatureHeaderValue({ rawBody: RAW_BODY, secret: SECRET, scheme: 'hex' })
      expect(parseSignatureHeader(`nonsense, ${ours}`, 'hex')).toEqual([])
    })
  })
})
