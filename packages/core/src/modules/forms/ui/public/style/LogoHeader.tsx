import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { OmThemeLogo } from '../../../schema/style-extensions'

/**
 * Renders a themed form's logo/header image. The source is ALWAYS the public
 * attachments image route addressed by the stored `assetId` — never an
 * author-supplied URL (D4 / no SSRF). Absent logo ⇒ renders nothing, so an
 * unstyled form is byte-identical. Shared by `FormRunner` (runtime) and
 * `PreviewSurface` (studio) for parity (R-CS-7).
 */

const SIZE_TO_CLASS: Record<NonNullable<OmThemeLogo['size']>, string> = {
  sm: 'max-h-8',
  md: 'max-h-12',
  lg: 'max-h-16',
}

const ALIGN_TO_CLASS: Record<NonNullable<OmThemeLogo['align']>, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
}

export function buildLogoSrc(assetId: string): string {
  return `/api/attachments/image/${encodeURIComponent(assetId)}?width=480&cropType=contain`
}

export function LogoHeader({ logo }: { logo: OmThemeLogo | undefined }) {
  if (!logo || typeof logo.assetId !== 'string' || logo.assetId.length === 0) return null
  const sizeClass = SIZE_TO_CLASS[logo.size ?? 'md']
  const alignClass = ALIGN_TO_CLASS[logo.align ?? 'start']
  return (
    <div className={cn('flex w-full', alignClass)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={buildLogoSrc(logo.assetId)}
        alt={logo.alt ?? ''}
        className={cn('w-auto object-contain', sizeClass)}
      />
    </div>
  )
}
