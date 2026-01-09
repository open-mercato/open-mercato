'use client'

import * as React from 'react'
import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@open-mercato/ui/primitives/sheet'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

interface PortDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (portId: string) => void
}

const QUADRANT_OPTIONS = [
  { value: 'NE', label: 'Northeast' },
  { value: 'NW', label: 'Northwest' },
  { value: 'SE', label: 'Southeast' },
  { value: 'SW', label: 'Southwest' },
]

export function PortDrawer({ open, onOpenChange, onCreated }: PortDrawerProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    quadrant: 'NE' as string,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const response = await apiCall<{ id: string; error?: string }>('/api/fms_locations/ports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (response.ok && response.result?.id) {
        flash('Port created successfully', 'success')
        onCreated(response.result.id)
        onOpenChange(false)
        setFormData({ code: '', name: '', quadrant: 'NE' })
      } else {
        flash(response.result?.error || 'Failed to create port', 'error')
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to create port', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
    if (e.key === 'Escape') {
      onOpenChange(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[425px]" onKeyDown={handleKeyDown}>
        <SheetHeader>
          <SheetTitle>Create New Port</SheetTitle>
          <SheetDescription>
            Add a new port to the locations catalog.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              placeholder="PLGDN"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Port of Gdansk"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quadrant">Quadrant</Label>
            <select
              id="quadrant"
              value={formData.quadrant}
              onChange={(e) => setFormData({ ...formData, quadrant: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {QUADRANT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Port'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
