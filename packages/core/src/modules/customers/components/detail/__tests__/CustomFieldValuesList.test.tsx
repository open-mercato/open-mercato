/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { CustomFieldValuesList } from '../CustomFieldValuesList'

describe('CustomFieldValuesList', () => {
  it('matches prefixed values against bare definition keys', () => {
    render(
      <CustomFieldValuesList
        values={{ cf_priority: 'High' }}
        definitions={[
          {
            key: 'priority',
            kind: 'text',
            label: 'Priority',
          },
        ]}
      />,
    )

    expect(screen.getByText('Priority')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('formats prefixed keys without a Cf prefix when no definition exists', () => {
    render(
      <CustomFieldValuesList
        values={{ cf_follow_up_owner: 'Ada Lovelace' }}
      />,
    )

    expect(screen.getByText('Follow Up Owner')).toBeInTheDocument()
    expect(screen.queryByText('Cf Follow Up Owner')).not.toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('humanizes raw key labels returned by definitions defaults', () => {
    render(
      <CustomFieldValuesList
        values={{ cf_test_test: 'test1' }}
        definitions={[
          {
            key: 'test_test',
            kind: 'text',
            label: 'test_test',
          },
        ]}
      />,
    )

    expect(screen.getByText('Test Test')).toBeInTheDocument()
    expect(screen.queryByText('test_test')).not.toBeInTheDocument()
  })

  it('strips Cf prefixes from provided labels before rendering', () => {
    render(
      <CustomFieldValuesList
        entries={[
          {
            key: 'engagement_sentiment',
            label: 'Cf Engagement Sentiment',
            value: 'positive',
          },
        ]}
      />,
    )

    expect(screen.getByText('Engagement Sentiment')).toBeInTheDocument()
    expect(screen.queryByText('Cf Engagement Sentiment')).not.toBeInTheDocument()
    expect(screen.getByText('positive')).toBeInTheDocument()
  })

  it('preserves explicit custom labels that do not mirror the field key', () => {
    render(
      <CustomFieldValuesList
        entries={[
          {
            key: 'test_test',
            label: 'Test level',
            value: 'test1',
          },
        ]}
      />,
    )

    expect(screen.getByText('Test level')).toBeInTheDocument()
    expect(screen.queryByText('Test Test')).not.toBeInTheDocument()
  })
})

/**
 * Guards issue #4373: honor listVisible:false, format values by definition
 * kind (no blind date-parsing of plain strings, no literal "false"), and
 * render select option labels instead of raw slugs.
 */
describe('CustomFieldValuesList visibility and formatting (#4373)', () => {
  const definitions = [
    { key: 'internal_ref', kind: 'text', label: 'Internal ref', listVisible: false },
    { key: 'campaign', kind: 'text', label: 'Campaign' },
    { key: 'signed_at', kind: 'date', label: 'Signed at' },
    { key: 'vip', kind: 'boolean', label: 'VIP' },
    {
      key: 'segment',
      kind: 'select',
      label: 'Segment',
      options: [
        { value: 'small_biz', label: 'Small business' },
        { value: 'enterprise', label: 'Enterprise' },
      ],
    },
  ]

  const values = {
    internal_ref: 'OP-129',
    campaign: 'Report 2024',
    signed_at: '2026-01-15T10:00:00.000Z',
    vip: false,
    segment: 'small_biz',
  }

  it('hides listVisible:false fields entirely (no leak into extras)', () => {
    render(<CustomFieldValuesList values={values} definitions={definitions} />)
    expect(screen.queryByText('Internal ref')).not.toBeInTheDocument()
    expect(screen.queryByText('OP-129')).not.toBeInTheDocument()
  })

  it('leaves non-date strings untouched even when Date can parse them', () => {
    render(<CustomFieldValuesList values={values} definitions={definitions} />)
    expect(screen.getByText('Report 2024')).toBeInTheDocument()
  })

  it('date-formats values only for date-kind fields', () => {
    render(<CustomFieldValuesList values={values} definitions={definitions} />)
    const expected = new Date('2026-01-15T10:00:00.000Z').toLocaleString()
    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('treats boolean false as empty instead of rendering "false"', () => {
    render(<CustomFieldValuesList values={values} definitions={definitions} />)
    expect(screen.queryByText('false')).not.toBeInTheDocument()
    expect(screen.queryByText('VIP')).not.toBeInTheDocument()
  })

  it('renders select option labels instead of raw slugs', () => {
    render(<CustomFieldValuesList values={values} definitions={definitions} />)
    expect(screen.getByText('Small business')).toBeInTheDocument()
    expect(screen.queryByText('small_biz')).not.toBeInTheDocument()
  })

  it('still renders definition-less extras', () => {
    render(<CustomFieldValuesList values={{ loose_note: 'hello there' }} definitions={definitions} />)
    expect(screen.getByText('hello there')).toBeInTheDocument()
  })
})
