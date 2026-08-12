import { createHmac } from 'node:crypto'
import {
  ELEVENLABS_SIGNATURE_TOLERANCE_SECONDS,
  parseElevenLabsSignatureHeader,
  verifyElevenLabsSignature,
} from '../lib/signature'

const SECRET = 'wsec_test_secret_value'
const NOW_MS = 1_800_000_000_000
const NOW_SECONDS = Math.floor(NOW_MS / 1000)

// Deliberately NOT canonical JSON: extra whitespace and an out-of-alphabetical
// key order, so a re-serialised body is provably different from these bytes.
const RAW_BODY = '{ "type":"post_call_transcription",  "event_timestamp": 1800000000, "data": {"conversation_id":"conv_1"} }'

function sign(rawBody: string, timestampSeconds: number, secret = SECRET): string {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')
  return `t=${timestampSeconds},v0=${digest}`
}

describe('verifyElevenLabsSignature', () => {
  it('accepts a correctly signed, fresh callback', () => {
    expect(
      verifyElevenLabsSignature({
        header: sign(RAW_BODY, NOW_SECONDS),
        rawBody: RAW_BODY,
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toBe(true)
  })

  it('rejects a signature produced with a different secret', () => {
    expect(
      verifyElevenLabsSignature({
        header: sign(RAW_BODY, NOW_SECONDS, 'wsec_someone_elses_secret'),
        rawBody: RAW_BODY,
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toBe(false)
  })

  it('rejects a tampered body', () => {
    const header = sign(RAW_BODY, NOW_SECONDS)
    const tampered = RAW_BODY.replace('conv_1', 'conv_2')
    expect(
      verifyElevenLabsSignature({ header, rawBody: tampered, secret: SECRET, nowMs: NOW_MS }),
    ).toBe(false)
  })

  it('rejects a re-serialised body — verification is over the RAW bytes', () => {
    // This is the single easiest way to silently break every signature check:
    // parse the body before verifying and hand the verifier the round-trip.
    const header = sign(RAW_BODY, NOW_SECONDS)
    const reSerialised = JSON.stringify(JSON.parse(RAW_BODY))
    expect(reSerialised).not.toEqual(RAW_BODY)
    expect(
      verifyElevenLabsSignature({ header, rawBody: reSerialised, secret: SECRET, nowMs: NOW_MS }),
    ).toBe(false)
  })

  it('rejects a timestamp older than the 1800 s replay window', () => {
    const stale = NOW_SECONDS - ELEVENLABS_SIGNATURE_TOLERANCE_SECONDS - 1
    expect(
      verifyElevenLabsSignature({
        header: sign(RAW_BODY, stale),
        rawBody: RAW_BODY,
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toBe(false)
  })

  it('accepts a timestamp exactly at the edge of the replay window', () => {
    const edge = NOW_SECONDS - ELEVENLABS_SIGNATURE_TOLERANCE_SECONDS
    expect(
      verifyElevenLabsSignature({
        header: sign(RAW_BODY, edge),
        rawBody: RAW_BODY,
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toBe(true)
  })

  it('does not bound a future timestamp — clock skew must not drop a valid callback', () => {
    const future = NOW_SECONDS + 600
    expect(
      verifyElevenLabsSignature({
        header: sign(RAW_BODY, future),
        rawBody: RAW_BODY,
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toBe(true)
  })

  it.each([
    ['missing header', null],
    ['empty header', ''],
    ['no timestamp', 'v0=deadbeef'],
    ['no digest', `t=${NOW_SECONDS}`],
    ['non-numeric timestamp', `t=abc,v0=deadbeef`],
    ['non-hex digest', `t=${NOW_SECONDS},v0=zzzz`],
    ['unstructured garbage', 'not-a-signature'],
  ])('rejects a malformed header (%s)', (_label, header) => {
    expect(
      verifyElevenLabsSignature({ header, rawBody: RAW_BODY, secret: SECRET, nowMs: NOW_MS }),
    ).toBe(false)
  })

  it('rejects when no webhook secret is configured', () => {
    expect(
      verifyElevenLabsSignature({
        header: sign(RAW_BODY, NOW_SECONDS),
        rawBody: RAW_BODY,
        secret: '',
        nowMs: NOW_MS,
      }),
    ).toBe(false)
  })

  it('accepts an upper-case digest — presentation is not the signature', () => {
    const header = sign(RAW_BODY, NOW_SECONDS).toUpperCase().replace('T=', 't=').replace('V0=', 'v0=')
    expect(
      verifyElevenLabsSignature({ header, rawBody: RAW_BODY, secret: SECRET, nowMs: NOW_MS }),
    ).toBe(true)
  })

  it('checks every presented v0 digest, so a rotation that signs twice still verifies', () => {
    const good = sign(RAW_BODY, NOW_SECONDS).split('v0=')[1]
    const header = `t=${NOW_SECONDS},v0=${'0'.repeat(64)},v0=${good}`
    expect(
      verifyElevenLabsSignature({ header, rawBody: RAW_BODY, secret: SECRET, nowMs: NOW_MS }),
    ).toBe(true)
  })
})

describe('parseElevenLabsSignatureHeader', () => {
  it('parses the documented header shape', () => {
    const parsed = parseElevenLabsSignatureHeader(`t=${NOW_SECONDS},v0=${'a'.repeat(64)}`)
    expect(parsed).toEqual({ timestampSeconds: NOW_SECONDS, digests: ['a'.repeat(64)] })
  })

  it('returns null when the timestamp is not an integer', () => {
    expect(parseElevenLabsSignatureHeader('t=1.5,v0=abcd')).toBeNull()
  })
})
