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
