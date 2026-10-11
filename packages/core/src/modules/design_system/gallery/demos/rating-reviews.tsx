import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Button } from '@open-mercato/ui/primitives/button'
import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'

export function RatingCellDemo({ icon, initialValue = 0, max = 1, disabled = false }: { icon: 'star' | 'heart'; initialValue?: number; max?: number; disabled?: boolean }) {
  const t = useT()
  const [value, setValue] = React.useState(initialValue)
  return <Rating value={value} onChange={setValue} max={max} icon={icon} appearance="cell" disabled={disabled} aria-label={t('design_system.gallery.samples.rating.label')} />
}

export function RatingReviewDemo({ icon, alignment }: { icon: 'star' | 'heart'; alignment: 'vertical' | 'horizontal' }) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)
  const value = new Intl.NumberFormat(locale).format(4.5)
  const count = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(5200)
  const summary = t('design_system.gallery.samples.rating.summary', '{value} ∙ {count} Ratings', { value, count })
  const reviews = t('design_system.gallery.samples.rating.reviews', '{count} reviews', { count: 18 })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="rating-review" data-alignment={alignment} className={cn('inline-flex max-w-full items-start gap-2', alignment === 'vertical' ? 'flex-col' : 'flex-wrap')}>
        <Rating value={4.5} allowHalf icon={icon} />
        <div className="flex flex-wrap items-start gap-1 text-sm leading-5">
          <span>{summary}</span>
          <LinkButton asChild variant="gray" underline="always"><DialogTrigger>{reviews}</DialogTrigger></LinkButton>
        </div>
      </div>
      <DialogContent onKeyDownCapture={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(false) } }}>
        <DialogHeader><DialogTitle>{reviews}</DialogTitle><DialogDescription>{summary}</DialogDescription></DialogHeader>
        <ScrollArea className="h-72" scrollbarSize="md">
          <ol className="flex flex-col gap-3 pr-6">
            {Array.from({ length: 18 }, (_, index) => <li key={index} className="flex items-center justify-between gap-3 text-sm"><span>{t('design_system.gallery.samples.rating.reviewNumber', 'Review {number}', { number: index + 1 })}</span><Rating value={index < 9 ? 5 : 4} icon={icon} /></li>)}
          </ol>
        </ScrollArea>
        <DialogFooter><Button asChild variant="outline"><DialogClose>{t('common.close')}</DialogClose></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
