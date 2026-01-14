'use client'

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Server, Plus, Trash2, Loader2, Check, Power, ExternalLink } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

// Types matching the API response
type McpServerType = 'http' | 'stdio'

type McpServerConfig = {
  id: string
  name: string
  type: McpServerType
  url?: string
  command?: string
  args?: string[]
  apiKeyId?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

type McpServersResponse = {
  servers: McpServerConfig[]
}

const SERVER_TYPE_LABELS: Record<McpServerType, string> = {
  http: 'HTTP',
  stdio: 'Command Line',
}

export function McpServersSection() {
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<McpServerType>('http')
  const [formUrl, setFormUrl] = useState('')
  const [formCommand, setFormCommand] = useState('')
  const [formArgs, setFormArgs] = useState('')
  const [formEnabled, setFormEnabled] = useState(true)

  // Fetch servers
  const fetchServers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/ai/mcp-servers')
      if (!response.ok) {
        throw new Error('Failed to fetch MCP servers')
      }
      const data: McpServersResponse = await response.json()
      setServers(data.servers)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchServers()
  }, [fetchServers])

  // Reset form
  const resetForm = useCallback(() => {
    setFormName('')
    setFormType('http')
    setFormUrl('')
    setFormCommand('')
    setFormArgs('')
    setFormEnabled(true)
    setEditingServer(null)
  }, [])

  // Open dialog for new server
  const openNewDialog = () => {
    resetForm()
    setDialogOpen(true)
  }

  // Open dialog for editing
  const openEditDialog = (server: McpServerConfig) => {
    setFormName(server.name)
    setFormType(server.type)
    setFormUrl(server.url ?? '')
    setFormCommand(server.command ?? '')
    setFormArgs(server.args?.join(' ') ?? '')
    setFormEnabled(server.enabled)
    setEditingServer(server)
    setDialogOpen(true)
  }

  // Save server
  const handleSave = async () => {
    if (!formName.trim()) {
      flash('Name is required', 'error')
      return
    }

    if (formType === 'http' && !formUrl.trim()) {
      flash('URL is required for HTTP servers', 'error')
      return
    }

    if (formType === 'stdio' && !formCommand.trim()) {
      flash('Command is required for CLI servers', 'error')
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: formName.trim(),
        type: formType,
        enabled: formEnabled,
      }

      if (formType === 'http') {
        body.url = formUrl.trim()
      } else {
        body.command = formCommand.trim()
        if (formArgs.trim()) {
          body.args = formArgs.trim().split(/\s+/)
        }
      }

      const url = editingServer
        ? `/api/ai/mcp-servers/${editingServer.id}`
        : '/api/ai/mcp-servers'

      const response = await fetch(url, {
        method: editingServer ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save server')
      }

      flash(editingServer ? 'Server updated' : 'Server added', 'success')
      setDialogOpen(false)
      resetForm()
      await fetchServers()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to save server', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Toggle server enabled state
  const toggleEnabled = async (server: McpServerConfig) => {
    try {
      const response = await fetch(`/api/ai/mcp-servers/${server.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      })

      if (!response.ok) {
        throw new Error('Failed to update server')
      }

      flash(server.enabled ? 'Server disabled' : 'Server enabled', 'success')
      await fetchServers()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to update server', 'error')
    }
  }

  // Delete server
  const deleteServer = async (server: McpServerConfig) => {
    if (!confirm(`Are you sure you want to delete "${server.name}"?`)) {
      return
    }

    try {
      const response = await fetch(`/api/ai/mcp-servers/${server.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete server')
      }

      flash('Server deleted', 'success')
      await fetchServers()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to delete server', 'error')
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading MCP servers...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="text-destructive">Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="h-5 w-5" />
            MCP Servers
          </h2>
          <p className="text-sm text-muted-foreground">
            Connect to external MCP servers for additional AI capabilities.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNewDialog} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Add Server
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingServer ? 'Edit MCP Server' : 'Add MCP Server'}
              </DialogTitle>
              <DialogDescription>
                Configure a connection to an external MCP server.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="server-name">Name</Label>
                <Input
                  id="server-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="My MCP Server"
                />
              </div>

              <div className="space-y-2">
                <Label>Connection Type</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={formType === 'http' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFormType('http')}
                  >
                    HTTP
                  </Button>
                  <Button
                    type="button"
                    variant={formType === 'stdio' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFormType('stdio')}
                  >
                    Command Line
                  </Button>
                </div>
              </div>

              {formType === 'http' && (
                <div className="space-y-2">
                  <Label htmlFor="server-url">Server URL</Label>
                  <Input
                    id="server-url"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder="http://localhost:3001/mcp"
                  />
                </div>
              )}

              {formType === 'stdio' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="server-command">Command</Label>
                    <Input
                      id="server-command"
                      value={formCommand}
                      onChange={(e) => setFormCommand(e.target.value)}
                      placeholder="npx"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="server-args">Arguments (space-separated)</Label>
                    <Input
                      id="server-args"
                      value={formArgs}
                      onChange={(e) => setFormArgs(e.target.value)}
                      placeholder="-y @modelcontextprotocol/server-example"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="server-enabled"
                  checked={formEnabled}
                  onChange={(e) => setFormEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="server-enabled" className="font-normal">
                  Enable this server
                </Label>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingServer ? 'Update' : 'Add'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Built-in Local Server */}
      <div className="space-y-3">
        <div className="p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
                <Check className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-sm">Local Tools Server</p>
                <p className="text-xs text-muted-foreground">Built-in MCP tools (always enabled)</p>
              </div>
            </div>
            <span className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              Active
            </span>
          </div>
        </div>

        {/* External Servers */}
        {servers.map((server) => (
          <div
            key={server.id}
            className={`p-3 rounded-lg border transition-colors ${
              server.enabled
                ? 'border-border bg-muted/30'
                : 'border-border bg-muted/10 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  server.enabled
                    ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {server.type === 'http' ? (
                    <ExternalLink className="h-4 w-4" />
                  ) : (
                    <Server className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-sm">{server.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {SERVER_TYPE_LABELS[server.type]}
                    {server.type === 'http' && server.url && ` - ${server.url}`}
                    {server.type === 'stdio' && server.command && ` - ${server.command}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => toggleEnabled(server)}
                  title={server.enabled ? 'Disable' : 'Enable'}
                >
                  <Power className={`h-4 w-4 ${server.enabled ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => openEditDialog(server)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                  onClick={() => deleteServer(server)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}

        {servers.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">No external MCP servers configured.</p>
            <p className="text-xs mt-1">Click "Add Server" to connect to an external MCP server.</p>
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="mt-4 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
        <div className="flex items-start gap-2">
          <svg className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <p className="font-medium mb-1">About MCP Servers</p>
            <p className="text-xs">
              MCP (Model Context Protocol) servers provide tools that the AI assistant can use.
              Connect to external servers to extend the assistant's capabilities.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
