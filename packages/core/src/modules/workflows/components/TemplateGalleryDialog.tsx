'use client'

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlarmClock, CircleCheck, Route, SquareDashed, Webhook, Workflow } from 'lucide-react'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { WorkflowDefinitionData } from '../data/entities'

export type WorkflowTemplateGalleryItem = {
  id: string
  nameKey: string
  descriptionKey: string
  category: string
  icon: string
  definition: WorkflowDefinitionData
}

type TemplatesResponse = {
  items?: WorkflowTemplateGalleryItem[]
  error?: string
}

export type TemplateGalleryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (template: WorkflowTemplateGalleryItem | null) => void
}

const BLANK_CARD_ID = 'blank'

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'check-circle': CircleCheck,
  'webhook': Webhook,
  'alarm-clock': AlarmClock,
  'route': Route,
}

function resolveTemplateIcon(icon: string): LucideIcon {
  return TEMPLATE_ICONS[icon] ?? Workflow
}

/**
 * TemplateGalleryDialog — the "New workflow" template picker (spec
 * 2026-07-26-workflows-ux-redesign.md section 2.1 "Templates").
 *
 * Lists the seeded templates from GET /api/workflows/templates as cards with
 * a "Blank canvas" card first. Selecting a card calls `onSelect` with the
 * chosen template (or `null` for blank canvas) and closes the dialog — the
 * host decides whether to navigate (definitions list) or apply the template
 * to the open canvas (visual editor).
 *
 * A Drawer rather than a modal: the gallery opens over the definitions list
 * and over the canvas, and a card grid is exactly the content the maintainer
 * wants room for. Keyboard unchanged: Escape cancels (Radix default),
 * Cmd/Ctrl+Enter selects the active card (blank canvas until a card is focused
 * or hovered).
 */
export function TemplateGalleryDialog({ open, onOpenChange, onSelect }: TemplateGalleryDialogProps) {
  const t = useT()
  const [templates, setTemplates] = React.useState<WorkflowTemplateGalleryItem[] | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [activeCardId, setActiveCardId] = React.useState<string>(BLANK_CARD_ID)

  const loadTemplates = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    const result = await apiCall<TemplatesResponse>('/api/workflows/templates')
    if (result.ok && Array.isArray(result.result?.items)) {
      setTemplates(result.result.items)
    } else {
      setLoadError(result.result?.error || t('workflows.templates.gallery.loadFailed', 'Failed to load workflow templates'))
    }
    setIsLoading(false)
  }, [t])

  React.useEffect(() => {
    if (open && templates === null && !isLoading && !loadError) {
      void loadTemplates()
    }
  }, [open, templates, isLoading, loadError, loadTemplates])

  React.useEffect(() => {
    if (!open) setActiveCardId(BLANK_CARD_ID)
  }, [open])

  const handleSelect = React.useCallback((cardId: string) => {
    if (cardId === BLANK_CARD_ID) {
      onOpenChange(false)
      onSelect(null)
      return
    }
    const template = (templates ?? []).find((item) => item.id === cardId)
    if (!template) return
    onOpenChange(false)
    onSelect(template)
  }, [templates, onOpenChange, onSelect])

  React.useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSelect(activeCardId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, activeCardId, handleSelect])

  const cardClassName = (cardId: string) => (
    `group relative flex w-full cursor-pointer flex-col gap-2 rounded-lg border-2 bg-background px-4 py-3 text-left transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
      activeCardId === cardId ? 'border-primary' : 'border-border hover:border-muted-foreground/30'
    }`
  )

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        data-testid="workflow-template-gallery-drawer"
        className="w-full max-w-none sm:w-3/5"
        closeAriaLabel={t('workflows.templates.gallery.close', 'Close template gallery')}
      >
        <DrawerHeader>
          <DrawerTitle>{t('workflows.templates.gallery.title', 'Choose a template')}</DrawerTitle>
          <DrawerDescription>
            {t('workflows.templates.gallery.description', 'Start from a ready-made workflow or a blank canvas.')}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="py-4">
        {isLoading ? (
          <LoadingMessage label={t('workflows.templates.gallery.loading', 'Loading templates...')} />
        ) : loadError ? (
          <ErrorMessage
            label={t('workflows.templates.gallery.loadFailed', 'Failed to load workflow templates')}
            description={loadError}
            action={(
              <Button variant="outline" size="sm" onClick={() => { void loadTemplates() }}>
                {t('common.retry', 'Retry')}
              </Button>
            )}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              data-testid="template-card-blank"
              onClick={() => handleSelect(BLANK_CARD_ID)}
              onFocus={() => setActiveCardId(BLANK_CARD_ID)}
              onMouseEnter={() => setActiveCardId(BLANK_CARD_ID)}
              className={cardClassName(BLANK_CARD_ID)}
            >
              <div className="flex items-center gap-2">
                <SquareDashed className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-semibold text-foreground">
                  {t('workflows.templates.gallery.blank.name', 'Blank canvas')}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {t('workflows.templates.gallery.blank.description', 'Start from scratch with an empty canvas.')}
              </span>
            </button>
            {(templates ?? []).map((template) => {
              const Icon = resolveTemplateIcon(template.icon)
              return (
                <button
                  key={template.id}
                  type="button"
                  data-testid={`template-card-${template.id}`}
                  onClick={() => handleSelect(template.id)}
                  onFocus={() => setActiveCardId(template.id)}
                  onMouseEnter={() => setActiveCardId(template.id)}
                  className={cardClassName(template.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate text-sm font-semibold text-foreground">{t(template.nameKey)}</span>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{template.category}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{t(template.descriptionKey)}</span>
                </button>
              )
            })}
          </div>
        )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}
