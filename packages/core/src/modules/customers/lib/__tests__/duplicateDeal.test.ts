import { dealCreateSchema } from '../../data/validators'
import { buildDealDuplicatePayload, formatDealDuplicateTitle } from '../duplicateDeal'

describe('buildDealDuplicatePayload', () => {
  it('copies pipeline placement, value, probability, close date and owner', () => {
    const payload = buildDealDuplicatePayload(
      {
        pipelineId: 'pipeline-1',
        pipelineStageId: 'stage-2',
        valueAmount: 1500,
        valueCurrency: 'EUR',
        probability: 40,
        expectedCloseAt: '2026-12-01T00:00:00.000Z',
        ownerUserId: 'user-7',
      },
      'Acme renewal (copy)',
    )

    expect(payload).toEqual({
      title: 'Acme renewal (copy)',
      status: 'open',
      pipelineId: 'pipeline-1',
      pipelineStageId: 'stage-2',
      valueAmount: 1500,
      valueCurrency: 'EUR',
      probability: 40,
      expectedCloseAt: '2026-12-01T00:00:00.000Z',
      ownerUserId: 'user-7',
    })
  })

  it('always opens the copy and omits empty source fields', () => {
    const payload = buildDealDuplicatePayload(
      {
        pipelineId: null,
        pipelineStageId: null,
        valueAmount: null,
        valueCurrency: '',
        probability: null,
        expectedCloseAt: null,
        ownerUserId: null,
      },
      'Bare deal (copy)',
    )

    expect(payload).toEqual({ title: 'Bare deal (copy)', status: 'open' })
  })

  it('keeps zero amounts and zero probability', () => {
    const payload = buildDealDuplicatePayload({ valueAmount: 0, probability: 0 }, 'Zero (copy)')

    expect(payload.valueAmount).toBe(0)
    expect(payload.probability).toBe(0)
  })

  it('never forwards the unassigned kanban lane as a stage id', () => {
    const payload = buildDealDuplicatePayload(
      { pipelineId: 'pipeline-1', pipelineStageId: '__unassigned' },
      'Lane deal (copy)',
    )

    expect(payload).toEqual({ title: 'Lane deal (copy)', status: 'open', pipelineId: 'pipeline-1' })
  })
})


describe('formatDealDuplicateTitle', () => {
  it.each(['(copy)', '(kopia)', '(사본)'])('preserves the localized %s marker for long titles', (marker) => {
    for (const length of [193, 198, 200]) {
      const title = formatDealDuplicateTitle('x'.repeat(length), (source) => `${source} ${marker}`)
      expect(title.length).toBeLessThanOrEqual(200)
      expect(title.endsWith(` ${marker}`)).toBe(true)
      expect(dealCreateSchema.shape.title.safeParse(title).success).toBe(true)
    }
  })

  it('preserves a normal title and the translated placement of the marker', () => {
    expect(formatDealDuplicateTitle('Acme', (title) => `${title} (copy)`)).toBe('Acme (copy)')
    expect(formatDealDuplicateTitle('x'.repeat(200), (title) => `(copy) ${title}`)).toBe(`(copy) ${'x'.repeat(193)}`)
  })

  it('does not split a surrogate pair at the shortening boundary', () => {
    const title = formatDealDuplicateTitle(`${'x'.repeat(192)}😀abcdef`, (source) => `${source} (copy)`)
    expect(title).toBe(`${'x'.repeat(192)} (copy)`)
  })
})
