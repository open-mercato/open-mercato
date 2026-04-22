'use client'

import { useState, useCallback, useEffect } from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { ToolInfo, ToolExecutionResult } from '../types'

export function useMcpTools() {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTools = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { ok, result, status } = await apiCall<{ tools: ToolInfo[] }>(
        '/api/ai_assistant/tools',
        { headers: { 'x-om-forbidden-redirect': '0' } }
      )
      if (!ok) {
        throw new Error(`Failed to fetch tools: ${status}`)
      }
      setTools(result?.tools || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tools')
      setTools([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  const executeTool = useCallback(
    async (toolName: string, args: Record<string, unknown> = {}): Promise<ToolExecutionResult> => {
      try {
        const { ok, result, status } = await apiCall<{ result: unknown; error?: string }>(
          '/api/ai_assistant/tools/execute',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-om-forbidden-redirect': '0',
            },
            body: JSON.stringify({ toolName, args }),
          }
        )

        if (!ok) {
          return {
            success: false,
            error: result?.error || `Tool execution failed: ${status}`,
          }
        }

        return {
          success: true,
          result: result?.result,
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Tool execution failed',
        }
      }
    },
    []
  )

  // Fetch tools on mount
  useEffect(() => {
    fetchTools()
  }, [fetchTools])

  return {
    tools,
    isLoading,
    error,
    fetchTools,
    executeTool,
  }
}
