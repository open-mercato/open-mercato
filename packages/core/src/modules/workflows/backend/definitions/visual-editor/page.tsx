'use client'

import { WorkflowGraph } from '../../../components/WorkflowGraph'
// Conditional imports based on feature flag
import { NodeEditDialog } from '../../../components/NodeEditDialog'
import { EdgeEditDialog } from '../../../components/EdgeEditDialog'
import { NodeEditDialogCrudForm } from '../../../components/NodeEditDialogCrudForm'
import { EdgeEditDialogCrudForm } from '../../../components/EdgeEditDialogCrudForm'
import { Node, Edge, addEdge, Connection, applyNodeChanges, applyEdgeChanges, NodeChange, EdgeChange } from '@xyflow/react'
import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { graphToDefinition, definitionToGraph, validateWorkflowGraph, generateStepId, generateTransitionId, ValidationError } from '../../../lib/graph-utils'
import { workflowDefinitionDataSchema } from '../../../data/validators'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {CircleQuestionMark, Info, PanelTopClose, PanelTopOpen, Play, Save, Trash2} from 'lucide-react'
import { NODE_TYPE_ICONS, NODE_TYPE_COLORS, NODE_TYPE_LABELS } from '../../../lib/node-type-icons'
import { EventTriggersEditor } from '../../../components/EventTriggersEditor'
import * as React from "react";

/**
 * VisualEditorPage - Visual workflow definition editor
 *
 * Layout:
 * - Page Header: Title, description, and action buttons (Save, Validate, Test)
 * - Workflow Metadata: Collapsible form for workflow details
 * - Page Body:
 *   - Left sidebar: Step palette (click to add)
 *   - Main canvas: ReactFlow graph editor
 * - Flash Messages: Top-right positioned validation messages
 * - Edit Dialogs: Modal dialogs for editing steps and transitions
 */
