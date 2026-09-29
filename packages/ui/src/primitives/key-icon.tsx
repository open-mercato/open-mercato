import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { keyComponentGlyphs } from '../assets/key-component-glyphs'

export type KeyIconColor = 'gray' | 'blue' | 'orange' | 'red' | 'green' | 'yellow' | 'purple' | 'pink' | 'teal' | 'sky'
export type KeyIconSize = 32 | 40 | 48 | 56 | 64

const colors: Record<KeyIconColor, { icon: string; background: string }> = {
  gray: { icon: 'text-muted-foreground', background: 'bg-status-neutral-bg' },
  blue: { icon: 'text-status-info-icon', background: 'bg-status-info-bg' },
  orange: { icon: 'text-status-warning-icon', background: 'bg-status-warning-bg' },
  red: { icon: 'text-status-error-icon', background: 'bg-status-error-bg' },
  green: { icon: 'text-status-success-icon', background: 'bg-status-success-bg' },
  yellow: { icon: 'text-badge-yellow-text', background: 'bg-badge-yellow-bg' },
  purple: { icon: 'text-badge-purple-solid', background: 'bg-badge-purple-bg' },
  pink: { icon: 'text-status-pink-text', background: 'bg-key-icon-pink-bg' },
  teal: { icon: 'text-badge-sky-text', background: 'bg-badge-sky-bg' },
  sky: { icon: 'text-badge-sky-text', background: 'bg-badge-sky-bg' },
}

const sizes: Record<KeyIconSize, { container: string; glyph: string }> = {
  32: { container: 'size-8', glyph: 'size-5' },
  40: { container: 'size-10', glyph: 'size-5' },
  48: { container: 'size-12', glyph: 'size-6' },
  56: { container: 'size-14', glyph: 'size-7' },
  64: { container: 'size-16', glyph: 'size-8' },
}

export type KeyIconProps = React.HTMLAttributes<HTMLSpanElement> & {
  color?: KeyIconColor
  size?: KeyIconSize
  appearance?: 'stroke' | 'lighter'
}

export function KeyIcon({ color = 'gray', size = 40, appearance = 'stroke', children, className, ...props }: KeyIconProps) {
  const named = Boolean(props['aria-label'] || props['aria-labelledby'])
  return <span data-slot="key-icon" data-color={color} data-size={size} data-appearance={appearance}
    aria-hidden={named ? undefined : true} role={named ? 'img' : undefined}
    className={cn('inline-flex shrink-0 items-center justify-center rounded-full', sizes[size].container, colors[color].icon,
      appearance === 'stroke' ? 'bg-background shadow-xs ring-1 ring-inset ring-border' : colors[color].background, className)} {...props}>
    <span data-slot="key-icon-glyph" aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center [&>svg]:size-full [&>img]:size-full [&>span]:size-full', sizes[size].glyph)}>{children}</span>
  </span>
}

export function KeyIconGlyph({ name = 'user', className }: { name?: keyof typeof keyComponentGlyphs; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-full bg-current mask-contain mask-center mask-no-repeat', className)} style={{ maskImage: `url("${keyComponentGlyphs[name]}")` }} />
}
