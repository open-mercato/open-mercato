'use client'

import { useState, useCallback, useEffect } from 'react'
import type { ToolInfo, ToolExecutionResult } from '../types'

export function useMcpTools() {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTools = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/ai/tools')
      if (!response.ok) {
        throw new Error(`Failed to fetch tools: ${response.status}`)
      }
      const data = await response.json()
      setTools(data.tools || [])
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
        const response = await fetch('/api/ai/tools/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolName, args }),
        })

        const data = await response.json()

        if (!response.ok) {
          return {
            success: false,
            error: data.error || `Tool execution failed: ${response.status}`,
          }
        }

        return {
          success: true,
          result: data.result,
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