export default function VisualEditorPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const definitionId = searchParams.get('id')

  const [isLoading, setIsLoading] = useState(!!definitionId)
  const [isSaving, setIsSaving] = useState(false)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [showMetadata, setShowMetadata] = useState(true)
  const [showNodeDialog, setShowNodeDialog] = useState(false)
  const [showEdgeDialog, setShowEdgeDialog] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // Workflow metadata state
  const [workflowId, setWorkflowId] = useState('')
  const [workflowName, setWorkflowName] = useState('')
  const [description, setDescription] = useState('')
  const [version, setVersion] = useState(1)
  const [enabled, setEnabled] = useState(true)
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [icon, setIcon] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [effectiveTo, setEffectiveTo] = useState('')

  // Load existing definition if ID is provided
  useEffect(() => {
    const loadDefinition = async () => {
      if (!definitionId) {
        setIsLoading(false)
        return
      }

      try {
        const result = await apiCall<{ data: any; error?: string }>(`/api/workflows/definitions/${definitionId}`)

        if (!result.ok) {
          flash(`Failed to load workflow: ${result.result?.error || 'Unknown error'}`, 'error')
          setIsLoading(false)
          return
        }

        const definition = result.result?.data

        // Populate metadata
        setWorkflowId(definition.workflowId)
        setWorkflowName(definition.workflowName || definition.definition.workflowName || '')
        setDescription(definition.description || definition.definition.description || '')
        setVersion(definition.version)
        setEnabled(definition.enabled)
        setCategory(definition.metadata?.category || '')
        setTags(definition.metadata?.tags || [])
        setIcon(definition.metadata?.icon || '')
        setEffectiveFrom(definition.effectiveFrom || '')
        setEffectiveTo(definition.effectiveTo || '')

        // Convert definition to graph
        const graph = definitionToGraph(definition.definition)
        setNodes(graph.nodes)
        setEdges(graph.edges)

        flash('Workflow loaded successfully', 'success')
      } catch (error) {
        console.error('Error loading workflow definition:', error)
        flash('Failed to load workflow definition', 'error')
      } finally {
        setIsLoading(false)
      }
    }

    loadDefinition()
  }, [definitionId])

  // Handle node changes from ReactFlow
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  // Handle edge changes from ReactFlow
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds))
  }, [])

  // Handle adding new node from palette
  const handleAddNode = useCallback((nodeType: string) => {
    const newNode: Node = {
      id: generateStepId(nodeType),
      type: nodeType,
      position: {
        x: 250 + nodes.length * 50,
        y: 100 + nodes.length * 150,
      },
      data: {
        label: getDefaultLabel(nodeType),
        description: '',
        badge: getDefaultBadge(nodeType),
        status: 'pending',
      },
    }

    setNodes((nds) => [...nds, newNode])
  }, [nodes.length])

  // Handle node selection - open edit dialog
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
    setSelectedEdge(null)
    setShowNodeDialog(true)
  }, [])

  // Handle edge selection - open edit dialog
  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge)
    setSelectedNode(null)
    setShowEdgeDialog(true)
  }, [])

  // Save node updates
  const handleSaveNode = useCallback((nodeId: string, updates: Partial<Node['data']>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...updates } }
          : node
      )
    )
    flash('Node updated successfully', 'success')
  }, [])

  // Save edge updates
  const handleSaveEdge = useCallback((edgeId: string, updates: Partial<Edge['data']>) => {
    setEdges((eds) =>
      eds.map((edge) =>
        edge.id === edgeId
          ? { ...edge, data: { ...edge.data, ...updates } }
          : edge
      )
    )
    flash('Transition updated successfully', 'success')
  }, [])

  // Delete edge
  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((edge) => edge.id !== edgeId))
    flash('Transition deleted successfully', 'success')
  }, [])

  // Delete node
  const handleDeleteNode = useCallback((nodeId: string) => {
    // Remove the node
    setNodes((nds) => nds.filter((node) => node.id !== nodeId))

    // Remove all edges connected to this node
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))

    flash('Step deleted successfully', 'success')
  }, [])

  // Handle new connections
  const handleConnect = useCallback((connection: Connection) => {
    const newEdge: Edge = {
      id: generateTransitionId(connection.source!, connection.target!),
      source: connection.source!,
      target: connection.target!,
      type: 'smoothstep',
      data: {
        trigger: 'auto',
        preConditions: [],
        postConditions: [],
        activities: [],
        label: '',
      },
    }

    setEdges((eds) => addEdge(newEdge, eds))
  }, [])

  // Validate workflow
  const handleValidate = useCallback(() => {
    const graphErrors = validateWorkflowGraph(nodes, edges)
    const allErrors: ValidationError[] = [...graphErrors]

    // Run Zod schema validation
    try {
      const definitionData = graphToDefinition(nodes, edges, { includePositions: true })
      const result = workflowDefinitionDataSchema.safeParse(definitionData)

      if (!result.success) {
        // Convert Zod errors to validation errors
        result.error.issues.forEach((issue) => {
          allErrors.push({
            type: 'error',
            message: `Schema validation: ${issue.path.join('.')} - ${issue.message}`,
          })
        })
      }
    } catch (error) {
      allErrors.push({
        type: 'error',
        message: `Schema validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
    }

    if (allErrors.length === 0) {
      flash('Validation passed! Your workflow is valid and ready to save.', 'success')
    } else {
      // Show first error/warning message
      const firstError = allErrors[0]
      const errorCount = allErrors.length
      const message = errorCount > 1
        ? `${firstError.message} (and ${errorCount - 1} more ${errorCount === 2 ? 'issue' : 'issues'})`
        : firstError.message
      flash(message, firstError.type === 'error' ? 'error' : 'warning')
    }
  }, [nodes, edges])

  // Save workflow definition
  const handleSave = useCallback(async () => {
    // Validate required fields
    if (!workflowId || !workflowName) {
      flash('Workflow ID and Name are required fields', 'error')
      return
    }

    // Validate workflow structure
    const errors = validateWorkflowGraph(nodes, edges)
    const criticalErrors = errors.filter(e => e.type === 'error')
    if (criticalErrors.length > 0) {
      flash(`Cannot save: ${criticalErrors.length} validation error(s) found. Please fix them first.`, 'error')
      return
    }

    // Generate definition data
    const definitionData = graphToDefinition(nodes, edges, { includePositions: true })

    // Run Zod schema validation before saving
    const schemaResult = workflowDefinitionDataSchema.safeParse(definitionData)
    if (!schemaResult.success) {
      const firstIssue = schemaResult.error.issues[0]
      flash(`Schema error: ${firstIssue.path.join('.')} - ${firstIssue.message}`, 'error')
      return
    }

    setIsSaving(true)

    try {

      const metadata: any = {}
      if (category) metadata.category = category
      if (tags.length > 0) metadata.tags = tags
      if (icon) metadata.icon = icon

      // Determine if creating new or updating existing
      const isUpdate = !!definitionId

      let result
      if (isUpdate) {
        // Update existing definition
        result = await apiCall<{ data: any; error?: string }>(`/api/workflows/definitions/${definitionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            definition: definitionData,
            enabled,
          }),
        })
      } else {
        // Create new definition
        result = await apiCall<{ data: any; error?: string }>('/api/workflows/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowId,
            workflowName,
            description: description || null,
            version,
            definition: definitionData,
            metadata: Object.keys(metadata).length > 0 ? metadata : null,
            enabled,
            effectiveFrom: effectiveFrom || null,
            effectiveTo: effectiveTo || null,
          }),
        })
      }

      if (!result.ok) {
        flash(`Failed to save: ${result.result?.error || 'Unknown error'}`, 'error')
        return
      }

      const savedDefinition = result.result?.data

      flash(`Workflow ${isUpdate ? 'updated' : 'created'} successfully!`, 'success')

      // Redirect to definition detail page after short delay
      setTimeout(() => {
        router.push(`/backend/definitions/${savedDefinition.id}`)
      }, 1500)

    } catch (error) {
      console.error('Error saving workflow definition:', error)
      flash('Failed to save workflow definition. Please try again.', 'error')
    } finally {
      setIsSaving(false)
    }
  }, [nodes, edges, workflowId, workflowName, description, version, enabled, category, tags, definitionId, router])

  // Test workflow
  const handleTest = useCallback(() => {
    // First validate
    const errors = validateWorkflowGraph(nodes, edges)
    const criticalErrors = errors.filter((e) => e.type === 'error')
    if (criticalErrors.length > 0) {
      flash(`Cannot test: ${criticalErrors.length} validation error(s) found. Please fix them first.`, 'error')
      return
    }

    // TODO: Implement test logic (create instance, run first step)
    flash('Test functionality will be implemented next', 'info')
  }, [nodes, edges])

  // Load example workflow
  const handleLoadExample = useCallback(() => {
    // Set example metadata
    setWorkflowId('approval_workflow')
    setWorkflowName('Simple Approval Workflow')
    setDescription('A basic approval workflow for reviewing and approving requests')
    setVersion(1)
    setEnabled(true)
    setCategory('Approvals')
    setTags(['approval', 'review'])

    const exampleNodes: Node[] = [
      {
        id: 'start',
        type: 'start',
        position: { x: 250, y: 50 },
        data: {
          label: 'Start',
          description: 'Workflow begins',
          status: 'pending',
          badge: 'Start',
        },
      },
      {
        id: 'step1',
        type: 'userTask',
        position: { x: 250, y: 250 },
        data: {
          label: 'Review Request',
          description: 'User reviews the incoming request',
          status: 'pending',
          stepNumber: 1,
          badge: 'User Task',
          assignedToRoles: ['Reviewer'],
        },
      },
      {
        id: 'end',
        type: 'end',
        position: { x: 250, y: 450 },
        data: {
          label: 'Complete',
          description: 'Workflow ends',
          status: 'pending',
          badge: 'End',
        },
      },
    ]

    const exampleEdges: Edge[] = [
      {
        id: 'e-start-step1',
        source: 'start',
        target: 'step1',
        type: 'smoothstep',
        data: {
          trigger: 'auto',
          preConditions: [],
          postConditions: [],
          activities: [],
        },
      },
      {
        id: 'e-step1-end',
        source: 'step1',
        target: 'end',
        type: 'smoothstep',
        data: {
          trigger: 'auto',
          preConditions: [],
          postConditions: [],
          activities: [],
        },
      },
    ]

    setNodes(exampleNodes)
    setEdges(exampleEdges)
    flash('Example workflow loaded', 'success')
  }, [])

  // Clear canvas
  const handleClear = useCallback(() => {
    if (nodes.length > 0 || edges.length > 0 || workflowId || workflowName) {
      setShowClearConfirm(true)
    }
  }, [nodes.length, edges.length, workflowId, workflowName])

  // Confirm clear action
  const confirmClear = useCallback(() => {
    setNodes([])
    setEdges([])
    setWorkflowId('')
    setWorkflowName('')
    setDescription('')
    setVersion(1)
    setEnabled(true)
    setCategory('')
    setTags([])
    setIcon('')
    setEffectiveFrom('')
    setEffectiveTo('')
    setShowClearConfirm(false)
    flash('Canvas cleared', 'success')
  }, [])

  // Show loading spinner while loading definition
  if (isLoading) {
    return (
      <Page className="h-screen flex items-center justify-center">
        <LoadingMessage label="Loading workflow definition..." />
      </Page>
    )
  }

  return (
    <Page className="h-screen flex flex-col">
      {/* Page Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/backend/definitions"
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <span aria-hidden className="mr-1 text-base">←</span>
              <span className="sr-only">{t('workflows.definitions.backToList', 'Back to definitions')}</span>
            </Link>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-foreground">
                  {definitionId ? (workflowName || 'Workflow') : t('workflows.backend.definitions.visual_editor.title')}
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                {definitionId
                  ? t('workflows.definitions.detail.summary', 'Editing workflow definition')
                  : t('workflows.definitions.create.summary', 'Create and edit workflow definitions visually with a drag-and-drop interface')
                }
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowMetadata(!showMetadata)}
              disabled={isSaving}
            >
              {showMetadata ? <PanelTopClose className="mr-2 h-4 w-4"/> : <PanelTopOpen className="mr-2 h-4 w-4"/>}
              {showMetadata ? 'Hide' : 'Show'} Metadata
            </Button>
            <Button
              variant="outline"
              onClick={handleLoadExample}
              disabled={isSaving}
            >
              Load Example
            </Button>
            <Button
              variant="destructive"
              onClick={handleClear}
              disabled={isSaving}
            >
              <Trash2 className="mr-2 h-4 w-4" />
                      Clear
            </Button>
            <div className="w-px h-6 bg-gray-300"></div>
            <Button
              variant="outline"
              onClick={handleValidate}
              disabled={isSaving}
            >
              <CircleQuestionMark className="mr-2 h-4 w-4" />
              Validate
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={isSaving}
            >
              <Play className="mr-2 h-4 w-4" />
              Run Test
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
            >
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? 'Saving...' : (definitionId ? 'Update' : 'Save')}
            </Button>
          </div>
        </div>
      </div>

      {/* Workflow Metadata Form */}
      {showMetadata && (
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-4">Workflow Metadata</h2>
            <div className="grid grid-cols-3 gap-4">
            {/* Workflow ID */}
            <div className="space-y-1">
              <Label htmlFor="workflowId" className="text-xs">Workflow ID *</Label>
              <Input
                id="workflowId"
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
                placeholder="checkout_workflow"
                disabled={!!definitionId}
              />
              <p className="text-xs text-muted-foreground">
                {definitionId ? 'Cannot be changed when editing' : 'Lowercase, numbers, hyphens, underscores'}
              </p>
            </div>

            {/* Workflow Name */}
            <div className="space-y-1">
              <Label htmlFor="workflowName" className="text-xs">Workflow Name *</Label>
              <Input
                id="workflowName"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder="Checkout Process"
              />
            </div>

            {/* Category */}
            <div className="space-y-1">
              <Label htmlFor="category" className="text-xs">Category</Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="E-Commerce"
              />
            </div>

            {/* Description */}
            <div className="col-span-3 space-y-1">
              <Label htmlFor="description" className="text-xs">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the purpose of this workflow..."
                rows={2}
              />
            </div>

            {/* Version */}
            <div className="space-y-1">
              <Label htmlFor="version" className="text-xs">Version *</Label>
              <Input
                id="version"
                type="number"
                value={version}
                onChange={(e) => setVersion(parseInt(e.target.value) || 1)}
                min={1}
                disabled={!!definitionId}
              />
              <p className="text-xs text-muted-foreground">
                Version number (increment for major changes)
              </p>
            </div>

            {/* Enabled */}
            <div className="space-y-1">
              <Label className="text-xs">Enabled</Label>
              <div className="flex items-center gap-2 mt-2">
                <Switch
                  id="enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
                <Label htmlFor="enabled" className="text-sm font-normal cursor-pointer">
                  Only enabled workflows can be started
                </Label>
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-1">
              <Label className="text-xs">Tags</Label>
              <TagsInput
                value={tags}
                onChange={setTags}
                placeholder={t('workflows.form.placeholders.tags')}
              />
              <p className="text-xs text-muted-foreground">
                {t('workflows.form.descriptions.tags')}
              </p>
            </div>

            {/* Icon */}
            <div className="space-y-1">
              <Label htmlFor="icon" className="text-xs">Icon</Label>
              <Input
                id="icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="ShoppingCart"
              />
              <p className="text-xs text-muted-foreground">
                Icon name for visual identification
              </p>
            </div>

            {/* Effective From */}
            <div className="space-y-1">
              <Label htmlFor="effectiveFrom" className="text-xs">Effective From</Label>
              <Input
                id="effectiveFrom"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Workflow becomes active from this date
              </p>
            </div>

            {/* Effective To */}
            <div className="space-y-1">
              <Label htmlFor="effectiveTo" className="text-xs">Effective To</Label>
              <Input
                id="effectiveTo"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Workflow deactivates after this date
              </p>
            </div>
            </div>
          </div>

          {/* Event Triggers - Only show when editing an existing definition */}
          {definitionId && (
            <EventTriggersEditor
              workflowDefinitionId={definitionId}
              workflowId={workflowId}
              className="mt-4"
            />
          )}
        </div>
      )}

      {/* Main Content: Sidebar + Canvas */}
      <PageBody className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Step Palette */}
        <div className="w-88 bg-white border-r border-gray-200 p-6 overflow-y-auto">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-2">Step Palette</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Click a step type to add it to the canvas
            </p>

            <div className="space-y-3">
            {/* START Step */}
            <button
              onClick={() => handleAddNode('start')}
              className="w-full text-left px-4 py-3 bg-white border-2 border-gray-200 rounded-xl hover:shadow-md hover:border-gray-300 transition-all cursor-pointer group relative"
            >
              <div className={`absolute top-2 right-2 ${NODE_TYPE_COLORS.start} opacity-60 group-hover:opacity-100 transition-opacity`}>
                {(() => {
                  const Icon = NODE_TYPE_ICONS.start
                  return <Icon className="w-4 h-4" />
                })()}
              </div>
              <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.start.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{NODE_TYPE_LABELS.start.description}</div>
            </button>

            {/* USER_TASK Step */}
            <button
              onClick={() => handleAddNode('userTask')}
              className="w-full text-left px-4 py-3 bg-white border-2 border-gray-200 rounded-xl hover:shadow-md hover:border-gray-300 transition-all cursor-pointer group relative"
            >
              <div className={`absolute top-2 right-2 ${NODE_TYPE_COLORS.userTask} opacity-60 group-hover:opacity-100 transition-opacity`}>
                {(() => {
                  const Icon = NODE_TYPE_ICONS.userTask
                  return <Icon className="w-4 h-4" />
                })()}
              </div>
              <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.userTask.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{NODE_TYPE_LABELS.userTask.description}</div>
            </button>

            {/* AUTOMATED Step */}
            <button
              onClick={() => handleAddNode('automated')}
              className="w-full text-left px-4 py-3 bg-white border-2 border-gray-200 rounded-xl hover:shadow-md hover:border-gray-300 transition-all cursor-pointer group relative"
            >
              <div className={`absolute top-2 right-2 ${NODE_TYPE_COLORS.automated} opacity-60 group-hover:opacity-100 transition-opacity`}>
                {(() => {
                  const Icon = NODE_TYPE_ICONS.automated
                  return <Icon className="w-4 h-4" />
                })()}
              </div>
              <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.automated.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{NODE_TYPE_LABELS.automated.description}</div>
            </button>

            {/* WAIT_FOR_SIGNAL Step */}
            <button
              onClick={() => handleAddNode('waitForSignal')}
              className="w-full text-left px-4 py-3 bg-white border-2 border-gray-200 rounded-xl hover:shadow-md hover:border-gray-300 transition-all cursor-pointer group relative"
            >
              <div className={`absolute top-2 right-2 ${NODE_TYPE_COLORS.waitForSignal} opacity-60 group-hover:opacity-100 transition-opacity`}>
                {(() => {
                  const Icon = NODE_TYPE_ICONS.waitForSignal
                  return <Icon className="w-4 h-4" />
                })()}
              </div>
              <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.waitForSignal.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{NODE_TYPE_LABELS.waitForSignal.description}</div>
            </button>

            {/* SUB_WORKFLOW Step */}
            <button
              onClick={() => handleAddNode('subWorkflow')}
              className="w-full text-left px-4 py-3 bg-white border-2 border-gray-200 rounded-xl hover:shadow-md hover:border-gray-300 transition-all cursor-pointer group relative"
            >
              <div className={`absolute top-2 right-2 ${NODE_TYPE_COLORS.subWorkflow} opacity-60 group-hover:opacity-100 transition-opacity`}>
                {(() => {
                  const Icon = NODE_TYPE_ICONS.subWorkflow
                  return <Icon className="w-4 h-4" />
                })()}
              </div>
              <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.subWorkflow.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{NODE_TYPE_LABELS.subWorkflow.description}</div>
            </button>

            {/* END Step */}
            <button
              onClick={() => handleAddNode('end')}
              className="w-full text-left px-4 py-3 bg-white border-2 border-gray-200 rounded-xl hover:shadow-md hover:border-gray-300 transition-all cursor-pointer group relative"
            >
              <div className={`absolute top-2 right-2 ${NODE_TYPE_COLORS.end} opacity-60 group-hover:opacity-100 transition-opacity`}>
                {(() => {
                  const Icon = NODE_TYPE_ICONS.end
                  return <Icon className="w-4 h-4" />
                })()}
              </div>
              <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.end.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{NODE_TYPE_LABELS.end.description}</div>
            </button>
          </div>

            {/* Instructions */}
            <Alert variant="info" className="mt-6">
              <Info className="size-4" />
              <AlertTitle className="text-xs">How to use:</AlertTitle>
              <div className="mt-2">
                <ul className="text-xs space-y-1">
                  <li>• Click step types to add them</li>
                  <li>• Drag steps to position them</li>
                  <li>• Connect steps by dragging from handles</li>
                  <li>• Click steps/transitions to edit them</li>
                  <li>• Validate before saving</li>
                </ul>
              </div>
            </Alert>
          </div>
        </div>

        {/* Main Canvas */}
        <div className="flex-1 relative p-6 overflow-auto">
          <div className="h-full rounded-lg border bg-card">
            <WorkflowGraph
              initialNodes={nodes}
              initialEdges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onConnect={handleConnect}
              editable={true}
              height="100%"
            />
          </div>

          {/* Empty State */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  Start Building Your Workflow
                </h2>
                <p className="text-gray-600 mb-4">
                  Click a step type from the palette to add it to the canvas
                </p>
                <div className="text-sm text-gray-500">
                  or{' '}
                  <button
                    onClick={handleLoadExample}
                    className="text-blue-600 hover:underline pointer-events-auto"
                  >
                    load an example workflow
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PageBody>

      {/* Node Edit Dialog - Conditional rendering based on feature flag */}
      {process.env.NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED === 'true' ? (
        <NodeEditDialogCrudForm
          node={selectedNode}
          isOpen={showNodeDialog}
          onClose={() => setShowNodeDialog(false)}
          onSave={handleSaveNode}
          onDelete={handleDeleteNode}
        />
      ) : (
        <NodeEditDialog
          node={selectedNode}
          isOpen={showNodeDialog}
          onClose={() => setShowNodeDialog(false)}
          onSave={handleSaveNode}
          onDelete={handleDeleteNode}
        />
      )}

      {/* Edge Edit Dialog - Conditional rendering based on feature flag */}
      {process.env.NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED === 'true' ? (
        <EdgeEditDialogCrudForm
          edge={selectedEdge}
          isOpen={showEdgeDialog}
          onClose={() => setShowEdgeDialog(false)}
          onSave={handleSaveEdge}
          onDelete={handleDeleteEdge}
        />
      ) : (
        <EdgeEditDialog
          edge={selectedEdge}
          isOpen={showEdgeDialog}
          onClose={() => setShowEdgeDialog(false)}
          onSave={handleSaveEdge}
          onDelete={handleDeleteEdge}
        />
      )}

      {/* Clear Confirmation Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear Everything?</DialogTitle>
            <DialogDescription>
              This will clear all metadata and the workflow canvas. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearConfirm(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmClear}>
              {t('common.clear', 'Clear')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

// Helper functions
function getDefaultLabel(nodeType: string): string {
  const labels: Record<string, string> = {
    start: 'Start',
    end: 'End',
    userTask: 'New User Task',
    automated: 'New Automated Task',
    decision: 'Decision Point',
    waitForSignal: 'Wait for Signal',
  }
  return labels[nodeType] || 'New Step'
}

function getDefaultBadge(nodeType: string): string {
  const badges: Record<string, string> = {
    start: 'Start',
    end: 'End',
    userTask: 'User Task',
    automated: 'Automated',
    decision: 'Decision',
    waitForSignal: 'Wait for Signal',
  }
  return badges[nodeType] || 'Task'
}
