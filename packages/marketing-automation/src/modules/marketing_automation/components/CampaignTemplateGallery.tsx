"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type CampaignTemplateOption = {
  id: string
  labelKey: string
  descriptionKey: string
  requiresKey: string
  stepCount: number
  triggerCount: number
  document: unknown
}

export type CampaignTemplateGalleryProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (template: CampaignTemplateOption) => void
  /** Disables the pick buttons while the host is busy creating or applying. */
  busy?: boolean
}

/**
 * The ready-made campaigns, shown as something an operator can read before committing to it.
 *
 * These templates already existed; they were offered through a `Select` that rendered the label and nothing
 * else, and acted on the first click. The API has always returned a description, a requirement line and the
 * step and trigger counts — the three things somebody needs in order to choose — and all three were discarded
 * by the control. Picking is also two deliberate acts here rather than one, because "start from a template"
 * creates or rewrites a campaign.
 *
 * The requirement line matters most: a birthday campaign on an installation with no birth-date field imports
 * cleanly and then never sends, which is the hardest kind of nothing to debug.
 */
export function CampaignTemplateGallery({ open, onOpenChange, onPick, busy = false }: CampaignTemplateGalleryProps) {
  const t = useT()
  const [templates, setTemplates] = React.useState<CampaignTemplateOption[] | null>(null)
  const [loadFailed, setLoadFailed] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoadFailed(false)
    try {
      const result = await apiCall<{ items?: CampaignTemplateOption[] }>('/api/marketing_automation/templates')
      if (result.ok && Array.isArray(result.result?.items)) setTemplates(result.result.items)
      else setLoadFailed(true)
    } catch {
      setLoadFailed(true)
    }
  }, [])

  React.useEffect(() => {
    if (open && templates === null) void load()
  }, [open, templates, load])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('marketing_automation.templates.galleryTitle', 'Start from a ready campaign')}</DialogTitle>
          <DialogDescription>
            {t(
              'marketing_automation.templates.galleryDescription',
              'Each one arrives disabled, with copy you are expected to rewrite. Nothing sends until you enable it.',
            )}
          </DialogDescription>
        </DialogHeader>

        {loadFailed ? (
          <ErrorMessage
            label={t('marketing_automation.templates.loadFailed', 'Could not load the ready campaigns.')}
            action={(
              <Button variant="outline" size="sm" onClick={() => { void load() }}>
                {t('marketing_automation.runs.retry', 'Try again')}
              </Button>
            )}
          />
        ) : templates === null ? (
          <LoadingMessage label={t('marketing_automation.templates.loading', 'Loading ready campaigns…')} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <div key={template.id} className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
                <div className="text-sm font-medium text-foreground">{t(template.labelKey, template.id)}</div>
                <div className="flex-1 text-xs leading-relaxed text-muted-foreground">
                  {t(template.descriptionKey, '')}
                </div>
                {/* What has to be in place for this to do anything. An operator who reads it before importing
                    is spared a campaign that looks installed and never sends. */}
                <div className="text-xs text-muted-foreground">{t(template.requiresKey, '')}</div>
                {/* Counts and action stack rather than share a row: side by side, a translated badge pair is
                    wide enough to push the button past the card edge, which is how it first shipped. */}
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="muted" className="text-xs tabular-nums">
                    {t('marketing_automation.templates.stepCount', '{count} steps').replace('{count}', String(template.stepCount))}
                  </Badge>
                  <Badge variant="muted" className="text-xs tabular-nums">
                    {t('marketing_automation.templates.triggerCount', '{count} triggers').replace('{count}', String(template.triggerCount))}
                  </Badge>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={busy}
                  onClick={() => onPick(template)}
                >
                  {t('marketing_automation.templates.use', 'Use this one')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
