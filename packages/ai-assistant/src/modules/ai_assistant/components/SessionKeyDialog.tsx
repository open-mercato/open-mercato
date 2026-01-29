'use client'

import * as React from 'react'
import { useState } from 'react'
import { Copy, RefreshCw, AlertTriangle, Check, Key, Clock } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
}

type SessionKeyResponse = {
  sessionToken: string
  expiresAt: string
}

export default function SessionKeyDialog({ open, onOpenChange }: Props) {
  const t = useT()
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)
  const [copiedInstructions, setCopiedInstructions] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateSessionKey = async () => {
    setIsGenerating(true)
    setError(null)
    try {
      const res = await apiCall<SessionKeyResponse>('/api/ai_assistant/session-key', {
        method: 'POST',
      })
      if (res.ok && res.result?.sessionToken) {
        setSessionToken(res.result.sessionToken)
        setExpiresAt(res.result.expiresAt)
      } else {
        setError(t('ai_assistant.session.error.failed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ai_assistant.session.error.failed'))
    } finally {
      setIsGenerating(false)
    }
  }

  // Auto-generate on open if no token
  React.useEffect(() => {
    if (open && !sessionToken && !isGenerating) {
      generateSessionKey()
    }
  }, [open])

  const llmInstructions = `You have access to Open Mercato MCP tools for managing business data (customers, orders, products, etc.).

IMPORTANT: Include "_sessionToken" in EVERY tool call:
{
  "_sessionToken": "${sessionToken || 'sess_abc123...'}",
  ...other parameters
}

Workflow (use this order):
1. "discover_schema" - Understand entities, fields, and relationships first
   Examples: { "query": "customer" }, { "query": "orders" }, { "query": "products" }
2. "find_api" - Find the API endpoint for your operation (list, get, create, update, delete)
3. "call_api" - Execute the API call with proper parameters`

  const copyToken = async () => {
    if (sessionToken) {
      await navigator.clipboard.writeText(sessionToken)
      setCopiedToken(true)
      setTimeout(() => setCopiedToken(false), 2000)
    }
  }

  const copyInstructions = async () => {
    await navigator.clipboard.writeText(llmInstructions)
    setCopiedInstructions(true)
    setTimeout(() => setCopiedInstructions(false), 2000)
  }

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    },
    [onOpenChange],
  )

  const handleClose = () => {
    setSessionToken(null)
    setExpiresAt(null)
    setError(null)
    setCopiedToken(false)
    setCopiedInstructions(false)
    onOpenChange(false)
  }

  const formatExpiry = (isoDate: string | null) => {
    if (!isoDate) return t('ai_assistant.session.expiresDefault')
    const date = new Date(isoDate)
    return date.toLocaleString()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onKeyDown={handleKeyDown} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {t('ai_assistant.session.title')}
          </DialogTitle>
          <DialogDescription>
            {t('ai_assistant.session.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isGenerating && !sessionToken ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              {t('ai_assistant.session.generating')}
            </div>
          ) : sessionToken ? (
            <>
              {/* Session Token */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t('ai_assistant.session.tokenLabel')}</span>
                  <Button variant="outline" size="sm" onClick={copyToken} className="gap-1.5">
                    {copiedToken ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedToken ? t('ai_assistant.session.copied') : t('ai_assistant.session.copy')}
                  </Button>
                </div>
                <code className="block text-xs bg-muted px-3 py-2 rounded font-mono break-all">
                  {sessionToken}
                </code>
              </div>

              {/* Expiry Info */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>{t('ai_assistant.session.expires')} {formatExpiry(expiresAt)}</span>
              </div>

              {/* Separator */}
              <div className="border-t" />

              {/* LLM Instructions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t('ai_assistant.session.llmInstructions')}</span>
                  <Button variant="outline" size="sm" onClick={copyInstructions} className="gap-1.5">
                    {copiedInstructions ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedInstructions ? t('ai_assistant.session.copied') : t('ai_assistant.session.copy')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('ai_assistant.session.copyToSystemPrompt')}
                </p>
                <pre className="bg-muted/50 rounded-lg p-4 text-xs font-mono overflow-x-auto border whitespace-pre-wrap">
                  {llmInstructions}
                </pre>
              </div>
            </>
          ) : null}

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          {sessionToken && (
            <Button
              variant="outline"
              onClick={generateSessionKey}
              disabled={isGenerating}
              className="gap-1.5"
            >
              <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
              {t('ai_assistant.session.generateNew')}
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}>
            {t('ai_assistant.session.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
