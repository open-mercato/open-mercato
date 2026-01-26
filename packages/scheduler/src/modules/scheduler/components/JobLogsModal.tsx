"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type BullMQJob = {
  id: string
  name: string
  data: Record<string, unknown>
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
  progress?: number
  returnvalue?: unknown
  failedReason?: string
  stacktrace?: string[]
  attemptsMade: number
  processedOn?: string
  finishedOn?: string
  logs: string[]
}

type JobLogsModalProps = {
  open: boolean
  onClose: () => void
  queueJobId: string | null
  queueName: string | null
  scheduleName: string
}

export function JobLogsModal({
  open,
  onClose,
  queueJobId,
  queueName,
  scheduleName,
}: JobLogsModalProps) {
  const t = useT()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [job, setJob] = React.useState<BullMQJob | null>(null)

  React.useEffect(() => {
    if (open && queueJobId && queueName) {
      fetchJobDetails()
    } else {
      setLoading(false)
      setError(null)
      setJob(null)
    }
  }, [open, queueJobId, queueName])

  const fetchJobDetails = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const { result } = await apiCallOrThrow(
        `/api/scheduler/queue-jobs/${queueJobId}?queue=${queueName}`
      )
      setJob(result as BullMQJob)
    } catch (err: any) {
      setError(err.message || 'Failed to load job details')
    } finally {
      setLoading(false)
    }
  }

  const getStateBadgeVariant = (state: string): 'destructive' | 'secondary' | 'default' | 'outline' => {
    switch (state) {
      case 'completed':
        return 'default'
      case 'failed':
        return 'destructive'
      case 'active':
        return 'outline'
      default:
        return 'secondary'
    }
  }

  const formatDuration = (processedOn?: string, finishedOn?: string) => {
    if (!processedOn || !finishedOn) return null
    const duration = new Date(finishedOn).getTime() - new Date(processedOn).getTime()
    return `${(duration / 1000).toFixed(2)}s`
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
        <DialogHeader className="overflow-hidden">
          <DialogTitle>
            Queue Job: {scheduleName}
          </DialogTitle>
          <p 
            className="text-sm text-muted-foreground font-mono truncate cursor-pointer hover:text-primary transition-colors"
            title={queueJobId ?? undefined}
            onClick={() => queueJobId && navigator.clipboard.writeText(queueJobId)}
          >
            Job ID: {queueJobId}
          </p>
        </DialogHeader>

        {loading && (
          <div className="flex justify-center items-center py-8">
            <Spinner />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && !error && job && (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="data">Payload</TabsTrigger>
              {job.failedReason && (
                <TabsTrigger value="error">Error Details</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">State</Label>
                  <div className="mt-1">
                    <Badge variant={getStateBadgeVariant(job.state)}>
                      {job.state}
                    </Badge>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">Attempts</Label>
                  <p className="mt-1 text-sm">{job.attemptsMade}</p>
                </div>

                {job.processedOn && (
                  <div>
                    <Label className="text-sm font-medium">Processed</Label>
                    <p className="mt-1 text-sm">
                      {new Date(job.processedOn).toLocaleString()}
                    </p>
                  </div>
                )}

                {job.finishedOn && (
                  <div>
                    <Label className="text-sm font-medium">Finished</Label>
                    <p className="mt-1 text-sm">
                      {new Date(job.finishedOn).toLocaleString()}
                    </p>
                  </div>
                )}

                {job.processedOn && job.finishedOn && (
                  <div>
                    <Label className="text-sm font-medium">Duration</Label>
                    <p className="mt-1 text-sm">
                      {formatDuration(job.processedOn, job.finishedOn)}
                    </p>
                  </div>
                )}

                {job.progress !== undefined && (
                  <div>
                    <Label className="text-sm font-medium">Progress</Label>
                    <p className="mt-1 text-sm">{job.progress}%</p>
                  </div>
                )}
              </div>

              {job.returnvalue !== undefined && job.returnvalue !== null && (
                <div>
                  <Label className="text-sm font-medium">Return Value</Label>
                  <pre className="mt-1 bg-muted p-3 rounded text-xs overflow-auto max-h-64">
                    {String(typeof job.returnvalue === 'string' ? job.returnvalue : JSON.stringify(job.returnvalue, null, 2))}
                  </pre>
                </div>
              )}
            </TabsContent>

            <TabsContent value="logs">
              {job.logs.length > 0 ? (
                <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-96 font-mono">
                  {job.logs.join('\n')}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">No logs available</p>
              )}
            </TabsContent>

            <TabsContent value="data">
              <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-96">
                {JSON.stringify(job.data, null, 2)}
              </pre>
            </TabsContent>

            {job.failedReason && (
              <TabsContent value="error" className="space-y-4">
                <div>
                  <Label className="text-sm font-medium">Error Message</Label>
                  <pre className="mt-1 bg-red-50 dark:bg-red-950 p-3 rounded text-sm text-red-900 dark:text-red-100">
                    {job.failedReason}
                  </pre>
                </div>

                {job.stacktrace && job.stacktrace.length > 0 && (
                  <div>
                    <Label className="text-sm font-medium">Stack Trace</Label>
                    <pre className="mt-1 bg-muted p-3 rounded text-xs overflow-auto max-h-64 font-mono">
                      {job.stacktrace.join('\n')}
                    </pre>
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
