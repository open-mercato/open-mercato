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
