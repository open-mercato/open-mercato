import {
  decideDraftRestore,
  isServerDraftEligible,
  stableSerializeDefinition,
} from '../draft-restore'

describe('isServerDraftEligible', () => {
  it('accepts a saved definition UUID', () => {
    expect(isServerDraftEligible('7f6bfbd2-58f5-4a3d-9c41-2f2b9a35d2f0')).toBe(true)
  })

  it('rejects null, undefined, and empty ids (unsaved definitions)', () => {
    expect(isServerDraftEligible(null)).toBe(false)
    expect(isServerDraftEligible(undefined)).toBe(false)
    expect(isServerDraftEligible('')).toBe(false)
  })

  it('rejects code-defined workflow ids', () => {
    expect(isServerDraftEligible('code:order_approval')).toBe(false)
  })

  it('rejects arbitrary non-uuid ids', () => {
    expect(isServerDraftEligible('order-approval')).toBe(false)
  })
})

describe('stableSerializeDefinition', () => {
  it('is insensitive to object key order', () => {
    expect(stableSerializeDefinition({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableSerializeDefinition({ a: { c: 3, d: 2 }, b: 1 }),
    )
  })

  it('drops undefined values so absent and undefined keys compare equal', () => {
    expect(stableSerializeDefinition({ steps: [], triggers: undefined })).toBe(
      stableSerializeDefinition({ steps: [] }),
    )
  })

  it('remains sensitive to array order', () => {
    expect(stableSerializeDefinition({ steps: [1, 2] })).not.toBe(
      stableSerializeDefinition({ steps: [2, 1] }),
    )
  })

  it('serializes null and primitives', () => {
    expect(stableSerializeDefinition(null)).toBe('null')
    expect(stableSerializeDefinition('x')).toBe('"x"')
  })
})

describe('decideDraftRestore', () => {
  const loadedDefinition = {
    steps: [{ stepId: 'start', stepType: 'START' }],
    transitions: [],
  }

  it('does not offer restore when there is no draft definition', () => {
    expect(
      decideDraftRestore({
        draftDefinition: null,
        draftBaseUpdatedAt: null,
        loadedDefinition,
        definitionUpdatedAt: '2026-07-27T10:00:00.000Z',
      }),
    ).toEqual({ offerRestore: false })
  })

  it('does not offer restore when the draft matches the loaded definition (any key order)', () => {
    expect(
      decideDraftRestore({
        draftDefinition: {
          transitions: [],
          steps: [{ stepType: 'START', stepId: 'start' }],
        },
        draftBaseUpdatedAt: '2026-07-27T10:00:00.000Z',
        loadedDefinition,
        definitionUpdatedAt: '2026-07-27T10:00:00.000Z',
      }),
    ).toEqual({ offerRestore: false })
  })

  it('offers restore without a base mismatch when the draft was made against the current version', () => {
    expect(
      decideDraftRestore({
        draftDefinition: { ...loadedDefinition, steps: [] },
        draftBaseUpdatedAt: '2026-07-27T10:00:00.000Z',
        loadedDefinition,
        definitionUpdatedAt: '2026-07-27T10:00:00.000Z',
      }),
    ).toEqual({ offerRestore: true, baseMismatch: false })
  })

  it('a draft differing only in the interpolation mode is a real draft', () => {
    expect(
      decideDraftRestore({
        draftDefinition: { ...loadedDefinition, interpolation: 'strict' },
        draftBaseUpdatedAt: '2026-07-27T10:00:00.000Z',
        loadedDefinition,
        definitionUpdatedAt: '2026-07-27T10:00:00.000Z',
      }),
    ).toEqual({ offerRestore: true, baseMismatch: false })
    expect(
      decideDraftRestore({
        draftDefinition: { ...loadedDefinition, interpolation: 'strict' },
        draftBaseUpdatedAt: '2026-07-27T10:00:00.000Z',
        loadedDefinition: { ...loadedDefinition, interpolation: 'strict' },
        definitionUpdatedAt: '2026-07-27T10:00:00.000Z',
      }),
    ).toEqual({ offerRestore: false })
  })

  it('treats equivalent timestamps in different string forms as the same base', () => {
    expect(
      decideDraftRestore({
        draftDefinition: { ...loadedDefinition, steps: [] },
        draftBaseUpdatedAt: '2026-07-27T10:00:00.000Z',
        loadedDefinition,
        definitionUpdatedAt: '2026-07-27T12:00:00.000+02:00',
      }),
    ).toEqual({ offerRestore: true, baseMismatch: false })
  })

  it('flags a base mismatch when the definition changed after the draft was made', () => {
    expect(
      decideDraftRestore({
        draftDefinition: { ...loadedDefinition, steps: [] },
        draftBaseUpdatedAt: '2026-07-27T10:00:00.000Z',
        loadedDefinition,
        definitionUpdatedAt: '2026-07-27T11:30:00.000Z',
      }),
    ).toEqual({ offerRestore: true, baseMismatch: true })
  })

  it('does not flag a mismatch when either timestamp is unknown', () => {
    expect(
      decideDraftRestore({
        draftDefinition: { ...loadedDefinition, steps: [] },
        draftBaseUpdatedAt: null,
        loadedDefinition,
        definitionUpdatedAt: '2026-07-27T11:30:00.000Z',
      }),
    ).toEqual({ offerRestore: true, baseMismatch: false })
  })
})
