/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProductMediaManager } from '../ProductMediaManager'
import type { ProductMediaItem } from '../ProductMediaManager'

const mockApiCall = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))
jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...props }: any) => (
    <button {...props} type={props.type || 'button'}>
      {children}
    </button>
  ),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) return base.replace(/\{\{(\w+)\}\}/g, (_: string, token: string) => String(vars[token] ?? ''))
    return base
  }
  return { useT: () => translate }
})
jest.mock('@open-mercato/shared/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))
jest.mock('@open-mercato/core/modules/attachments/lib/imageUrls', () => ({
  buildAttachmentImageUrl: (id: string) => `https://cdn.local/${id}.jpg`,
  slugifyAttachmentFileName: (name: string) => name,
}))

jest.mock('lucide-react', () => ({
  Upload: (props: Record<string, unknown>) => <svg data-testid="upload-icon" {...props} />,
  Image: (props: Record<string, unknown>) => <svg data-testid="image-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <svg data-testid="trash-icon" {...props} />,
  Star: (props: Record<string, unknown>) => <svg data-testid="star-icon" {...props} />,
}))

function createMediaItem(overrides: Partial<ProductMediaItem> = {}): ProductMediaItem {
  return {
    id: 'media-1',
    url: 'https://cdn.local/media-1.jpg',
    fileName: 'photo.jpg',
    fileSize: 2048,
    thumbnailUrl: 'https://cdn.local/media-1-thumb.jpg',
    ...overrides,
  }
}

const defaultProps = {
  entityId: 'product-entity',
  draftRecordId: 'draft-123',
  items: [] as ProductMediaItem[],
  defaultMediaId: null as string | null,
  onItemsChange: jest.fn(),
  onDefaultChange: jest.fn(),
}

describe('ProductMediaManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the empty state when no items are provided', () => {
    render(<ProductMediaManager {...defaultProps} />)
    expect(screen.getByText('No media uploaded yet.')).toBeInTheDocument()
  })

  it('renders the choose files button', () => {
    render(<ProductMediaManager {...defaultProps} />)
    const chooseButton = screen.getByText('Choose files')
    expect(chooseButton).toBeInTheDocument()
  })

  it('renders media grid when items are provided', () => {
    const items = [
      createMediaItem({ id: 'media-1', fileName: 'photo1.jpg' }),
      createMediaItem({ id: 'media-2', fileName: 'photo2.jpg' }),
    ]
    render(<ProductMediaManager {...defaultProps} items={items} />)
    expect(screen.getByText('photo1.jpg')).toBeInTheDocument()
    expect(screen.getByText('photo2.jpg')).toBeInTheDocument()
    expect(screen.queryByText('No media uploaded yet.')).not.toBeInTheDocument()
  })

  it('displays the default badge on the default media item', () => {
    const items = [
      createMediaItem({ id: 'media-1', fileName: 'default-photo.jpg' }),
      createMediaItem({ id: 'media-2', fileName: 'other-photo.jpg' }),
    ]
    render(<ProductMediaManager {...defaultProps} items={items} defaultMediaId="media-1" />)
    expect(screen.getByText('Default preview')).toBeInTheDocument()
  })

  it('does not display the default badge on non-default items', () => {
    const items = [
      createMediaItem({ id: 'media-1', fileName: 'photo.jpg' }),
    ]
    render(<ProductMediaManager {...defaultProps} items={items} defaultMediaId="other-id" />)
    expect(screen.queryByText('Default preview')).not.toBeInTheDocument()
  })

  it('calls onDefaultChange when the star button is clicked', () => {
    const onDefaultChange = jest.fn()
    const items = [
      createMediaItem({ id: 'media-1', fileName: 'photo.jpg' }),
    ]
    render(
      <ProductMediaManager
        {...defaultProps}
        items={items}
        defaultMediaId={null}
        onDefaultChange={onDefaultChange}
      />,
    )
    const starButtons = screen.getAllByTestId('star-icon')
    fireEvent.click(starButtons[0].closest('button')!)
    expect(onDefaultChange).toHaveBeenCalledWith('media-1')
  })

  it('calls the delete API and onItemsChange when trash button is clicked', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { ok: true } })
    const onItemsChange = jest.fn()
    const items = [
      createMediaItem({ id: 'media-1', fileName: 'photo.jpg' }),
    ]
    render(
      <ProductMediaManager
        {...defaultProps}
        items={items}
        defaultMediaId={null}
        onItemsChange={onItemsChange}
      />,
    )
    const trashButtons = screen.getAllByTestId('trash-icon')
    fireEvent.click(trashButtons[0].closest('button')!)

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        '/api/attachments?id=media-1',
        { method: 'DELETE' },
        { fallback: null },
      )
    })
    await waitFor(() => {
      expect(onItemsChange).toHaveBeenCalledWith([])
    })
  })

  it('calls onDefaultChange when deleting the default media item', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { ok: true } })
    const onDefaultChange = jest.fn()
    const onItemsChange = jest.fn()
    const items = [
      createMediaItem({ id: 'media-1', fileName: 'photo1.jpg' }),
      createMediaItem({ id: 'media-2', fileName: 'photo2.jpg' }),
    ]
    render(
      <ProductMediaManager
        {...defaultProps}
        items={items}
        defaultMediaId="media-1"
        onItemsChange={onItemsChange}
        onDefaultChange={onDefaultChange}
      />,
    )
    const trashButtons = screen.getAllByTestId('trash-icon')
    fireEvent.click(trashButtons[0].closest('button')!)

    await waitFor(() => {
      expect(onDefaultChange).toHaveBeenCalledWith('media-2')
    })
  })

  it('triggers the hidden file input when choose files button is clicked', () => {
    render(<ProductMediaManager {...defaultProps} />)
    const chooseButton = screen.getByText('Choose files')
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = jest.spyOn(fileInput, 'click')
    fireEvent.click(chooseButton)
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('formats file sizes correctly', () => {
    const items = [
      createMediaItem({ id: 'f1', fileName: 'tiny.jpg', fileSize: 512 }),
      createMediaItem({ id: 'f2', fileName: 'medium.jpg', fileSize: 1024 * 500 }),
      createMediaItem({ id: 'f3', fileName: 'large.jpg', fileSize: 1024 * 1024 * 3.7 }),
    ]
    render(<ProductMediaManager {...defaultProps} items={items} />)
    expect(screen.getByText('512 B')).toBeInTheDocument()
    expect(screen.getByText('500.0 KB')).toBeInTheDocument()
    expect(screen.getByText('3.7 MB')).toBeInTheDocument()
  })

  it('renders multiple items with thumbnails as images', () => {
    const items = [
      createMediaItem({ id: 'a', fileName: 'alpha.jpg', thumbnailUrl: 'https://cdn.local/a-thumb.jpg' }),
      createMediaItem({ id: 'b', fileName: 'beta.jpg', thumbnailUrl: 'https://cdn.local/b-thumb.jpg' }),
    ]
    render(<ProductMediaManager {...defaultProps} items={items} />)
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('src', 'https://cdn.local/a-thumb.jpg')
    expect(images[1]).toHaveAttribute('src', 'https://cdn.local/b-thumb.jpg')
  })
})
