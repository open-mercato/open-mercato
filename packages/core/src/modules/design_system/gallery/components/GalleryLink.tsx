'use client'

import * as React from 'react'
import Link from 'next/link'
import { GALLERY_BASE_PATH } from '../registry'

export function navigateGallery(href: string): boolean {
  const target = new URL(href, window.location.href)
  if (target.origin !== window.location.origin || target.pathname !== GALLERY_BASE_PATH || window.location.pathname !== GALLERY_BASE_PATH) return false
  if (target.href !== window.location.href) window.history.pushState(null, '', target.href)
  return true
}

export function GalleryLink({ onNavigate, ...props }: React.ComponentProps<typeof Link>) {
  return <Link {...props} prefetch={false} onNavigate={event => {
    if (typeof props.href === 'string' && navigateGallery(props.href)) event.preventDefault()
    onNavigate?.(event)
  }} />
}
