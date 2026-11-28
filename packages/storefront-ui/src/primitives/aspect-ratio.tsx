import * as React from 'react'
import { cn } from '../lib/cn'

export type AspectRatioProps = React.ComponentPropsWithoutRef<'div'> & {
  /** Width / height. Defaults to the product image token (`--sf-image-ratio-product`). */
  ratio?: number | 'product' | 'square' | 'portrait' | 'landscape' | 'wide'
  /** Object fit for a direct <img> or <video> child. Defaults to the `--sf-image-fit` token. */
  fit?: 'cover' | 'contain'
}

const presets: Record<Exclude<NonNullable<AspectRatioProps['ratio']>, number>, string> = {
  product: 'var(--sf-image-ratio-product)',
  square: '1 / 1',
  portrait: '4 / 5',
  landscape: '4 / 3',
  wide: '16 / 9',
}

/**
 * CSS aspect-ratio box. Implemented without Radix because `@radix-ui/react-aspect-ratio`
 * is not among the packages `@open-mercato/ui` already depends on (storefront-app spec §3.1).
 */
export const AspectRatio = React.forwardRef<HTMLDivElement, AspectRatioProps>(function AspectRatio(
  { ratio = 'product', fit, className, style, ...props },
  ref,
) {
  const aspectRatio = typeof ratio === 'number' ? String(ratio) : presets[ratio]
  return (
    <div
      ref={ref}
      data-slot="aspect-ratio"
      data-fit={fit}
      className={cn(
        'relative w-full overflow-hidden bg-sf-surface',
        '[&>img]:size-full [&>video]:size-full',
        fit === 'contain' ? '[&>img]:object-contain [&>video]:object-contain' : '[&>img]:object-cover [&>video]:object-cover',
        className,
      )}
      style={{ aspectRatio, ...style }}
      {...props}
    />
  )
})
