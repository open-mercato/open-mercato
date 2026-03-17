"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type BrandingPreviewProps = {
  logoUrl?: string | null
  brandName?: string | null
  securitySubtitle?: string | null
  accentColor?: string | null
}

export function BrandingPreview({ logoUrl, brandName, securitySubtitle, accentColor }: BrandingPreviewProps) {
  const t = useT()

  const displayName = brandName?.trim() || t('payment_link_pages.templates.branding.preview.fallbackBrand', 'Open Mercato')
  const displaySubtitle = securitySubtitle?.trim() || t('payment_link_pages.templates.branding.preview.fallbackSubtitle', 'Protected checkout')
  const hasLogo = typeof logoUrl === 'string' && logoUrl.trim().length > 0
  const accentBorderColor = accentColor?.trim() || undefined

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-widest text-slate-400">
        {t('payment_link_pages.templates.branding.preview', 'Preview')}
      </div>
      <div
        className="relative overflow-hidden rounded-lg border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.08),_transparent_60%),linear-gradient(180deg,_#f5f7f1_0%,_#eef4ff_48%,_#f8fafc_100%)] p-5"
      >
        {accentBorderColor ? (
          <div
            className="absolute inset-x-0 top-0 h-1 rounded-t-lg"
            style={{ backgroundColor: accentBorderColor }}
          />
        ) : null}
        <div className="flex items-center gap-3">
          {hasLogo ? (
            <img
              src={logoUrl as string}
              alt={displayName}
              className="h-10 w-10 rounded-xl border border-slate-200 bg-white object-contain p-1.5 shadow-sm"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
              <svg className="h-5 w-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
          )}
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              {displayName}
            </div>
            <div className="text-sm text-slate-600">
              {displaySubtitle}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BrandingPreview
