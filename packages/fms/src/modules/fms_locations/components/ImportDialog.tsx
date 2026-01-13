'use client'

import * as React from 'react'
import { useState, useCallback, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

interface ImportResult {
  locationsCreated: number
  locationsUpdated: number
  errors: Array<{ row: number; message: string }>
  totalRows: number
}

export function ImportDialog({ open, onOpenChange, onImported }: ImportDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback((selectedFile: File | null) => {
    if (selectedFile) {
      const validTypes = ['.csv', '.xlsx', '.xls']
      const isValid = validTypes.some(ext => selectedFile.name.toLowerCase().endsWith(ext))
      if (!isValid) {
        flash('Please select a CSV or Excel file', 'error')
        return
      }
    }
    setFile(selectedFile)
    setResult(null)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files?.[0] || null)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files?.[0] || null
    handleFileSelect(droppedFile)
  }, [handleFileSelect])

  const handleSubmit = async () => {
    if (!file) return
    setIsSubmitting(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await apiCall<ImportResult>('/api/fms_locations/import', {
        method: 'POST',
        body: formData,
      })

      if (response.ok && response.result) {
        setResult(response.result)
        const { locationsCreated, locationsUpdated, errors } = response.result
        if (errors.length === 0) {
          flash(`Import complete: ${locationsCreated} created, ${locationsUpdated} updated`, 'success')
          // Auto-close after successful import with no errors
          setTimeout(() => {
            handleClose()
          }, 1500)
        } else {
          flash(
            `Import complete with ${errors.length} errors: ${locationsCreated} created, ${locationsUpdated} updated`,
            'warning'
          )
        }
        onImported()
      } else {
        flash('Import failed', 'error')
      }
    } catch (error) {
      flash('Import failed', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setFile(null)
    setResult(null)
    setIsDragging(false)
    onOpenChange(false)
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && file && !isSubmitting) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        handleClose()
      }
    },
    [file, isSubmitting]
  )

  const handleDropZoneClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Locations
          </DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file to import locations. Required columns: code, name, type.
            Optional: lat, lng, locode, port_code, city, country.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div
            className={cn(
              'relative border-2 border-dashed rounded-lg p-6 transition-colors cursor-pointer',
              'hover:border-primary/50 hover:bg-muted/50',
              isDragging && 'border-primary bg-primary/10',
              file && 'border-green-500 bg-green-50'
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleDropZoneClick}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-2 text-center">
              <Upload className={cn('h-8 w-8', file ? 'text-green-600' : 'text-muted-foreground')} />
              {file ? (
                <>
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB - Click or drop to replace
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {isDragging ? 'Drop file here' : 'Drag & drop or click to select'}
                  </p>
                  <p className="text-xs text-muted-foreground">CSV, XLSX, or XLS files</p>
                </>
              )}
            </div>
          </div>

          {result && (
            <div className="rounded-md border p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>Created: {result.locationsCreated}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-blue-600" />
                <span>Updated: {result.locationsUpdated}</span>
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <span>Errors: {result.errors.length}</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
                    {result.errors.slice(0, 10).map((err, idx) => (
                      <p key={idx}>
                        Row {err.row}: {err.message}
                      </p>
                    ))}
                    {result.errors.length > 10 && (
                      <p className="italic">...and {result.errors.length - 10} more errors</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium mb-1">CSV Format Example:</p>
            <code className="text-xs block overflow-x-auto">
              code,name,type,lat,lng,locode,port_code,city,country
              <br />
              CNSHA,Shanghai Port,port,31.23,121.47,CNSHA,,Shanghai,China
              <br />
              CNSHA-T1,Terminal 1,terminal,31.24,121.48,,CNSHA,Shanghai,China
            </code>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={handleSubmit} disabled={!file || isSubmitting}>
            {isSubmitting ? (
              'Importing...'
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
