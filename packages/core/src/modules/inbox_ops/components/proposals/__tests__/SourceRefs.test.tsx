/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { SourceRefs } from '../SourceRefs'

describe('SourceRefs', () => {
  it('renders nothing without references', () => {
    const { container } = renderWithProviders(<SourceRefs refs={null} />)
    expect(container.textContent).toBe('')
  })

  it('names the cited file with its page, sheet and row, and the email body', () => {
    renderWithProviders(
      <SourceRefs
        refs={[
          { kind: 'attachment', attachmentId: 'att-1', fileName: 'offer.pdf', page: 2, snippet: '10 x Widget at 4.50' },
          { kind: 'attachment', attachmentId: 'att-2', fileName: 'prices.xlsx', sheet: 'Q4', row: 7, snippet: 'Widget 4.50' },
          { kind: 'attachment', attachmentId: 'att-3', snippet: 'unnamed' },
          { kind: 'email_body', snippet: 'Please ship by Friday' },
        ]}
      />,
    )
    expect(screen.getByText('offer.pdf (page 2)')).toBeTruthy()
    expect(screen.getByText('prices.xlsx (sheet Q4, row 7)')).toBeTruthy()
    expect(screen.getByText('Attachment')).toBeTruthy()
    expect(screen.getByText('Email body')).toBeTruthy()
  })

  it('shows the quoted snippet in a tooltip on focus', async () => {
    renderWithProviders(<SourceRefs refs={[{ kind: 'attachment', attachmentId: 'att-1', fileName: 'offer.pdf', page: 2, snippet: '10 x Widget at 4.50' }]} />)
    fireEvent.focus(screen.getByText('offer.pdf (page 2)').parentElement as HTMLElement)
    expect((await screen.findAllByText('Quoted: "10 x Widget at 4.50"')).length).toBeGreaterThan(0)
  })
})
