import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { fileFormatArtwork } from '../assets/file-format-artwork'

export type FileFormatTone = 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'gray'

const formatColors: Record<FileFormatTone, string> = {
  red: 'bg-file-format-red text-file-format-red-foreground',
  orange: 'bg-file-format-orange text-file-format-orange-foreground',
  yellow: 'bg-file-format-yellow text-file-format-yellow-foreground',
  green: 'bg-file-format-green text-file-format-green-foreground',
  teal: 'bg-file-format-teal text-file-format-teal-foreground',
  blue: 'bg-file-format-blue text-file-format-blue-foreground',
  purple: 'bg-file-format-purple text-file-format-purple-foreground',
  pink: 'bg-file-format-pink text-file-format-pink-foreground',
  gray: 'bg-file-format-gray text-file-format-gray-foreground',
}

export type FileFormatIconProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> & {
  format: string
  tone?: FileFormatTone
  size?: 'default' | 'sm'
}

export function FileFormatIcon({ format, tone = 'red', size = 'default', className, 'aria-label': ariaLabel, ...props }: FileFormatIconProps) {
  const small = size === 'sm'
  const artwork = fileFormatArtwork[size]
  return (
    <span role="img" aria-label={ariaLabel ?? format} data-slot="file-format-icon" data-size={size} data-tone={tone} className={cn('relative inline-flex shrink-0', small ? 'size-8' : 'size-10', className)} {...props}>
      <img src={artwork.body} alt="" aria-hidden="true" width={small ? 26 : 32} height={small ? 32 : 40} className="absolute top-0 left-1/2 -translate-x-1/2" />
      <img src={artwork.fold} alt="" aria-hidden="true" width={small ? 11 : 13} height={small ? 11 : 13} className={cn('absolute top-0', small ? 'right-0.5' : 'right-0.75')} />
      <span aria-hidden="true" className={cn('absolute left-0 flex items-center justify-center rounded-sm font-semibold', formatColors[tone], small ? 'bottom-1 h-3.5 min-w-6 px-0.5' : 'bottom-1.5 h-4 min-w-7 px-0.75')}>
        <span className={cn('text-overline leading-3 tracking-wide', small && 'scale-80')}>{format}</span>
      </span>
    </span>
  )
}
