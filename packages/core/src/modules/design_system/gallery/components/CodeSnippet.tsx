'use client'

import * as React from 'react'
import { Copy } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Non-secure contexts (plain-HTTP self-hosted installs) have no
  // navigator.clipboard — fall back to the legacy selection API.
  const holder = document.createElement('textarea')
  holder.value = text
  holder.setAttribute('readonly', '')
  holder.style.position = 'fixed'
  holder.style.opacity = '0'
  document.body.appendChild(holder)
  holder.select()
  const copied = document.execCommand('copy')
  holder.remove()
  if (!copied) throw new Error('[internal] execCommand copy failed')
}

export function CodeSnippet({ code, preview }: { code: string; preview?: React.ReactNode }) {
  const t = useT()
  const copyLabel = t('design_system.gallery.copy', 'Copy code')

  const onCopy = React.useCallback(async () => {
    try {
      await copyTextToClipboard(code)
      flash(t('design_system.gallery.copied', 'Snippet copied to clipboard'), 'success')
    } catch {
      flash(t('design_system.gallery.copyFailed', 'Could not copy the snippet'), 'error')
    }
  }, [code, t])

  return <Tabs defaultValue={preview ? 'preview' : 'code'} variant="underline" className="min-w-0 space-y-4">
    <div className="flex items-center justify-between gap-3 border-b border-border">
      <TabsList>
        {preview ? <TabsTrigger value="preview">{t('design_system.gallery.previewTab', 'Preview')}</TabsTrigger> : null}
        <TabsTrigger value="code">{t('design_system.gallery.codeTab', 'Code')}</TabsTrigger>
      </TabsList>
      <IconButton type="button" variant="ghost" size="sm" aria-label={copyLabel} title={copyLabel} onClick={onCopy}><Copy /></IconButton>
    </div>
    {preview ? <TabsContent value="preview">{preview}</TabsContent> : null}
    <TabsContent value="code">
      <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/50 p-4 text-xs leading-relaxed"><code>{code}</code></pre>
    </TabsContent>
  </Tabs>
}
