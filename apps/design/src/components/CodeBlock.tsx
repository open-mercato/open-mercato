'use client'

import * as React from 'react'
import { Copy } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { copyTextToClipboard } from '@open-mercato/core/modules/design_system/gallery/components/CodeSnippet'

export function CodeBlock({ code }: { code: string }) {
  const t = useT()
  const copyLabel = t('design.entry.copy')
  const onCopy = React.useCallback(async () => {
    try {
      await copyTextToClipboard(code)
      flash(t('design.entry.copied'), 'success')
    } catch {
      flash(t('design.entry.copyFailed'), 'error')
    }
  }, [code, t])
  return (
    <div className="relative min-w-0">
      <pre className="max-h-96 overflow-auto rounded-xl border border-border bg-muted/50 p-4 pr-12 text-xs leading-relaxed text-foreground">
        <code className="font-mono">{code}</code>
      </pre>
      <IconButton type="button" variant="ghost" size="sm" className="absolute right-2 top-2" aria-label={copyLabel} title={copyLabel} onClick={onCopy}>
        <Copy />
      </IconButton>
    </div>
  )
}
