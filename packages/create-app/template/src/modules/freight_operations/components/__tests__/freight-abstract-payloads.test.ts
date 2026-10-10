/** @jest-environment node */
import { buildRespondPayload } from '../AbstractRespondDialog'
import { buildResolutionPayload } from '../AbstractResolveDialog'
import type { AbstractLineRow } from '../AbstractLinesSection'

function line(overrides: Partial<AbstractLineRow> & { id: string }): AbstractLineRow {
  return {
    line_number: 1,
    trip_id: `trip-${overrides.id}`,
    origin: 'Riyadh',
    destination: 'Dammam',
    total_net_amount: '450.00',
    tax_amount: '67.50',
    total_gross_amount: '517.50',
    currency_code: 'SAR',
    is_billable: true,
    dispute_status: 'none',
    ...overrides,
  }
}

const lines = [line({ id: 'line-1' }), line({ id: 'line-2', line_number: 2 })]

describe('abstract respond payload', () => {
  // Every unticked line is recorded as accepted; a disputed one carries the
  // customer's reason, which the dialog refuses to submit without.
  it('splits accepted lines from disputed ones', () => {
    const payload = buildRespondPayload(lines, {
      'line-2': { disputed: true, note: '  This trip never ran.  ' },
    })
    expect(payload.acceptedLineIds).toEqual(['line-1'])
    expect(payload.disputedLines).toEqual([{ lineId: 'line-2', note: 'This trip never ran.' }])
  })

  it('accepts everything when nothing is ticked', () => {
    const payload = buildRespondPayload(lines, {})
    expect(payload.acceptedLineIds).toEqual(['line-1', 'line-2'])
    expect(payload.disputedLines).toEqual([])
  })
})

describe('abstract resolve payload', () => {
  it('carries the amount only for an adjusted line', () => {
    const payload = buildResolutionPayload(lines, {
      'line-1': { resolution: 'adjusted', resolutionNote: 'Agreed a lower rate', adjustedAmountNet: '400' },
      'line-2': { resolution: 'accepted_as_disputed', resolutionNote: 'Cancelled at the gate', adjustedAmountNet: '999' },
    })
    expect(payload).toEqual([
      { lineId: 'line-1', resolution: 'adjusted', resolutionNote: 'Agreed a lower rate', adjustedAmountNet: '400' },
      { lineId: 'line-2', resolution: 'accepted_as_disputed', resolutionNote: 'Cancelled at the gate' },
    ])
  })

  it('defaults an unfinished line to rejecting the dispute', () => {
    const payload = buildResolutionPayload([lines[0]], {})
    expect(payload).toEqual([
      { lineId: 'line-1', resolution: 'rejected_dispute', resolutionNote: '' },
    ])
  })
})
