import { V1_FIELD_TYPES } from '../schema/field-type-registry'
import { SIGNATURE_TYPE, readSignatureModes } from '../schema/signature-field'

const VALID_SHA = 'a'.repeat(64)

const drawnValue = {
  mode: 'drawn' as const,
  image: 'data:image/png;base64,AAAA',
  affirmed: true as const,
  signedAt: '2026-05-21T10:00:00.000Z',
  clauseSha256: VALID_SHA,
}

const typedValue = {
  mode: 'typed' as const,
  typedName: 'Jane Doe',
  affirmed: true as const,
  signedAt: '2026-05-21T10:00:00.000Z',
  clauseSha256: VALID_SHA,
}

describe('signature field type (W2)', () => {
  it('is registered on the default registry with the signature widget + pen-tool icon', () => {
    const spec = V1_FIELD_TYPES.signature
    expect(spec).toBe(SIGNATURE_TYPE)
    expect(spec.category).toBe('input')
    expect(spec.icon).toBe('pen-tool')
    expect(spec.displayNameKey).toBe('forms.studio.palette.input.signature')
    expect(spec.defaultUiSchema).toEqual({ widget: 'signature' })
    expect(spec.renderer).toBeNull()
  })

  describe('validator', () => {
    it('treats null / undefined as valid (required-ness enforced elsewhere)', () => {
      expect(SIGNATURE_TYPE.validator(null, {})).toBe(true)
      expect(SIGNATURE_TYPE.validator(undefined, {})).toBe(true)
    })

    it('rejects non-objects and arrays', () => {
      expect(SIGNATURE_TYPE.validator('signed', {})).not.toBe(true)
      expect(SIGNATURE_TYPE.validator(42, {})).not.toBe(true)
      expect(SIGNATURE_TYPE.validator([], {})).not.toBe(true)
    })

    it('rejects an unaffirmed signature', () => {
      expect(SIGNATURE_TYPE.validator({ ...drawnValue, affirmed: false }, {})).not.toBe(true)
      expect(SIGNATURE_TYPE.validator({ ...typedValue, affirmed: undefined }, {})).not.toBe(true)
    })

    it('requires a clauseSha256 (and a well-formed one)', () => {
      expect(SIGNATURE_TYPE.validator({ ...drawnValue, clauseSha256: undefined }, {})).not.toBe(true)
      expect(SIGNATURE_TYPE.validator({ ...drawnValue, clauseSha256: 'short' }, {})).not.toBe(true)
      expect(SIGNATURE_TYPE.validator({ ...drawnValue, clauseSha256: 'Z'.repeat(64) }, {})).not.toBe(true)
    })

    it('requires a valid signedAt timestamp', () => {
      expect(SIGNATURE_TYPE.validator({ ...drawnValue, signedAt: 'not-a-date' }, {})).not.toBe(true)
      expect(SIGNATURE_TYPE.validator({ ...drawnValue, signedAt: undefined }, {})).not.toBe(true)
    })

    it('rejects a drawn signature without an image', () => {
      expect(SIGNATURE_TYPE.validator({ ...drawnValue, image: '' }, {})).not.toBe(true)
      expect(SIGNATURE_TYPE.validator({ ...drawnValue, image: undefined }, {})).not.toBe(true)
    })

    it('rejects a typed signature with an empty name', () => {
      expect(SIGNATURE_TYPE.validator({ ...typedValue, typedName: '   ' }, {})).not.toBe(true)
      expect(SIGNATURE_TYPE.validator({ ...typedValue, typedName: undefined }, {})).not.toBe(true)
    })

    it('rejects a mode not allowed by x-om-signature-modes', () => {
      expect(SIGNATURE_TYPE.validator(typedValue, { 'x-om-signature-modes': ['drawn'] })).not.toBe(true)
      expect(SIGNATURE_TYPE.validator(drawnValue, { 'x-om-signature-modes': ['drawn'] })).toBe(true)
    })

    it('accepts a valid drawn signature', () => {
      expect(SIGNATURE_TYPE.validator(drawnValue, {})).toBe(true)
    })

    it('accepts a valid typed signature', () => {
      expect(SIGNATURE_TYPE.validator(typedValue, {})).toBe(true)
    })
  })

  describe('exportAdapter', () => {
    it('formats a typed signature with the signer name and timestamp', () => {
      expect(SIGNATURE_TYPE.exportAdapter(typedValue)).toBe('Signed by Jane Doe on 2026-05-21T10:00:00.000Z')
    })

    it('formats a drawn signature with the "drawn" placeholder and timestamp', () => {
      expect(SIGNATURE_TYPE.exportAdapter(drawnValue)).toBe('Signed by drawn on 2026-05-21T10:00:00.000Z')
    })

    it('exports an empty string for non-objects and missing mode', () => {
      expect(SIGNATURE_TYPE.exportAdapter(null)).toBe('')
      expect(SIGNATURE_TYPE.exportAdapter('signed')).toBe('')
      expect(SIGNATURE_TYPE.exportAdapter({ signedAt: '2026-05-21T10:00:00.000Z' })).toBe('')
    })
  })

  describe('readSignatureModes', () => {
    it('defaults to both modes when absent or malformed', () => {
      expect(readSignatureModes({})).toEqual(['drawn', 'typed'])
      expect(readSignatureModes({ 'x-om-signature-modes': 'drawn' })).toEqual(['drawn', 'typed'])
      expect(readSignatureModes({ 'x-om-signature-modes': [] })).toEqual(['drawn', 'typed'])
      expect(readSignatureModes({ 'x-om-signature-modes': ['bogus'] })).toEqual(['drawn', 'typed'])
    })

    it('returns the configured subset', () => {
      expect(readSignatureModes({ 'x-om-signature-modes': ['typed'] })).toEqual(['typed'])
    })
  })
})
