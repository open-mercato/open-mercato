'use client'

import { WorkflowGraph } from '../../../components/WorkflowGraph'
import { NodeEditDialog } from '../../../components/NodeEditDialog'
import { EdgeEditDialog } from '../../../components/EdgeEditDialog'
import { Node, Edge, addEdge, Connection, applyNodeChanges, applyEdgeChanges, NodeChange, EdgeChange } from '@xyflow/react'
import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { graphToDefinition, definitionToGraph, validateWorkflowGraph, generateStepId, generateTransitionId, ValidationError } from '../../../lib/graph-utils'
import { workflowDefinitionDataSchema } from '../../../data/validators'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { useT } from '@/lib/i18n/context'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { Info } from 'lucide-react'
import { NODE_TYPE_ICONS, NODE_TYPE_COLORS, NODE_TYPE_LABELS, NodeType } from '../../../lib/node-type-icons'

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
  const [flashMessages, setFlashMessages] = useState<Array<ValidationError & { id: string }>>([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [showMetadata, setShowMetadata] = useState(true)
  const [showNodeDialog, setShowNodeDialog] = useState(false)
  const [showEdgeDialog, setShowEdgeDialog] = useState(false)

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
        const response = await apiFetch(`/api/workflows/definitions/${definitionId}`)

        if (!response.ok) {
          const error = await response.json()
          setFlashMessages([{
            id: `error-load-${Date.now()}`,
            type: 'error',
            message: `Failed to load workflow: ${error.error || 'Unknown error'}`,
          }])
          setIsLoading(false)
          return
        }

        const result = await response.json()
        const definition = result.data

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

        setFlashMessages([{
          id: `success-load-${Date.now()}`,
          type: 'warning',
          message: '✅ Workflow loaded successfully',
        }])
      } catch (error) {
        console.error('Error loading workflow definition:', error)
        setFlashMessages([{
          id: `error-load-${Date.now()}`,
          type: 'error',
          message: 'Failed to load workflow definition',
        }])
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
    setFlashMessages([{
      id: `success-node-${Date.now()}`,
      type: 'warning',
      message: '✅ Node updated successfully',
    }])
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
    setFlashMessages([{
      id: `success-edge-${Date.now()}`,
      type: 'warning',
      message: '✅ Transition updated successfully',
    }])
  }, [])

  // Delete edge
  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((edge) => edge.id !== edgeId))
    setFlashMessages([{
      id: `success-delete-${Date.now()}`,
      type: 'warning',
      message: '✅ Transition deleted successfully',
    }])
  }, [])

  // Delete node
  const handleDeleteNode = useCallback((nodeId: string) => {
    // Remove the node
    setNodes((nds) => nds.filter((node) => node.id !== nodeId))

    // Remove all edges connected to this node
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))

    setFlashMessages([{
      id: `success-delete-${Date.now()}`,
      type: 'warning',
      message: '✅ Step deleted successfully',
    }])
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

  // Dismiss a flash message
  const dismissMessage = useCallback((id: string) => {
    setFlashMessages((msgs) => msgs.filter((msg) => msg.id !== id))
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

    // Clear existing messages
    setFlashMessages([])

    if (allErrors.length === 0) {
      // Show success message
      setFlashMessages([{
        id: `success-${Date.now()}`,
        type: 'warning', // Use warning type for success styling
        message: '✅ Validation passed! Your workflow is valid and ready to save.',
      }])
    } else {
      // Show error/warning messages
      const messages = allErrors.map((error, index) => ({
        ...error,
        id: `${error.type}-${index}-${Date.now()}`,
      }))
      setFlashMessages(messages)
    }
  }, [nodes, edges])

  // Save workflow definition
  const handleSave = useCallback(async () => {
    // Validate required fields
    if (!workflowId || !workflowName) {
      setFlashMessages([{
        id: `error-save-${Date.now()}`,
        type: 'error',
        message: 'Workflow ID and Name are required fields',
      }])
      return
    }

    // Validate workflow structure
    const errors = validateWorkflowGraph(nodes, edges)
    const criticalErrors = errors.filter(e => e.type === 'error')
    if (criticalErrors.length > 0) {
      setFlashMessages([{
        id: `error-save-${Date.now()}`,
        type: 'error',
        message: `Cannot save: ${criticalErrors.length} validation error(s) found. Please fix them first.`,
      }])
      return
    }

    // Generate definition data
    const definitionData = graphToDefinition(nodes, edges, { includePositions: true })

    // Run Zod schema validation before saving
    const schemaResult = workflowDefinitionDataSchema.safeParse(definitionData)
    if (!schemaResult.success) {
      const schemaErrors = schemaResult.error.issues.map((issue) => ({
        id: `schema-error-${Date.now()}-${Math.random()}`,
        type: 'error' as const,
        message: `Schema error: ${issue.path.join('.')} - ${issue.message}`,
      }))
      setFlashMessages(schemaErrors)
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

      let response
      if (isUpdate) {
        // Update existing definition
        response = await apiFetch(`/api/workflows/definitions/${definitionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            definition: definitionData,
            enabled,
          }),
        })
      } else {
        // Create new definition
        response = await apiFetch('/api/workflows/definitions', {
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

      if (!response.ok) {
        const error = await response.json()
        setFlashMessages([{
          id: `error-save-${Date.now()}`,
          type: 'error',
          message: `Failed to save: ${error.error || 'Unknown error'}`,
        }])
        return
      }

      const result = await response.json()
      const savedDefinition = result.data

      setFlashMessages([{
        id: `success-save-${Date.now()}`,
        type: 'warning',
        message: `✅ Workflow ${isUpdate ? 'updated' : 'created'} successfully!`,
      }])

      // Redirect to definition detail page after short delay
      setTimeout(() => {
        router.push(`/backend/definitions/${savedDefinition.id}`)
      }, 1500)

    } catch (error) {
      console.error('Error saving workflow definition:', error)
      setFlashMessages([{
        id: `error-save-${Date.now()}`,
        type: 'error',
        message: 'Failed to save workflow definition. Please try again.',
      }])
    } finally {
      setIsSaving(false)
    }
  }, [nodes, edges, workflowId, workflowName, description, version, enabled, category, tags, definitionId, router])

  // Test workflow
  const handleTest = useCallback(() => {
    // First validate
    const errors = validateWorkflowGraph(nodes, edges)
    if (errors.some((e) => e.type === 'error')) {
      const messages = errors.map((error, index) => ({
        ...error,
        id: `${error.type}-${index}-${Date.now()}`,
      }))
      setFlashMessages(messages)
      return
    }

    // TODO: Implement test logic (create instance, run first step)
    setFlashMessages([{
      id: `info-test-${Date.now()}`,
      type: 'warning',
      message: 'ℹ️ Test functionality will be implemented next',
    }])
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
    setFlashMessages([{
      id: `success-example-${Date.now()}`,
      type: 'warning',
      message: '✅ Example workflow loaded',
    }])
  }, [])

  // Clear canvas
  const handleClear = useCallback(() => {
    if (nodes.length > 0 || edges.length > 0 || workflowId || workflowName) {
      if (confirm('Are you sure you want to clear everything (metadata and canvas)?')) {
        setNodes([])
        setEdges([])
        setFlashMessages([])
        setWorkflowId('')
        setWorkflowName('')
        setDescription('')
        setVersion(1)
        setEnabled(true)
        setCategory('')
        setTags([])
      }
    }
  }, [nodes.length, edges.length, workflowId, workflowName])

  // Show loading spinner while loading definition
  if (isLoading) {
    return (
      <Page className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading workflow definition...</p>
        </div>
      </Page>
    )
  }

  return (
    <Page className="h-screen flex flex-col">
      {/* Page Header */}
      <PageHeader
        title={definitionId ? `Edit: ${workflowName || 'Workflow'}` : t('workflows.backend.definitions.visual_editor.title')}
        description={definitionId ? `Editing workflow definition (ID: ${definitionId})` : "Create and edit workflow definitions visually with a drag-and-drop interface"}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMetadata(!showMetadata)}
              disabled={isSaving}
            >
              {showMetadata ? 'Hide' : 'Show'} Metadata
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadExample}
              disabled={isSaving}
            >
              Load Example
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={isSaving}
            >
              Clear
            </Button>
            <div className="w-px h-6 bg-gray-300"></div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleValidate}
              disabled={isSaving}
            >
              Validate
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={isSaving}
            >
              Test
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : (definitionId ? 'Update' : 'Save')}
            </Button>
          </div>
        }
      />

      {/* Workflow Metadata Form */}
      {showMetadata && (
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Workflow Metadata</h2>
          <div className="grid grid-cols-3 gap-4">
            {/* Workflow ID */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Workflow ID *
              </label>
              <input
                type="text"
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
                placeholder="checkout_workflow"
                disabled={!!definitionId}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                {definitionId ? 'Cannot be changed when editing' : 'Lowercase, numbers, hyphens, underscores'}
              </p>
            </div>

            {/* Workflow Name */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Workflow Name *
              </label>
              <input
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder="Checkout Process"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Category
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="E-Commerce"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Description */}
            <div className="col-span-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the purpose of this workflow..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Version */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Version *
              </label>
              <input
                type="number"
                value={version}
                onChange={(e) => setVersion(parseInt(e.target.value) || 1)}
                min="1"
                disabled={!!definitionId}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                Version number (increment for major changes)
              </p>
            </div>

            {/* Enabled */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Enabled
              </label>
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Only enabled workflows can be started</span>
              </label>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Tags
              </label>
              <TagsInput
                value={tags}
                onChange={setTags}
                placeholder={t('workflows.form.placeholders.tags')}
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('workflows.form.descriptions.tags')}
              </p>
            </div>

            {/* Icon */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Icon
              </label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="ShoppingCart"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Icon name for visual identification
              </p>
            </div>

            {/* Effective From */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Effective From
              </label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Workflow becomes active from this date
              </p>
            </div>

            {/* Effective To */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Effective To
              </label>
              <input
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Workflow deactivates after this date
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content: Sidebar + Canvas */}
      <PageBody className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Step Palette */}
        <div className="w-64 bg-white border-r border-gray-200 p-6 overflow-y-auto">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Step Palette</h2>
          <p className="text-xs text-gray-600 mb-6">
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
          <Alert variant="info" className="mt-8">
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

        {/* Main Canvas */}
        <div className="flex-1 relative">
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

      {/* Flash Messages - positioned at top-right */}
      {flashMessages.length > 0 && (
        <div className="fixed top-24 right-6 z-50 space-y-3 max-w-md">
          {flashMessages.map((message) => {
            // Determine styling based on message content
            const isSuccess = message.message.includes('✅')
            const isInfo = message.message.includes('ℹ️')
            const isError = message.type === 'error'

            return (
              <div
                key={message.id}
                className={`flex items-start gap-3 p-4 rounded-lg shadow-lg border-l-4 animate-slide-in ${
                  isSuccess
                    ? 'bg-emerald-50 border-l-emerald-500 border border-emerald-200'
                    : isInfo
                    ? 'bg-blue-50 border-l-blue-500 border border-blue-200'
                    : isError
                    ? 'bg-red-50 border-l-red-500 border border-red-200'
                    : 'bg-yellow-50 border-l-yellow-500 border border-yellow-200'
                }`}
              >
                <div className="flex-1">
                  <p
                    className={`text-sm font-medium ${
                      isSuccess
                        ? 'text-emerald-900'
                        : isInfo
                        ? 'text-blue-900'
                        : isError
                        ? 'text-red-900'
                        : 'text-yellow-900'
                    }`}
                  >
                    {message.message}
                  </p>
                  {message.nodeId && (
                    <p className="text-xs text-gray-600 mt-1">
                      Step: <code className="bg-gray-100 px-1 rounded">{message.nodeId}</code>
                    </p>
                  )}
                  {message.edgeId && (
                    <p className="text-xs text-gray-600 mt-1">
                      Transition: <code className="bg-gray-100 px-1 rounded">{message.edgeId}</code>
                    </p>
                  )}
                </div>
                <button
                  onClick={() => dismissMessage(message.id)}
                  className={`flex-shrink-0 ${
                    isSuccess
                      ? 'text-emerald-400 hover:text-emerald-600'
                      : isInfo
                      ? 'text-blue-400 hover:text-blue-600'
                      : isError
                      ? 'text-red-400 hover:text-red-600'
                      : 'text-yellow-400 hover:text-yellow-600'
                  }`}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Node Edit Dialog */}
      <NodeEditDialog
        node={selectedNode}
        isOpen={showNodeDialog}
        onClose={() => setShowNodeDialog(false)}
        onSave={handleSaveNode}
        onDelete={handleDeleteNode}
      />

      {/* Edge Edit Dialog */}
      <EdgeEditDialog
        edge={selectedEdge}
        isOpen={showEdgeDialog}
        onClose={() => setShowEdgeDialog(false)}
        onSave={handleSaveEdge}
        onDelete={handleDeleteEdge}
      />
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
  }
  return badges[nodeType] || 'Task'
}
