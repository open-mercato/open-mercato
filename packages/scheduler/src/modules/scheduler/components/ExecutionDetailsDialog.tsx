"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { formatDistanceToNow } from 'date-fns'

type ExecutionRun = {
  id: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'completed' | 'failed' | 'skipped'
  triggerType: 'scheduled' | 'manual'
  queueJobId?: string
  queueName?: string
  errorMessage?: string
  errorStack?: string
  durationMs?: number
}

type ExecutionDetailsDialogProps = {
  open: boolean
  onClose: () => void
  run: ExecutionRun | null
  scheduleName: string
}

export function ExecutionDetailsDialog({
  open,
  onClose,
  run,
  scheduleName,
}: ExecutionDetailsDialogProps) {
  const getStatusBadgeVariant = (status: string): 'destructive' | 'secondary' | 'default' | 'outline' => {
    switch (status) {
      case 'completed':
        return 'default'
      case 'failed':
        return 'destructive'
      case 'running':
        return 'outline'
      case 'skipped':
        return 'secondary'
      default:
        return 'secondary'
    }
  }

  const formatDuration = (durationMs?: number) => {
    if (!durationMs) return 'N/A'
    return `${(durationMs / 1000).toFixed(2)}s`
  }

  if (!run) return null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            Execution Details: {scheduleName}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Run ID: {run.id}
          </p>
        </DialogHeader>

        <div className="space-y-6">
          {/* Overview Section */}
          <div className="grid grid-cols-2 gap-4 overflow-hidden">
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Status</Label>
              <div className="mt-1">
                <Badge variant={getStatusBadgeVariant(run.status)}>
                  {run.status}
                </Badge>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium text-muted-foreground">Trigger Type</Label>
              <p className="mt-1 text-sm capitalize">{run.triggerType}</p>
            </div>

            <div>
              <Label className="text-sm font-medium text-muted-foreground">Started At</Label>
              <p className="mt-1 text-sm">
                {new Date(run.startedAt).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
              </p>
            </div>

            {run.finishedAt && (
              <div>
                <Label className="text-sm font-medium text-muted-foreground">Finished At</Label>
                <p className="mt-1 text-sm">
                  {new Date(run.finishedAt).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(run.finishedAt), { addSuffix: true })}
                </p>
              </div>
            )}

            <div>
              <Label className="text-sm font-medium text-muted-foreground">Duration</Label>
              <p className="mt-1 text-sm">{formatDuration(run.durationMs)}</p>
            </div>

            {run.queueJobId && (
              <div className="min-w-0 overflow-hidden">
                <Label className="text-sm font-medium text-muted-foreground">Queue Job ID</Label>
                <p 
                  className="mt-1 text-xs font-mono truncate cursor-pointer hover:text-primary transition-colors" 
                  title={run.queueJobId}
                  onClick={() => navigator.clipboard.writeText(run.queueJobId!)}
                >
                  {run.queueJobId}
                </p>
              </div>
            )}

            {run.queueName && (
              <div>
                <Label className="text-sm font-medium text-muted-foreground">Queue Name</Label>
                <p className="mt-1 text-sm">{run.queueName}</p>
              </div>
            )}
          </div>

          {/* Error Message Section */}
          {run.status === 'failed' && run.errorMessage && (
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Error Message</Label>
              <Alert variant="destructive" className="mt-2">
                <AlertDescription>
                  <div className="flex items-start gap-2">
                    <span className="text-lg">⚠️</span>
                    <div className="flex-1">
                      <pre className="whitespace-pre-wrap text-sm font-mono">
                        {run.errorMessage}
                      </pre>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Stack Trace Section */}
          {run.status === 'failed' && run.errorStack && (
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Stack Trace</Label>
              <pre className="mt-2 bg-muted p-3 rounded text-xs overflow-auto max-h-64 font-mono">
                {run.errorStack}
              </pre>
            </div>
          )}

          {/* Info Message for Successful Runs */}
          {run.status === 'completed' && (
            <Alert>
              <AlertDescription>
                <div className="flex items-start gap-2">
                  <span className="text-lg">✓</span>
                  <span className="text-sm">
                    This execution completed successfully without errors.
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Info Message for Running */}
          {run.status === 'running' && (
            <Alert>
              <AlertDescription>
                <div className="flex items-start gap-2">
                  <span className="text-lg">⏳</span>
                  <span className="text-sm">
                    This execution is currently in progress.
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Info Message for Skipped */}
          {run.status === 'skipped' && (
            <Alert>
              <AlertDescription>
                <div className="flex items-start gap-2">
                  <span className="text-lg">⊘</span>
                  <span className="text-sm">
                    This execution was skipped.
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
