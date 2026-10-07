import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { sourceIconNames, sourceLucideIcons, originalSourceIconArtwork, type SourceIconName } from './source-icons.generated'

export { sourceIconNames, type SourceIconName }

const original = Object.fromEntries(originalSourceIconArtwork.map(item => [item.name, `data:image/svg+xml;base64,${item.data}`]))

export type SourceIconProps = React.HTMLAttributes<HTMLSpanElement> & { name: SourceIconName }

/** Figma's full icon inventory. Prefer direct lucide-react imports for individual app icons. */
export function SourceIcon({ name, className, style, ...props }: SourceIconProps) {
  const Icon = sourceLucideIcons[name as keyof typeof sourceLucideIcons]
  const src = original[name]
  return <span className={cn('inline-flex size-6 shrink-0 items-center justify-center', className)} style={style} data-slot="source-icon" data-icon={name} {...props}>
    {Icon ? <Icon aria-hidden="true" className="size-full" /> : <span aria-hidden="true" className="size-full bg-current" style={{ maskImage: `url("${src}")`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskImage: `url("${src}")`, WebkitMaskSize: 'contain', WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center' }} />}
  </span>
}
