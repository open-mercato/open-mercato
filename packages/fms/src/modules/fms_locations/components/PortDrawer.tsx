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

export function PortDrawer({ open, onOpenChange, onCreated }: PortDrawerProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    locode: '',
    lat: '',
    lng: '',
    city: '',
    country: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const payload = {
        ...formData,
        lat: formData.lat ? parseFloat(formData.lat) : null,
        lng: formData.lng ? parseFloat(formData.lng) : null,
        city: formData.city || null,
        country: formData.country || null,
      }

      const response = await apiCall<{ id: string; error?: string }>('/api/fms_locations/ports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok && response.result?.id) {
        flash('Port created successfully', 'success')
        onCreated(response.result.id)
        onOpenChange(false)
        setFormData({ code: '', name: '', locode: '', lat: '', lng: '', city: '', country: '' })
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
      <SheetContent className="sm:max-w-[425px] overflow-y-auto" onKeyDown={handleKeyDown}>
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
            <Label htmlFor="locode">UN/LOCODE</Label>
            <Input
              id="locode"
              placeholder="PLGDN"
              value={formData.locode}
              onChange={(e) => setFormData({ ...formData, locode: e.target.value.toUpperCase() })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lat">Latitude</Label>
              <Input
                id="lat"
                type="number"
                step="any"
                placeholder="54.3520"
                value={formData.lat}
                onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lng">Longitude</Label>
              <Input
                id="lng"
                type="number"
                step="any"
                placeholder="18.6466"
                value={formData.lng}
                onChange={(e) => setFormData({ ...formData, lng: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              placeholder="Gdansk"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              placeholder="Poland"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            />
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
