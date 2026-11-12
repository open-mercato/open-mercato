"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  LEGAL_AGREEMENT_TYPES,
  LEGAL_PAPER_SIDES,
  type LegalAgreementType,
  type LegalPaper,
} from '../../../data/validators'
import {
  buildDefaultStartReviewForm,
  buildStartReviewPayload,
  type StartReviewForm,
} from '../../../lib/startReviewForm'

type StartReviewDialogProps = {
  open: boolean
  documentId: string
  currentUserId: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>
}

export function StartReviewDialog({ open, documentId, currentUserId, onOpenChange, onSubmit }: StartReviewDialogProps) {
  const t = useT()
  const [form, setForm] = React.useState<StartReviewForm>(() => buildDefaultStartReviewForm(new Date()))
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const idPrefix = React.useId()

  React.useEffect(() => {
    if (open) setForm(buildDefaultStartReviewForm(new Date()))
  }, [open])

  const update = <K extends keyof StartReviewForm>(key: K, value: StartReviewForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const canSubmit = form.reference.trim().length > 0 && form.counterparty.trim().length > 0 && !isSubmitting

  const submit = React.useCallback(async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      const ok = await onSubmit(buildStartReviewPayload(form, documentId, currentUserId))
      if (ok) onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }, [canSubmit, currentUserId, documentId, form, onOpenChange, onSubmit])

  const handleOpenChange = (next: boolean) => {
    if (!isSubmitting) onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
          if (event.key === 'Escape' && !isSubmitting) onOpenChange(false)
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('legal_review.start.title', 'Start legal review')}</DialogTitle>
          <DialogDescription>
            {t('legal_review.start.description', 'Creates a legal matter for this document and starts the AI review.')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          data-testid="legal-review-start-form"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-reference`}>{t('legal_review.start.reference', 'Reference')}</Label>
            <Input id={`${idPrefix}-reference`} value={form.reference} onChange={(event) => update('reference', event.target.value)} disabled={isSubmitting} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-counterparty`}>{t('legal_review.start.counterparty', 'Counterparty')} *</Label>
            <Input id={`${idPrefix}-counterparty`} value={form.counterparty} onChange={(event) => update('counterparty', event.target.value)} disabled={isSubmitting} autoFocus />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor={`${idPrefix}-purpose`}>{t('legal_review.start.purpose', 'Purpose')}</Label>
            <Input id={`${idPrefix}-purpose`} value={form.purpose} onChange={(event) => update('purpose', event.target.value)} disabled={isSubmitting} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-jurisdiction`}>{t('legal_review.start.jurisdiction', 'Jurisdiction (country code)')}</Label>
            <Input id={`${idPrefix}-jurisdiction`} value={form.jurisdiction} maxLength={2} onChange={(event) => update('jurisdiction', event.target.value.toUpperCase())} disabled={isSubmitting} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-due`}>{t('legal_review.start.dueDate', 'Due date')}</Label>
            <Input id={`${idPrefix}-due`} type="date" value={form.dueDate} onChange={(event) => update('dueDate', event.target.value)} disabled={isSubmitting} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t('legal_review.start.agreementType', 'Agreement type')}</Label>
            <Select value={form.agreementType} onValueChange={(value) => update('agreementType', value as LegalAgreementType)} disabled={isSubmitting}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEGAL_AGREEMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>{t(`legal_review.agreementType.${type}`, type)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t('legal_review.start.paper', 'Paper')}</Label>
            <Select value={form.paper} onValueChange={(value) => update('paper', value as LegalPaper)} disabled={isSubmitting}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEGAL_PAPER_SIDES.map((side) => (
                  <SelectItem key={side} value={side}>{t(`legal_review.paper.${side}`, side)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            {t('legal_review.start.assigneeHint', 'You will be the requester and the assignee.')}
          </p>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              {t('legal_review.start.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="legal-review-start-submit">
              {t('legal_review.start.submit', 'Start review')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
