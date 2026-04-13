/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { VariantMediaReadonlyGallery, type VariantMediaGroup } from '../VariantMediaReadonlyGallery'
import type { ProductMediaItem } from '../ProductMediaManager'

jest.mock('next/link', () => {
  return ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => fallback ?? key
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
  Image: (props: Record<string, unknown>) => <svg data-testid="image-icon" {...props} />,
  ExternalLink: (props: Record<string, unknown>) => <svg data-testid="external-link-icon" {...props} />,
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

function createGroup(overrides: Partial<VariantMediaGroup> = {}): VariantMediaGroup {
  return {
    variantId: 'variant-1',
    variantName: 'Blue / Small',
    defaultMediaId: 'media-1',
    items: [createMediaItem()],
    editUrl: '/backend/catalog/products/prod-1/variants/variant-1',
    ...overrides,
  }
}

describe('VariantMediaReadonlyGallery', () => {
  it('returns null when all groups are empty', () => {
    const { container } = render(
      <VariantMediaReadonlyGallery groups={[createGroup({ items: [] })]} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null when groups array is empty', () => {
    const { container } = render(<VariantMediaReadonlyGallery groups={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the section title', () => {
    render(<VariantMediaReadonlyGallery groups={[createGroup()]} />)
    expect(screen.getByText('Variant media')).toBeInTheDocument()
  })

  it('renders variant name and edit link', () => {
    render(<VariantMediaReadonlyGallery groups={[createGroup()]} />)
    expect(screen.getByText('Blue / Small')).toBeInTheDocument()
    const editLink = screen.getByText('Edit variant')
    expect(editLink.closest('a')).toHaveAttribute(
      'href',
      '/backend/catalog/products/prod-1/variants/variant-1',
    )
  })

  it('renders thumbnail images for each media item', () => {
    const items = [
      createMediaItem({ id: 'media-1', fileName: 'front.jpg', thumbnailUrl: 'https://cdn.local/front-thumb.jpg' }),
      createMediaItem({ id: 'media-2', fileName: 'back.jpg', thumbnailUrl: 'https://cdn.local/back-thumb.jpg' }),
    ]
    render(
      <VariantMediaReadonlyGallery
        groups={[createGroup({ items, defaultMediaId: 'media-1' })]}
      />,
    )
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('alt', 'front.jpg')
    expect(images[1]).toHaveAttribute('alt', 'back.jpg')
  })

  it('shows a star badge on the default media item', () => {
    const items = [
      createMediaItem({ id: 'media-1', fileName: 'front.jpg' }),
      createMediaItem({ id: 'media-2', fileName: 'back.jpg' }),
    ]
    render(
      <VariantMediaReadonlyGallery
        groups={[createGroup({ items, defaultMediaId: 'media-1' })]}
      />,
    )
    const stars = screen.getAllByTestId('star-icon')
    expect(stars).toHaveLength(1)
  })

  it('renders multiple variant groups', () => {
    const groups = [
      createGroup({
        variantId: 'v1',
        variantName: 'Blue / Small',
        items: [createMediaItem({ id: 'm1', fileName: 'blue.jpg' })],
        editUrl: '/backend/catalog/products/p/variants/v1',
      }),
      createGroup({
        variantId: 'v2',
        variantName: 'Red / Large',
        items: [createMediaItem({ id: 'm2', fileName: 'red.jpg' })],
        editUrl: '/backend/catalog/products/p/variants/v2',
      }),
    ]
    render(<VariantMediaReadonlyGallery groups={groups} />)
    expect(screen.getByText('Blue / Small')).toBeInTheDocument()
    expect(screen.getByText('Red / Large')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(2)
  })

  it('skips groups with no media items', () => {
    const groups = [
      createGroup({ variantId: 'v1', variantName: 'Blue', items: [] }),
      createGroup({
        variantId: 'v2',
        variantName: 'Red',
        items: [createMediaItem({ id: 'm1' })],
      }),
    ]
    render(<VariantMediaReadonlyGallery groups={groups} />)
    expect(screen.queryByText('Blue')).not.toBeInTheDocument()
    expect(screen.getByText('Red')).toBeInTheDocument()
  })

  it('displays file names in each card', () => {
    render(
      <VariantMediaReadonlyGallery
        groups={[createGroup({ items: [createMediaItem({ fileName: 'sneaker-side.png' })] })]}
      />,
    )
    expect(screen.getByText('sneaker-side.png')).toBeInTheDocument()
  })
})
