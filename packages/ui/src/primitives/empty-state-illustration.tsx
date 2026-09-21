import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { emptyStateIllustrations as sourceEmptyStateIllustrations } from '../assets/empty-state-illustrations'
import { mercatoEmptyStateIllustrations } from '../assets/mercato-empty-state-illustrations.generated'

export const emptyStateIllustrations = [...mercatoEmptyStateIllustrations, ...sourceEmptyStateIllustrations] as const
export type EmptyStateIllustrationKind = typeof emptyStateIllustrations[number]['key']

export type EmptyStateIllustrationProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  kind: EmptyStateIllustrationKind
}

/** Original decorative artwork; pair with EmptyState's translated title and description. */
export function EmptyStateIllustration({ kind, alt = '', className, ...props }: EmptyStateIllustrationProps) {
  const artwork = emptyStateIllustrations.find(item => item.key === kind)
  return <img src={artwork?.src} alt={alt} width={148} height={148} loading="lazy" decoding="async" data-slot="empty-state-illustration" data-kind={kind} className={cn('size-37 shrink-0 object-contain', artwork?.group === 'mercato' && 'dark:invert', className)} {...props} />
}
