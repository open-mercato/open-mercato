'use client'

import * as React from 'react'
import { useState } from 'react'
import { Copy, RefreshCw, AlertTriangle, Check, Settings } from 'lucide-react'
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
  mcpUrl: string
}

type ApiKeyResponse = {
  id: string
  name: string
  keyPrefix: string
  secret?: string
}

export default function McpConfigDialog({ open, onOpenChange, mcpUrl }: Props) {
  const t = useT()
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copiedConfig, setCopiedConfig] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateApiKey = async () => {
    setIsGenerating(true)
    setError(null)
    try {
      const res = await apiCall<ApiKeyResponse>('/api/api_keys/keys', {
        method: 'POST',
        body: JSON.stringify({
          name: `MCP Config - ${new Date().toLocaleDateString()}`,
          description: 'Generated from AI Assistant settings for MCP client',
        }),
      })
      if (res.ok && res.result?.secret) {
        setApiKey(res.result.secret)
      } else {
        setError(t('ai_assistant.mcp.error.failed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ai_assistant.mcp.error.failed'))
    } finally {
      setIsGenerating(false)
    }
  }

  const mcpConfig = {
    mcpServers: {
      'open-mercato': {
        type: 'http',
        url: `${mcpUrl}/mcp`,
        headers: {
          'x-api-key': apiKey || 'omk_xxxx.yyyy...',
        },
      },
    },
  }

  const configJson = JSON.stringify(mcpConfig, null, 2)

  const copyConfig = async () => {
    await navigator.clipboard.writeText(configJson)
    setCopiedConfig(true)
    setTimeout(() => setCopiedConfig(false), 2000)
  }

  const copyKey = async () => {
    if (apiKey) {
      await navigator.clipboard.writeText(apiKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    }
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
    setApiKey(null)
    setError(null)
    setCopiedConfig(false)
    setCopiedKey(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onKeyDown={handleKeyDown} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            {t('ai_assistant.mcp.title')}
          </DialogTitle>
          <DialogDescription>
            {t('ai_assistant.mcp.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Config JSON */}
          <div className="relative">
            <pre className="bg-muted/50 rounded-lg p-4 text-xs font-mono overflow-x-auto border">
              {configJson}
            </pre>
          </div>

          {/* API Key Section */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-muted-foreground">{t('ai_assistant.mcp.apiKeyLabel')}</span>
            {apiKey ? (
              <>
                <code className="text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[200px]">
                  {apiKey.slice(0, 16)}...
                </code>
                <Button variant="outline" size="sm" onClick={copyKey} className="gap-1.5">
                  {copiedKey ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedKey ? t('ai_assistant.mcp.copied') : t('ai_assistant.mcp.copyKey')}
                </Button>
              </>
            ) : (
              <span className="text-sm text-muted-foreground italic">{t('ai_assistant.mcp.notGenerated')}</span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={generateApiKey}
              disabled={isGenerating}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              {apiKey ? t('ai_assistant.mcp.generateNew') : t('ai_assistant.mcp.generateApiKey')}
            </Button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          {apiKey && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {t('ai_assistant.mcp.saveKeyWarning')}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('ai_assistant.mcp.close')}
          </Button>
          <Button onClick={copyConfig} className="gap-1.5">
            {copiedConfig ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiedConfig ? t('ai_assistant.mcp.copied') : t('ai_assistant.mcp.copyConfig')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
