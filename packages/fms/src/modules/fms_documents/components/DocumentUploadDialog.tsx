'use client'

import * as React from 'react'
import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@open-mercato/ui/primitives/sheet'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

interface DocumentUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const DOCUMENT_CATEGORIES = [
  { value: 'offer', label: 'Offer' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'customs', label: 'Customs' },
  { value: 'bill_of_lading', label: 'Bill of Lading' },
  { value: 'other', label: 'Other' },
]

export function DocumentUploadDialog({ open, onOpenChange, onSuccess }: DocumentUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      if (!name) {
        // Auto-fill name from filename
        setName(selectedFile.name.replace(/\.[^/.]+$/, ''))
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!file) {
      flash('Please select a file', 'error')
      return
    }

    if (!name) {
      flash('Please enter a document name', 'error')
      return
    }

    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', name)
      if (category) formData.append('category', category)
      if (description) formData.append('description', description)

      const response = await fetch('/api/fms_documents/upload', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (response.ok && result.ok) {
        flash('Document uploaded successfully', 'success')
        resetForm()
        onSuccess?.()
      } else {
        flash(result.error || 'Upload failed', 'error')
      }
    } catch (error) {
      console.error('Upload error:', error)
      flash(error instanceof Error ? error.message : 'Upload failed', 'error')
    } finally {
      setIsUploading(false)
    }
  }

  const resetForm = () => {
    setFile(null)
    setName('')
    setCategory('')
    setDescription('')
  }

  const handleClose = () => {
    if (!isUploading) {
      resetForm()
      onOpenChange(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Upload Document</SheetTitle>
          <SheetDescription>Upload a new freight document with metadata</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label htmlFor="file">
              File <span className="text-red-500">*</span>
            </Label>
            <Input
              id="file"
              type="file"
              onChange={handleFileChange}
              disabled={isUploading}
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            />
            {file && (
              <p className="text-sm text-muted-foreground">
                Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">
              Document Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter document name"
              disabled={isUploading}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={isUploading}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select category...</option>
              {DOCUMENT_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter document description"
              disabled={isUploading}
              rows={3}
            />
          </div>

          <SheetFooter className="mt-6">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isUploading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isUploading || !file}>
              {isUploading ? (
                <>
                  <Upload className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
