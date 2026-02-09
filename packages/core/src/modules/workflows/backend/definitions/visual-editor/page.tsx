'use client'

import { WorkflowGraph } from '../../../components/WorkflowGraph'
// Conditional imports based on feature flag
import { NodeEditDialog } from '../../../components/NodeEditDialog'
import { EdgeEditDialog } from '../../../components/EdgeEditDialog'
import { NodeEditDialogCrudForm } from '../../../components/NodeEditDialogCrudForm'
import { EdgeEditDialogCrudForm } from '../../../components/EdgeEditDialogCrudForm'
import { Node, Edge, addEdge, Connection, applyNodeChanges, applyEdgeChanges, NodeChange, EdgeChange } from '@xyflow/react'
import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { graphToDefinition, definitionToGraph, validateWorkflowGraph, generateStepId, generateTransitionId, ValidationError } from '../../../lib/graph-utils'
import { workflowDefinitionDataSchema } from '../../../data/validators'
import { Page } from '@open-mercato/ui/backend/Page'
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
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { CircleQuestionMark, Info, PanelTopClose, PanelTopOpen, Play, Save, Trash2 } from 'lucide-react'
import { NODE_TYPE_ICONS, NODE_TYPE_COLORS, NODE_TYPE_LABELS } from '../../../lib/node-type-icons'
import { DefinitionTriggersEditor } from '../../../components/DefinitionTriggersEditor'
import { MobileVisualEditor } from '../../../components/mobile/MobileVisualEditor'
import { useIsMobile } from '@open-mercato/ui/hooks/useIsMobile'
import type { WorkflowDefinitionTrigger } from '../../../data/entities'
import * as React from 'react'

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
  const isMobile = useIsMobile()

  const [isLoading, setIsLoading] = useState(!!definitionId)
  const [isSaving, setIsSaving] = useState(false)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [showMetadata, setShowMetadata] = useState(true)
  const [isCompactViewport, setIsCompactViewport] = useState(false)

  // Auto-collapse metadata on compact viewports after hydration
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(max-width: 1279px)')
    const applyViewportMode = () => {
      const compact = mediaQuery.matches
      setIsCompactViewport(compact)
      setShowMetadata(!compact)
    }

    applyViewportMode()
    mediaQuery.addEventListener('change', applyViewportMode)

    return () => {
      mediaQuery.removeEventListener('change', applyViewportMode)
    }
  }, [])
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
  const [triggers, setTriggers] = useState<WorkflowDefinitionTrigger[]>([])

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

        // Load embedded triggers from definition
        setTriggers(definition.definition?.triggers || [])

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

    // Generate definition data and include triggers
    const graphDefinition = graphToDefinition(nodes, edges, { includePositions: true })
    const definitionData = {
      ...graphDefinition,
      triggers: triggers.length > 0 ? triggers : undefined,
    }

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
  }, [nodes, edges, workflowId, workflowName, description, version, enabled, category, tags, triggers, definitionId, router])

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
    setTriggers([])
    setShowClearConfirm(false)
    flash('Canvas cleared', 'success')
  }, [])

  // Show loading spinner while loading definition
  if (isLoading) {
    return (
      <Page className="flex items-center justify-center min-h-[50vh]">
        <LoadingMessage label="Loading workflow definition..." />
      </Page>
    )
  }

  if (isMobile) {
    return (
      <Page className="flex h-[100svh] flex-col space-y-0 overflow-hidden">
        <MobileVisualEditor
          definitionId={definitionId}
          isSaving={isSaving}
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onConnect={handleConnect}
          onAddNode={handleAddNode}
          onSave={handleSave}
          onValidate={handleValidate}
          onTest={handleTest}
          onLoadExample={handleLoadExample}
          onClear={handleClear}
          workflowId={workflowId}
          setWorkflowId={setWorkflowId}
          workflowName={workflowName}
          setWorkflowName={setWorkflowName}
          description={description}
          setDescription={setDescription}
          version={version}
          setVersion={setVersion}
          enabled={enabled}
          setEnabled={setEnabled}
          category={category}
          setCategory={setCategory}
          tags={tags}
          setTags={setTags}
          icon={icon}
          setIcon={setIcon}
          effectiveFrom={effectiveFrom}
          setEffectiveFrom={setEffectiveFrom}
          effectiveTo={effectiveTo}
          setEffectiveTo={setEffectiveTo}
          triggers={triggers}
          setTriggers={setTriggers}
        />

        {/* Dialogs shared between mobile and desktop */}
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
        <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('workflows.visualEditor.clearTitle')}</DialogTitle>
              <DialogDescription>
                {t('workflows.visualEditor.clearDescription')}
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

  return (
    <Page className="space-y-0 overflow-x-hidden">
      {/* Page Header */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-2 md:px-6 md:py-3">
        <FormHeader
          mode="detail"
          backHref="/backend/definitions"
          backLabel={t('workflows.definitions.backToList', 'Back to definitions')}
          title={definitionId ? (workflowName || t('workflows.definitions.singular')) : t('workflows.backend.definitions.visual_editor.title')}
          subtitle={definitionId
            ? t('workflows.definitions.detail.summary', 'Editing workflow definition')
            : t('workflows.definitions.create.summary', 'Create and edit workflow definitions visually with a drag-and-drop interface')
          }
          actionsContent={
            <div className="flex flex-wrap items-center justify-end gap-1 md:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMetadata(!showMetadata)}
                disabled={isSaving}
                className="h-8 px-2 text-xs"
                aria-label={showMetadata ? t('workflows.visualEditor.hideMetadata') : t('workflows.visualEditor.showMetadata')}
              >
                {showMetadata ? <PanelTopClose className="mr-1.5 h-4 w-4" /> : <PanelTopOpen className="mr-1.5 h-4 w-4" />}
                {showMetadata ? t('workflows.visualEditor.hideMetadata') : t('workflows.visualEditor.showMetadata')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadExample}
                disabled={isSaving}
                className="h-8 text-xs"
              >
                {t('workflows.visualEditor.loadExample')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClear}
                disabled={isSaving}
                className="h-8 px-2 text-xs"
                aria-label={t('workflows.visualEditor.clear')}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                {t('workflows.visualEditor.clear')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleValidate}
                disabled={isSaving}
                className="h-8 px-2 text-xs"
                aria-label={t('workflows.visualEditor.validate')}
              >
                <CircleQuestionMark className="mr-1.5 h-4 w-4" />
                {t('workflows.visualEditor.validate')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={isSaving}
                className="h-8 text-xs"
              >
                <Play className="mr-1.5 h-4 w-4" />
                {t('workflows.visualEditor.runTest')}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="h-8 px-2 text-xs md:px-3"
                aria-label={isSaving ? t('workflows.mobile.saving') : definitionId ? t('workflows.common.update') : t('workflows.common.save')}
              >
                <Save className="mr-1.5 h-4 w-4" />
                {isSaving ? t('workflows.mobile.saving') : definitionId ? t('workflows.common.update') : t('workflows.common.save')}
              </Button>
            </div>
          }
        />
      </div>

      {/* Workflow Metadata Form */}
      {showMetadata && (
        <div className={isCompactViewport
          ? 'shrink-0 border-b border-gray-200 bg-white px-3 py-2 max-h-[60svh] overflow-y-auto overscroll-contain md:px-6 md:py-3'
          : 'shrink-0 border-b border-gray-200 bg-white px-3 py-2 md:px-6 md:py-3'
        }>
          <div className="rounded-lg border bg-card p-3 md:p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">{t('workflows.visualEditor.workflowMetadata')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 md:gap-4">
              {/* Workflow ID */}
              <div className="min-w-0 space-y-1">
                <Label htmlFor="workflowId" className="text-xs">Workflow ID *</Label>
                <Input
                  id="workflowId"
                  value={workflowId}
                  onChange={(e) => setWorkflowId(e.target.value)}
                  placeholder="checkout_workflow"
                  disabled={!!definitionId}
                  className="h-8 text-sm"
                />
                {definitionId && <p className="text-[10px] text-muted-foreground">Read-only</p>}
              </div>

              {/* Workflow Name */}
              <div className="min-w-0 space-y-1">
                <Label htmlFor="workflowName" className="text-xs">Name *</Label>
                <Input
                  id="workflowName"
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  placeholder="Checkout Process"
                  className="h-8 text-sm"
                />
              </div>

              {/* Category */}
              <div className="min-w-0 space-y-1">
                <Label htmlFor="category" className="text-xs">Category</Label>
                <Input
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="E-Commerce"
                  className="h-8 text-sm"
                />
              </div>

              {/* Description */}
              <div className="min-w-0 space-y-1 sm:col-span-2 lg:col-span-3">
                <Label htmlFor="description" className="text-xs">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the purpose of this workflow..."
                  rows={2}
                  className="min-h-[60px] text-sm"
                />
              </div>

              {/* Version */}
              <div className="min-w-0 space-y-1">
                <Label htmlFor="version" className="text-xs">Version *</Label>
                <Input
                  id="version"
                  type="number"
                  value={version}
                  onChange={(e) => setVersion(parseInt(e.target.value) || 1)}
                  min={1}
                  disabled={!!definitionId}
                  className="h-8 text-sm"
                />
              </div>

              {/* Enabled */}
              <div className="min-w-0 space-y-1">
                <Label className="text-xs">Enabled</Label>
                <div className="flex h-8 items-center gap-2">
                  <Switch
                    id="enabled"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  />
                  <Label htmlFor="enabled" className="cursor-pointer text-xs font-normal">
                    {enabled ? 'On' : 'Off'}
                  </Label>
                </div>
              </div>

              {/* Tags */}
              <div className="min-w-0 space-y-1">
                <Label className="text-xs">Tags</Label>
                <TagsInput
                  value={tags}
                  onChange={setTags}
                  placeholder={t('workflows.form.placeholders.tags')}
                />
              </div>

              {/* Icon */}
              <div className="min-w-0 space-y-1">
                <Label htmlFor="icon" className="text-xs">Icon</Label>
                <Input
                  id="icon"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  placeholder="ShoppingCart"
                  className="h-8 text-sm"
                />
              </div>

              <div className="min-w-0 space-y-1">
                <Label htmlFor="effectiveFrom" className="text-xs">Effective From</Label>
                <Input
                  id="effectiveFrom"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              <div className="min-w-0 space-y-1">
                <Label htmlFor="effectiveTo" className="text-xs">Effective To</Label>
                <Input
                  id="effectiveTo"
                  type="date"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Event Triggers */}
          <DefinitionTriggersEditor
            value={triggers}
            onChange={setTriggers}
            className="mt-3"
          />
        </div>
      )}

      {/* Main Content */}
      {isCompactViewport ? (
        <div className="px-3 py-3 md:px-6 md:py-4">
          <div className="relative min-w-0">
            <div className="h-[64svh] min-h-[360px] rounded-lg border bg-card">
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

            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
                <div className="text-center">
                  <h2 className="mb-2 text-lg font-semibold text-gray-900">Start Building Your Workflow</h2>
                  <p className="mb-4 text-sm text-gray-600">Tap a step type below to add it to the canvas</p>
                  <button
                    onClick={handleLoadExample}
                    className="pointer-events-auto text-sm text-blue-600 hover:underline"
                  >
                    Load an example workflow
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 rounded-lg border bg-card p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Step Palette</h2>
            <p className="mb-3 text-xs text-muted-foreground">Tap a step type to add it to the canvas</p>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {(['start', 'userTask', 'automated', 'waitForSignal', 'subWorkflow', 'end'] as const).map((nodeType) => {
                const Icon = NODE_TYPE_ICONS[nodeType]
                return (
                  <button
                    key={nodeType}
                    onClick={() => handleAddNode(nodeType)}
                    className="flex shrink-0 items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs hover:bg-gray-50 active:bg-gray-100"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{NODE_TYPE_LABELS[nodeType].title}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[72svh] min-w-0 flex-1 border-t border-gray-200">
          {/* Left Sidebar - Step Palette */}
          <div className="w-[24rem] shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-6">
            <div className="rounded-lg border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">Step Palette</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Click a step type to add it to the canvas
              </p>

              <div className="space-y-3">
                {/* START Step */}
                <button
                  onClick={() => handleAddNode('start')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-left transition-all hover:border-gray-300 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.start} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.start
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.start.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{NODE_TYPE_LABELS.start.description}</div>
                </button>

                {/* USER_TASK Step */}
                <button
                  onClick={() => handleAddNode('userTask')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-left transition-all hover:border-gray-300 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.userTask} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.userTask
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.userTask.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{NODE_TYPE_LABELS.userTask.description}</div>
                </button>

                {/* AUTOMATED Step */}
                <button
                  onClick={() => handleAddNode('automated')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-left transition-all hover:border-gray-300 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.automated} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.automated
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.automated.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{NODE_TYPE_LABELS.automated.description}</div>
                </button>

                {/* WAIT_FOR_SIGNAL Step */}
                <button
                  onClick={() => handleAddNode('waitForSignal')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-left transition-all hover:border-gray-300 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.waitForSignal} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.waitForSignal
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.waitForSignal.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{NODE_TYPE_LABELS.waitForSignal.description}</div>
                </button>

                {/* SUB_WORKFLOW Step */}
                <button
                  onClick={() => handleAddNode('subWorkflow')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-left transition-all hover:border-gray-300 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.subWorkflow} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.subWorkflow
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.subWorkflow.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{NODE_TYPE_LABELS.subWorkflow.description}</div>
                </button>

                {/* END Step */}
                <button
                  onClick={() => handleAddNode('end')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-left transition-all hover:border-gray-300 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.end} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.end
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-gray-900">{NODE_TYPE_LABELS.end.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{NODE_TYPE_LABELS.end.description}</div>
                </button>
              </div>

              {/* Instructions */}
              <Alert variant="info" className="mt-6">
                <Info className="size-4" />
                <AlertTitle className="text-xs">How to use:</AlertTitle>
                <div className="mt-2">
                  <ul className="list-inside list-disc space-y-1 text-xs">
                    <li>Click step types to add them</li>
                    <li>Drag steps to position them</li>
                    <li>Connect steps by dragging from handles</li>
                    <li>Click steps and transitions to edit them</li>
                    <li>Validate before saving</li>
                  </ul>
                </div>
              </Alert>
            </div>
          </div>

          {/* Main Canvas */}
          <div className="min-w-0 flex-1 p-6">
            <div className="relative h-[72svh] min-h-[640px]">
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
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
                  <div className="text-center">
                    <h2 className="mb-2 text-xl font-semibold text-gray-900">
                      Start Building Your Workflow
                    </h2>
                    <p className="mb-4 text-gray-600">
                      Click a step type from the palette to add it to the canvas
                    </p>
                    <button
                      onClick={handleLoadExample}
                      className="pointer-events-auto text-sm text-blue-600 hover:underline"
                    >
                      Load an example workflow
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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

