'use client'

import { useEffect } from 'react'
import { useDirection } from '@open-mercato/shared/lib/i18n/context'

/**
 * Keeps `<html dir>` in sync with the active locale on the client.
 *
 * The server already renders the attribute, so the first paint is correct. This
 * covers what happens *after* a locale change: whether the switcher ends in a
 * `router.refresh()` or a full navigation, the document direction must follow
 * the newly rendered content. Reading it from the provider — rather than
 * re-deriving it here — means the attribute and every mirroring component
 * always agree.
 */
export function DocumentDirection() {
  const direction = useDirection()

  useEffect(() => {
    document.documentElement.dir = direction
  }, [direction])

  return null
}
