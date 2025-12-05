/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { AttachmentContentPreview } from '../AttachmentContentPreview'

describe('AttachmentContentPreview', () => {
  it('shows placeholder when content is missing', () => {
    render(<AttachmentContentPreview content={null} />)
    expect(screen.getByText(/no text extracted/i)).toBeInTheDocument()
  })

  it('renders inline content when short', () => {
    render(<AttachmentContentPreview content="hello world" />)
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('truncates long content and can expand', () => {
    const longText = 'lorem ipsum '.repeat(80)
    render(<AttachmentContentPreview content={longText} />)
    const preview = screen.getByTestId('attachment-content-preview')
    expect(preview.textContent).toContain('lorem ipsum')
    expect(preview.textContent?.length).toBeLessThan(longText.length)
    const toggle = screen.getByRole('button', { name: /show more/i })
    fireEvent.click(toggle)
    expect(preview.textContent).toContain(longText.trim())
  })
})
