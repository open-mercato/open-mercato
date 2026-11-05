/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { ProductImageCell } from '../ProductImageCell'
import { buildAttachmentImageUrl } from '@open-mercato/core/modules/attachments/lib/imageUrls'

jest.mock('@open-mercato/core/modules/attachments/lib/imageUrls', () => ({
  buildAttachmentImageUrl: jest.fn(),
}))

describe('ProductImageCell', () => {
  beforeEach(() => {
    ;(buildAttachmentImageUrl as jest.Mock).mockReset()
  })

  it('renders placeholder when no media is provided', () => {
    render(<ProductImageCell mediaId={null} mediaUrl={null} title="Sample" />)
    expect(buildAttachmentImageUrl).not.toHaveBeenCalled()
    expect(screen.queryByRole('img', { name: /sample/i })).not.toBeInTheDocument()
  })

  it('prefers the stored url when provided', () => {
    render(<ProductImageCell mediaId="att-1" mediaUrl="https://cdn.example.com/image.png" title="Main photo" />)
    const img = screen.getByRole('img', { name: /main photo/i })
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/image.png')
    expect(buildAttachmentImageUrl).not.toHaveBeenCalled()
  })

  it('builds the preview url when only media id exists', () => {
    ;(buildAttachmentImageUrl as jest.Mock).mockReturnValue('https://cdn.example.com/generated.png')
    render(<ProductImageCell mediaId="att-2" mediaUrl={null} title="Gallery" />)
    const img = screen.getByRole('img', { name: /gallery/i })
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/generated.png')
    expect(buildAttachmentImageUrl).toHaveBeenCalledWith('att-2', expect.objectContaining({
      width: expect.any(Number),
      height: expect.any(Number),
      cropType: 'cover',
    }))
  })

  it('supports contain crop mode', () => {
    ;(buildAttachmentImageUrl as jest.Mock).mockReturnValue('https://cdn.example.com/generated.png')
    render(<ProductImageCell mediaId="att-3" mediaUrl={null} title="Dress" cropType="contain" />)
    const img = screen.getByRole('img', { name: /dress/i })
    expect(img).toHaveClass('object-contain')
    expect(buildAttachmentImageUrl).toHaveBeenCalledWith('att-3', expect.objectContaining({
      cropType: 'contain',
    }))
  })
})
