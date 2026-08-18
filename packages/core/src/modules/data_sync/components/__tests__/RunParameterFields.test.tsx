/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { RunParameter } from '../../lib/adapter'
import {
  RunParameterFields,
  buildDefaultRunParameterValues,
  buildRunFailureMessage,
  buildRunParametersPayload,
  hasRequiredRunParameterWithoutDefault,
  type RunParameterFormValue,
} from '../RunParameterFields'

const params: RunParameter[] = [
  { key: 'dryRun', label: 'Dry run', type: 'boolean', defaultValue: true },
  { key: 'startId', label: 'Start id', type: 'number', min: 0, placeholder: 'e.g. 900000' },
  { key: 'note', label: 'Note', type: 'string' },
]

describe('buildDefaultRunParameterValues', () => {
  it('seeds booleans from defaultValue and stringifies the rest', () => {
    expect(buildDefaultRunParameterValues(params)).toEqual({
      dryRun: true,
      startId: '',
      note: '',
    })
  })

  it('stringifies a non-boolean default so it can seed a text input', () => {
    const seeded = buildDefaultRunParameterValues([
      { key: 'startId', label: 'Start id', type: 'number', defaultValue: 42 },
    ])
    expect(seeded).toEqual({ startId: '42' })
  })

  it('treats a missing boolean default as false rather than undefined', () => {
    expect(buildDefaultRunParameterValues([
      { key: 'bulk', label: 'Bulk', type: 'boolean' },
    ])).toEqual({ bulk: false })
  })
})

describe('buildRunParametersPayload', () => {
  it('keeps only declared keys', () => {
    const values: Record<string, RunParameterFormValue> = {
      dryRun: false,
      startId: '900000',
      note: 'backfill',
      staleKey: 'dropped',
    }
    expect(buildRunParametersPayload(params, values)).toEqual({
      dryRun: false,
      startId: '900000',
      note: 'backfill',
    })
  })

  it('omits declared keys the form never seeded', () => {
    expect(buildRunParametersPayload(params, { note: 'only' })).toEqual({ note: 'only' })
  })
})

describe('hasRequiredRunParameterWithoutDefault', () => {
  it('is false when every required param has a default to fall back on', () => {
    expect(hasRequiredRunParameterWithoutDefault([
      { key: 'mode', label: 'Mode', type: 'string', required: true, defaultValue: 'fast' },
      { key: 'note', label: 'Note', type: 'string' },
    ])).toBe(false)
  })

  it('is true when a required param has no default', () => {
    expect(hasRequiredRunParameterWithoutDefault([
      { key: 'cursor', label: 'Cursor', type: 'string', required: true },
    ])).toBe(true)
  })

  it('ignores an optional param without a default', () => {
    expect(hasRequiredRunParameterWithoutDefault(params)).toBe(false)
  })

  // A switch always submits true/false, so a boolean's `required` can never
  // fail. Counting it here would block the schedule-table run forever for a
  // constraint the run API does not enforce.
  it('ignores a required boolean without a default', () => {
    expect(hasRequiredRunParameterWithoutDefault([
      { key: 'dryRun', label: 'Dry run', type: 'boolean', required: true },
    ])).toBe(false)
  })
})

describe('buildRunFailureMessage', () => {
  // Regression: the dashboard used to flash only the top-level `error`, so an
  // out-of-range value surfaced as "Invalid run parameters" with no hint which
  // field was wrong.
  it('prefers the per-key parameter messages over the generic error', () => {
    const message = buildRunFailureMessage(
      {
        error: 'Invalid run parameters',
        details: { parameters: [{ key: 'startId', message: 'Start id must be at least 0.' }] },
      },
      'Failed to start sync run',
    )
    expect(message).toBe('Start id must be at least 0.')
  })

  it('joins multiple parameter messages', () => {
    const message = buildRunFailureMessage(
      {
        error: 'Invalid run parameters',
        details: {
          parameters: [
            { key: 'startId', message: 'Start id must be at least 0.' },
            { key: 'mode', message: 'Mode must be one of: fast, thorough.' },
          ],
        },
      },
      'fallback',
    )
    expect(message).toBe('Start id must be at least 0. Mode must be one of: fast, thorough.')
  })

  it('falls back to the top-level error for non-parameter failures', () => {
    expect(buildRunFailureMessage({ error: 'Integration is disabled' }, 'fallback'))
      .toBe('Integration is disabled')
  })

  it('renders a translated message from the error code when a translator is given', () => {
    const t = jest.fn((_key: string, fallback?: string, vars?: Record<string, unknown>) =>
      `PL:${String(vars?.label)}:${String(vars?.min)}`) as never
    const message = buildRunFailureMessage(
      {
        error: 'Invalid run parameters',
        details: { parameters: [{ key: 'startId', code: 'min', params: { label: 'Start id', min: 0 }, message: 'Start id must be at least 0.' }] },
      },
      'fallback',
      t,
    )
    // The server's English sentence must not win over the translated one.
    expect(message).toBe('PL:Start id:0')
  })

  it('falls back to the server message when the code is unknown', () => {
    const t = jest.fn(() => 'unused') as never
    const message = buildRunFailureMessage(
      { details: { parameters: [{ key: 'x', code: 'not-a-code', message: 'Raw server text.' }] } },
      'fallback',
      t,
    )
    expect(message).toBe('Raw server text.')
  })

  it('falls back to the provided default when the body carries nothing usable', () => {
    expect(buildRunFailureMessage(null, 'Failed to start sync run')).toBe('Failed to start sync run')
    expect(buildRunFailureMessage({ details: { parameters: [] } }, 'Failed to start sync run'))
      .toBe('Failed to start sync run')
    expect(buildRunFailureMessage({ details: { parameters: [{ key: 'x', message: '  ' }] } }, 'fallback'))
      .toBe('fallback')
  })
})

describe('RunParameterFields', () => {
  it('renders a control per declared parameter and reports edits by key', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <RunParameterFields
        params={params}
        values={{ dryRun: true, startId: '', note: '' }}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('Dry run')).toBeInTheDocument()
    expect(screen.getByText('Start id')).toBeInTheDocument()

    const numberInput = screen.getByPlaceholderText('e.g. 900000')
    expect(numberInput).toHaveAttribute('inputmode', 'numeric')

    fireEvent.change(numberInput, { target: { value: '900123' } })
    expect(onChange).toHaveBeenCalledWith('startId', '900123')
  })

  it('marks required parameters with an asterisk', () => {
    renderWithProviders(
      <RunParameterFields
        params={[{ key: 'cursor', label: 'Cursor', type: 'string', required: true }]}
        values={{ cursor: '' }}
        onChange={jest.fn()}
      />,
    )
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('renders nothing when no parameters are declared', () => {
    const { container } = renderWithProviders(
      <RunParameterFields params={[]} values={{}} onChange={jest.fn()} />,
    )
    expect(container.querySelectorAll('input')).toHaveLength(0)
  })
})
