'use client'

import * as React from 'react'
import { Copy } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

export function CodeSnippet({ code }: { code: string }) {
  const t = useT()
  const copyLabel = t('design_system.gallery.copy', 'Copy code')

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      flash(t('design_system.gallery.copied', 'Snippet copied to clipboard'), 'success')
    } catch {
      flash(t('design_system.gallery.copyFailed', 'Could not copy the snippet'), 'error')
    }
  }, [code, t])

  return (
    <div className="relative rounded-md border border-border bg-muted/50">
      <pre className="overflow-x-auto p-3 pr-12 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-1.5 top-1.5"
        aria-label={copyLabel}
        title={copyLabel}
        onClick={onCopy}
      >
        <Copy />
      </IconButton>
    </div>
  )
}
