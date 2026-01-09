'use client'

import * as React from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@open-mercato/ui/primitives/sheet'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

export type QuoteDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (quoteId: string, navigateToDetail: boolean) => void
}

type FormData = {
  clientName: string
  originPortCode: string
  destinationPortCode: string
  containerCount: string
}

export function QuoteDrawer({ open, onOpenChange, onCreated }: QuoteDrawerProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [formData, setFormData] = React.useState<FormData>({
    clientName: '',
    originPortCode: '',
    destinationPortCode: '',
    containerCount: '',
  })
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormData, string>>>({})

  const resetForm = React.useCallback(() => {
    setFormData({
      clientName: '',
      originPortCode: '',
      destinationPortCode: '',
      containerCount: '',
    })
    setErrors({})
  }, [])

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetForm()
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange, resetForm]
  )

  const validate = React.useCallback(() => {
    const newErrors: Partial<Record<keyof FormData, string>> = {}
    if (!formData.clientName.trim()) {
      newErrors.clientName = 'Client is required'
    }
    if (!formData.originPortCode.trim()) {
      newErrors.originPortCode = 'Origin port is required'
    }
    if (!formData.destinationPortCode.trim()) {
      newErrors.destinationPortCode = 'Destination port is required'
    }
    if (formData.containerCount && isNaN(parseInt(formData.containerCount, 10))) {
      newErrors.containerCount = 'Must be a number'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [formData])

  const handleSubmit = React.useCallback(
    async (navigateToDetail: boolean) => {
      if (!validate()) return

      setIsSubmitting(true)
      try {
        const payload: Record<string, unknown> = {
          clientName: formData.clientName.trim(),
          originPortCode: formData.originPortCode.trim().toUpperCase(),
          destinationPortCode: formData.destinationPortCode.trim().toUpperCase(),
          status: 'draft',
        }

        if (formData.containerCount.trim()) {
          payload.containerCount = parseInt(formData.containerCount, 10)
        }

        const response = await apiCall<{ id: string; error?: string }>('/api/fms_quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (response.ok && response.result?.id) {
          flash('Quote created successfully', 'success')
          const quoteId = response.result.id
          handleOpenChange(false)
          onCreated?.(quoteId, navigateToDetail)
        } else {
          flash(response.result?.error || 'Failed to create quote', 'error')
        }
      } catch (error) {
        flash(error instanceof Error ? error.message : 'An unexpected error occurred', 'error')
      } finally {
        setIsSubmitting(false)
      }
    },
    [formData, validate, handleOpenChange, onCreated]
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSubmit(false)
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        handleOpenChange(false)
      }
    },
    [handleSubmit, handleOpenChange]
  )

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full max-w-md sm:max-w-lg overflow-y-auto">
        <div onKeyDown={handleKeyDown}>
          <SheetHeader>
            <SheetTitle>New Quote</SheetTitle>
            <SheetDescription>
              Create a new freight quote request.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="clientName" className="text-sm font-medium">
                Client <span className="text-red-500">*</span>
              </Label>
              <Input
                id="clientName"
                placeholder="Enter client name"
                value={formData.clientName}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, clientName: e.target.value }))
                }
                className={errors.clientName ? 'border-red-500' : ''}
              />
              {errors.clientName && <p className="text-sm text-red-500">{errors.clientName}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="originPortCode" className="text-sm font-medium">
                Origin Port <span className="text-red-500">*</span>
              </Label>
              <Input
                id="originPortCode"
                placeholder="e.g. CNSHA"
                value={formData.originPortCode}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, originPortCode: e.target.value.toUpperCase() }))
                }
                maxLength={10}
                className={errors.originPortCode ? 'border-red-500' : ''}
              />
              {errors.originPortCode && <p className="text-sm text-red-500">{errors.originPortCode}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="destinationPortCode" className="text-sm font-medium">
                Destination Port <span className="text-red-500">*</span>
              </Label>
              <Input
                id="destinationPortCode"
                placeholder="e.g. NLRTM"
                value={formData.destinationPortCode}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    destinationPortCode: e.target.value.toUpperCase(),
                  }))
                }
                maxLength={10}
                className={errors.destinationPortCode ? 'border-red-500' : ''}
              />
              {errors.destinationPortCode && <p className="text-sm text-red-500">{errors.destinationPortCode}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="containerCount" className="text-sm font-medium">
                Number of Containers
              </Label>
              <Input
                id="containerCount"
                type="number"
                min="1"
                placeholder="e.g. 10"
                value={formData.containerCount}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, containerCount: e.target.value }))
                }
                className={errors.containerCount ? 'border-red-500' : ''}
              />
              {errors.containerCount && <p className="text-sm text-red-500">{errors.containerCount}</p>}
            </div>
          </div>

          <SheetFooter className="mt-8 flex-col gap-2 sm:flex-col">
            <Button
              type="button"
              variant="default"
              className="w-full"
              onClick={() => handleSubmit(true)}
              disabled={isSubmitting}
            >
              Create & Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => handleSubmit(false)}
              disabled={isSubmitting}
            >
              Create & Close
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  )
}
