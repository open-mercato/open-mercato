'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { copyTextToClipboard } from '@open-mercato/core/modules/design_system/gallery/components/CodeSnippet'
import { Check, ChevronDown, Copy, ExternalLink, Sparkles } from 'lucide-react'
import { previewHref } from '@/lib/links'
import { useDesignSettings } from './DesignSettings'
import { PreviewFrame } from './PreviewFrame'
import { HighlightedCode } from './HighlightedCode'

type VariantExampleProps = {
  entryId: string
  variant: { id: string; title: string; code: string; description?: string }
}

const TOOL_BUTTON_CLASS =
  'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:shadow-focus'

const BUILDER_URL = process.env.NEXT_PUBLIC_OM_BUILDER_URL ?? ''

function builderHref(entryId: string, variantId: string): string {
  const separator = BUILDER_URL.includes('?') ? '&' : '?'
  return `${BUILDER_URL}${separator}entry=${encodeURIComponent(entryId)}&variant=${encodeURIComponent(variantId)}`
}

function EditInBuilder({ entryId, variant }: VariantExampleProps) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  const label = t('design.entry.editInBuilder', 'Edit in OM Builder')

  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (BUILDER_URL) {
    return (
      <a href={builderHref(entryId, variant.id)} target="_blank" rel="noreferrer" className={TOOL_BUTTON_CLASS}>
        <Sparkles className="size-4 text-muted-foreground" aria-hidden />
        {label}
      </a>
    )
  }

  const copyBrief = async () => {
    const source = `${window.location.origin}${window.location.pathname}#variant-${variant.id}`
    const brief = [
      t('design.entry.builderBrief.intro', 'Edit this Open Mercato example in the builder.'),
      t('design.entry.builderBrief.example', 'Example: {title} ({entryId})', { title: variant.title, entryId }),
      t('design.entry.builderBrief.source', 'Source: {source}', { source }),
      '',
      variant.code,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(brief)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copyBrief()}
      className={TOOL_BUTTON_CLASS}
      title={t('design.entry.builderBrief.hint', 'Copies this example as a brief for the builder')}
    >
      {copied ? <Check className="size-4 text-status-success-icon" aria-hidden /> : <Sparkles className="size-4 text-muted-foreground" aria-hidden />}
      <span aria-live="polite">{copied ? t('design.entry.builderBrief.copied', 'Brief copied') : label}</span>
    </button>
  )
}

function ExampleCode({ code, expanded, id }: { code: string; expanded: boolean; id: string }) {
  return (
    <div className="relative bg-muted/50">
      <pre id={id} className={`overflow-auto p-4 text-xs leading-relaxed text-foreground ${expanded ? 'max-h-96' : 'max-h-28 overflow-hidden'}`}>
        <HighlightedCode code={code} />
      </pre>
      {expanded ? null : <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted to-transparent" />}
    </div>
  )
}

export function VariantExample({ entryId, variant }: VariantExampleProps) {
  const t = useT()
  const { mode } = useDesignSettings()
  const [expanded, setExpanded] = React.useState(false)
  const headingId = `example-${variant.id}`
  const codeId = `example-code-${variant.id}`
  const lineCount = variant.code.split('\n').length
  const collapsible = lineCount > 6
  const onCopy = React.useCallback(async () => {
    try {
      await copyTextToClipboard(variant.code)
      flash(t('design.entry.copied'), 'success')
    } catch {
      flash(t('design.entry.copyFailed'), 'error')
    }
  }, [variant.code, t])
  return (
    <section aria-labelledby={headingId} className="min-w-0 scroll-mt-20 space-y-3" id={`variant-${variant.id}`}>
      <div className="space-y-1">
        <h3 id={headingId} className="text-lg font-normal text-foreground">{variant.title}</h3>
        {variant.description ? <p className="max-w-3xl text-sm text-muted-foreground">{variant.description}</p> : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <PreviewFrame entryId={entryId} variantId={variant.id} title={variant.title} attached />
        <div className="flex min-h-10 flex-wrap items-center justify-end gap-1 border-y border-border bg-card px-2 py-1" data-example-toolbar="">
          <button type="button" onClick={() => void onCopy()} className={TOOL_BUTTON_CLASS}>
            <Copy className="size-4 text-muted-foreground" aria-hidden />
            {t('design.entry.copyCode', 'Copy code')}
          </button>
          <EditInBuilder entryId={entryId} variant={variant} />
          <a
            href={previewHref(entryId, variant.id, mode)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:shadow-focus"
            aria-label={t('design.entry.openStandalone', { title: variant.title })}
            title={t('design.entry.openStandalone', { title: variant.title })}
          >
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </div>
        <ExampleCode code={variant.code} expanded={expanded || !collapsible} id={codeId} />
        {collapsible ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={codeId}
            onClick={() => setExpanded((value) => !value)}
            className="flex h-8 w-full items-center justify-center gap-1 border-t border-border bg-muted/50 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:shadow-focus"
          >
            {expanded ? t('design.entry.showLessCode', 'Show less') : t('design.entry.showMoreCode', 'Show more')}
            <ChevronDown aria-hidden className={`size-4 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        ) : null}
      </div>
    </section>
  )
}
