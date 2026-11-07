"use client"

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// Step 5.3 (§7.1's "Proposal builder", §6.3). `CrudForm` over a line-item field array (§7.1's
// own prescribed shape) is not buildable here — this codebase's `CrudForm` has no array-field
// primitive today — so this is a focused, DS-compliant dialog built from primitives instead
// (Dialog/Input/Textarea/ComboboxInput/Button), following the SAME Cmd/Ctrl+Enter submit /
// Escape cancel / aria-label rules §7.2 requires. See this Step's NOTIFY.md entry.
//
// Submits `POST /threads/:id/proposals` (§6.3) directly — no client-side pricing read exists
// (§7.2: "the builder never prices a line itself"); the server prices the proposal AS THE
// BUYER and the result (with `rejectedLines` and each line's provenance) is what the thread
// page's own proposal cards render after a successful submit.

type ProposalBuilderLine = {
  key: string
  productId: string
  productLabel: string
  variantId: string
  quantity: string
}

export type ProposalBuilderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  threadId: string
  onSuccess: () => void
}

function makeLine(): ProposalBuilderLine {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    productId: '',
    productLabel: '',
    variantId: '',
    quantity: '1',
  }
}

type ProductSearchItem = { id?: string; title?: string | null; sku?: string | null }

async function loadProductSuggestions(query?: string): Promise<ComboboxOption[]> {
  const params = new URLSearchParams({ pageSize: '10' })
  if (query && query.trim()) params.set('search', query.trim())
  const call = await apiCall<{ items?: ProductSearchItem[] }>(`/api/catalog/products?${params.toString()}`)
  const items = call.ok && Array.isArray(call.result?.items) ? call.result.items : []
  return items
    .filter((item): item is ProductSearchItem & { id: string } => typeof item.id === 'string')
    .map((item) => ({
      value: item.id,
      label: item.title?.trim() || item.sku?.trim() || item.id,
      description: item.sku ?? null,
    }))
}

export function ProposalBuilderDialog({ open, onOpenChange, threadId, onSuccess }: ProposalBuilderDialogProps) {
  const t = useT()
  const [lines, setLines] = React.useState<ProposalBuilderLine[]>(() => [makeLine()])
  const [note, setNote] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const idempotencyKeyRef = React.useRef<string>(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`)

  const labels = React.useMemo(
    () => ({
      title: t('assisted_selling.admin.builder.title', 'New proposal'),
      description: t(
        'assisted_selling.admin.builder.description',
        'Propose lines to the buyer. Prices are resolved server-side, as the buyer — never as you.',
      ),
      productLabel: t('assisted_selling.admin.builder.fields.product', 'Product'),
      variantLabel: t('assisted_selling.admin.builder.fields.variant', 'Variant ID (optional)'),
      quantityLabel: t('assisted_selling.admin.builder.fields.quantity', 'Quantity'),
      noteLabel: t('assisted_selling.admin.builder.fields.note', 'Note to the buyer (optional)'),
      addLine: t('assisted_selling.admin.builder.actions.addLine', 'Add line'),
      removeLine: t('assisted_selling.admin.builder.actions.removeLine', 'Remove line'),
      cancel: t('assisted_selling.admin.builder.actions.cancel', 'Cancel'),
      submit: t('assisted_selling.admin.builder.actions.submit', 'Author proposal'),
      errors: {
        missingProduct: t('assisted_selling.admin.builder.errors.missingProduct', 'Pick a product for every line.'),
        submit: t('assisted_selling.admin.builder.errors.submit', 'Failed to author this proposal.'),
      },
      flash: { published: t('assisted_selling.admin.builder.flash.published', 'Proposal published.') },
    }),
    [t],
  )

  React.useEffect(() => {
    if (open) {
      setLines([makeLine()])
      setNote('')
      idempotencyKeyRef.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`
    }
  }, [open])

  const mutationContextId = `assisted-selling-builder:${threadId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const handleSubmit = React.useCallback(async () => {
    const trimmedLines = lines
      .map((line) => ({ ...line, productId: line.productId.trim(), variantId: line.variantId.trim(), quantity: line.quantity.trim() }))
      .filter((line) => line.productId.length > 0)
    if (trimmedLines.length === 0) {
      flash(labels.errors.missingProduct, 'error')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await runMutation({
        operation: () =>
          readApiResultOrThrow<{ proposalId: string; rejectedLines: Array<{ productId: string; variantId: string | null; reason: string }> }>(
            `/api/assisted_selling/threads/${threadId}/proposals`,
            {
              method: 'POST',
              body: JSON.stringify({
                lines: trimmedLines.map((line) => ({
                  productId: line.productId,
                  variantId: line.variantId || undefined,
                  quantity: line.quantity,
                })),
                note: note.trim() || undefined,
                idempotencyKey: idempotencyKeyRef.current,
              }),
            },
            { errorMessage: labels.errors.submit },
          ),
        context: { formId: mutationContextId, resourceKind: 'assisted_selling.proposal', resourceId: threadId, retryLastMutation },
        mutationPayload: {},
      })
      if (result.rejectedLines?.length) {
        flash(
          t('assisted_selling.admin.builder.flash.partiallyPublished', '{count} line(s) could not be offered to this buyer.', {
            count: result.rejectedLines.length,
          }),
          'warning',
        )
      } else {
        flash(labels.flash.published, 'success')
      }
      onOpenChange(false)
      onSuccess()
    } catch (error) {
      if (surfaceRecordConflict(error, t)) return
      flash(labels.errors.submit, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [labels, lines, mutationContextId, note, onOpenChange, onSuccess, retryLastMutation, runMutation, t, threadId])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {lines.map((line, index) => (
            <div key={line.key} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
              <div className="min-w-0 flex-1 basis-56">
                <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`proposal-line-product-${line.key}`}>
                  {labels.productLabel}
                </label>
                <ComboboxInput
                  value={line.productId}
                  onChange={(next) => setLines((prev) => prev.map((row) => (row.key === line.key ? { ...row, productId: next } : row)))}
                  loadSuggestions={loadProductSuggestions}
                  placeholder={labels.productLabel}
                />
              </div>
              <div className="w-40">
                <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`proposal-line-variant-${line.key}`}>
                  {labels.variantLabel}
                </label>
                <Input
                  id={`proposal-line-variant-${line.key}`}
                  value={line.variantId}
                  onChange={(event) =>
                    setLines((prev) => prev.map((row) => (row.key === line.key ? { ...row, variantId: event.target.value } : row)))
                  }
                />
              </div>
              <div className="w-24">
                <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`proposal-line-quantity-${line.key}`}>
                  {labels.quantityLabel}
                </label>
                <Input
                  id={`proposal-line-quantity-${line.key}`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) =>
                    setLines((prev) => prev.map((row) => (row.key === line.key ? { ...row, quantity: event.target.value } : row)))
                  }
                />
              </div>
              <IconButton
                type="button"
                variant="ghost"
                aria-label={labels.removeLine}
                title={labels.removeLine}
                disabled={lines.length <= 1}
                onClick={() => setLines((prev) => prev.filter((row) => row.key !== line.key))}
              >
                <Trash2 className="size-4" />
              </IconButton>
              <span className="sr-only">{index + 1}</span>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="self-start gap-2" onClick={() => setLines((prev) => [...prev, makeLine()])}>
            <Plus className="size-4" aria-hidden />
            {labels.addLine}
          </Button>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="proposal-note">
              {labels.noteLabel}
            </label>
            <Textarea id="proposal-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" disabled={isSubmitting} onClick={() => void handleSubmit()}>
            {labels.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
