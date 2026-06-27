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
import { performDeleteEdgeFlow, performDeleteNodeFlow } from '../../../lib/visual-editor-delete-flow'
import { classifyConnection, applyInputMappingToNodes, buildDataMappingEdge } from '../../../lib/data-edge-mapping'
import { workflowDefinitionDataSchema, type WorkflowIoContract } from '../../../data/validators'
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
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { readJsonSafe } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { CircleQuestionMark, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, PanelTopClose, PanelTopOpen, Play, Save, Trash2 } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { usePersistedBooleanFlag } from '@open-mercato/ui/backend/crud/usePersistedBooleanFlag'
import { useSidebarCollapse } from '@open-mercato/ui/backend/AppShell'
import { NODE_TYPE_ICONS, NODE_TYPE_COLORS, NODE_TYPE_LABELS } from '../../../lib/node-type-icons'
import { DefinitionTriggersEditor } from '../../../components/DefinitionTriggersEditor'
import { MobileVisualEditor } from '../../../components/mobile/MobileVisualEditor'
import { useIsMobile } from '@open-mercato/ui/hooks/useIsMobile'
import type { WorkflowDefinitionTrigger } from '../../../data/entities'
import type { WorkflowMetadataState, WorkflowMetadataHandlers } from '../../../data/types'
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
/**
 * Resolve the declared IO port contracts of every sub-workflow referenced by a
 * definition, keyed by `subWorkflowId`, so SUB_WORKFLOW nodes can render the
 * child's IN/OUT ports. Fail-open: any lookup error leaves that child without a
 * contract and its node simply renders without ports.
 */
async function loadSubWorkflowContracts(
  definition: { steps?: Array<{ stepType?: string; config?: { subWorkflowId?: string } }> } | null | undefined,
): Promise<Map<string, WorkflowIoContract>> {
  const contracts = new Map<string, WorkflowIoContract>()
  const subWorkflowIds = Array.from(
    new Set(
      (definition?.steps || [])
        .filter((step) => step?.stepType === 'SUB_WORKFLOW' && step?.config?.subWorkflowId)
        .map((step) => step.config!.subWorkflowId as string),
    ),
  )
  await Promise.all(
    subWorkflowIds.map(async (workflowId) => {
      try {
        const res = await apiCall<{ data?: Array<{ definition?: { io?: WorkflowIoContract } }> }>(
          `/api/workflows/definitions?workflowId=${encodeURIComponent(workflowId)}&limit=1`,
        )
        const io = res.ok ? res.result?.data?.[0]?.definition?.io : undefined
        if (io) contracts.set(workflowId, io)
      } catch {
        // fail-open
      }
    }),
  )
  return contracts
}

const PALETTE_NODE_TYPES = ['start', 'userTask', 'automated', 'invokeAgent', 'waitForSignal', 'waitForTimer', 'subWorkflow', 'end'] as const

export default function VisualEditorPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const definitionId = searchParams.get('id')
  const isMobile = useIsMobile()

  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [isLoading, setIsLoading] = useState(!!definitionId)
  const [isSaving, setIsSaving] = useState(false)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [showMetadata, setShowMetadata] = useState(true)
  const [isCompactViewport, setIsCompactViewport] = useState(false)
  const { value: paletteCollapsed, toggle: togglePaletteCollapsed, setValue: setPaletteCollapsed } = usePersistedBooleanFlag('om:wf-editor-palette', false)
  const [showPaletteHowTo, setShowPaletteHowTo] = useState(false)
  const { value: focusMode, setValue: setFocusMode, toggle: toggleFocus } = usePersistedBooleanFlag('om:wf-editor-focus', false)
  const { requestCollapse, releaseRequest } = useSidebarCollapse()
  // Remember the palette/metadata state from before Focus mode took over so we
  // can restore exactly what the author had when they exit.
  const priorPaletteCollapsedRef = React.useRef<boolean | null>(null)
  const priorShowMetadataRef = React.useRef<boolean | null>(null)

  // Focus mode orchestrator: collapse the app sidebar + palette and hide the
  // metadata form when entering; restore the author's prior palette/metadata
  // state when leaving. Runs on mount too, so a persisted `focusMode === true`
  // applies the collapses immediately.
  useEffect(() => {
    if (focusMode) {
      if (priorPaletteCollapsedRef.current === null) priorPaletteCollapsedRef.current = paletteCollapsed
      if (priorShowMetadataRef.current === null) priorShowMetadataRef.current = showMetadata
      requestCollapse(true)
      setPaletteCollapsed(true)
      setShowMetadata(false)
    } else {
      releaseRequest()
      if (priorPaletteCollapsedRef.current !== null) {
        setPaletteCollapsed(priorPaletteCollapsedRef.current)
        priorPaletteCollapsedRef.current = null
      }
      if (priorShowMetadataRef.current !== null) {
        setShowMetadata(priorShowMetadataRef.current)
        priorShowMetadataRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode])

  // Always release the app-sidebar request when the editor unmounts so the
  // user's prior sidebar state is restored when they navigate away.
  useEffect(() => () => releaseRequest(), [releaseRequest])

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
  const [source, setSource] = useState<'code' | 'code_override' | 'user' | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  // Start-instance dialog state (mirrors the non-visual edit page UX)
  const [startOpen, setStartOpen] = useState(false)
  const [startContext, setStartContext] = useState('{}')
  const [starting, setStarting] = useState(false)

  // Keyboard shortcuts: `F` toggles Focus mode, `Esc` exits it. Suppressed while
  // the user is typing in a field or a dialog is open, so it never hijacks form
  // input or the dialog's own Escape-to-close.
  useEffect(() => {
    if (isMobile) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const active = document.activeElement as HTMLElement | null
      const tag = (active?.tagName || '').toLowerCase()
      const isEditing = tag === 'input' || tag === 'textarea' || tag === 'select' || !!active?.isContentEditable
      if (isEditing) return
      const isDialogOpen = showNodeDialog || showEdgeDialog || showClearConfirm || startOpen
      if (event.key === 'Escape') {
        if (focusMode && !isDialogOpen) {
          event.preventDefault()
          setFocusMode(false)
        }
        return
      }
      if (event.key === 'f' || event.key === 'F') {
        if (isDialogOpen) return
        event.preventDefault()
        toggleFocus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMobile, focusMode, showNodeDialog, showEdgeDialog, showClearConfirm, startOpen, toggleFocus, setFocusMode])

  const mutationContextId = `workflows.definitions.visual-editor:${definitionId ?? 'unknown'}`
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: mutationContextId,
  })

  const isCodeOnly = source === 'code'
  const isCodeOverride = source === 'code_override'

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

        // Resolve referenced sub-workflow port contracts so SUB_WORKFLOW nodes
        // render IN/OUT ports without opening the child (fail-open).
        const childContracts = await loadSubWorkflowContracts(definition.definition)

        // Convert definition to graph
        const graph = definitionToGraph(definition.definition, { childContracts })
        setNodes(graph.nodes)
        setEdges(graph.edges)

        // Load embedded triggers from definition
        setTriggers(definition.definition?.triggers || [])

        // Track source so the editor mirrors the non-visual edit page UX:
        // code → read-only with Customize button; code_override → editable
        // with Reset to code; user → editable, no banner.
        setSource((definition.source as 'code' | 'code_override' | 'user') ?? null)
        setUpdatedAt(typeof definition.updatedAt === 'string' ? definition.updatedAt : null)
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
    if (isCodeOnly) return
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [isCodeOnly])

  // Handle edge changes from ReactFlow
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (isCodeOnly) return
    setEdges((eds) => applyEdgeChanges(changes, eds))
  }, [isCodeOnly])

  // Handle adding new node from palette
  const handleAddNode = useCallback((nodeType: string) => {
    if (isCodeOnly) return
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
  }, [nodes.length, isCodeOnly])

  // Handle node selection - open edit dialog (suppressed in read-only mode
  // so users can't open the node editor on a code-defined workflow).
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (isCodeOnly) return
    setSelectedNode(node)
    setSelectedEdge(null)
    setShowNodeDialog(true)
  }, [isCodeOnly])

  // Handle edge selection - open edit dialog
  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    if (isCodeOnly) return
    setSelectedEdge(edge)
    setSelectedNode(null)
    setShowEdgeDialog(true)
  }, [isCodeOnly])

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
  const handleDeleteEdge = useCallback(async (edgeId: string) => {
    await performDeleteEdgeFlow(edgeId, {
      confirm,
      t,
      setShowEdgeDialog,
      setSelectedEdge,
      setEdges,
      notifyDeleted: () => flash('Transition deleted successfully', 'success'),
    })
  }, [confirm, t])

  // Delete node
  const handleDeleteNode = useCallback(async (nodeId: string) => {
    await performDeleteNodeFlow(nodeId, {
      nodes,
      confirm,
      t,
      setShowNodeDialog,
      setSelectedNode,
      setNodes,
      setEdges,
      notifyDeleted: () => flash('Step deleted successfully', 'success'),
    })
  }, [confirm, nodes, t])

  // Handle new connections. A drop onto a sub-workflow IN port authors a field
  // mapping (written to the target step's config.inputMapping + a distinct data
  // edge); a plain handle-to-handle connection stays a control-flow transition.
  const handleConnect = useCallback((connection: Connection) => {
    const classification = classifyConnection(connection)

    if (classification.kind === 'data-ignored') {
      return
    }

    if (classification.kind === 'data-mapping') {
      const { targetNodeId, childPortKey, parentPath } = classification
      setNodes((nds) => applyInputMappingToNodes(nds, targetNodeId, childPortKey, parentPath))
      const dataEdge = buildDataMappingEdge(connection, childPortKey)
      setEdges((eds) => addEdge(dataEdge, eds.filter((e) => e.id !== dataEdge.id)))
      return
    }

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
        // Update existing definition — send the full editable payload so metadata
        // edits (name, description, version, category, tags, icon, effective
        // dates) actually persist. Previously only `definition` + `enabled`
        // were sent, silently dropping every other field.
        result = await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(updatedAt),
          () => apiCall<{ data: any; error?: string }>(`/api/workflows/definitions/${definitionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workflowName,
              description: description || null,
              version,
              definition: definitionData,
              metadata: Object.keys(metadata).length > 0 ? metadata : null,
              enabled,
              effectiveFrom: effectiveFrom || null,
              effectiveTo: effectiveTo || null,
            }),
          }),
        )
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
        const conflictError = Object.assign(new Error(t('workflows.messages.saveFailed', 'Failed to save')), {
          status: result.status,
          ...(result.result && typeof result.result === 'object' ? result.result : {}),
        })
        if (!surfaceRecordConflict(conflictError, t)) {
          flash(`Failed to save: ${result.result?.error || 'Unknown error'}`, 'error')
        }
        return
      }

      const savedDefinition = result.result?.data

      flash(`Workflow ${isUpdate ? 'updated' : 'created'} successfully!`, 'success')

      // Stay on the visual editor after saving. On update, refresh the local
      // optimistic-lock token so the next save keeps working. On create, switch
      // the editor into edit mode by pointing the URL at the new id — the load
      // effect then re-syncs from the persisted definition without leaving the
      // canvas.
      if (isUpdate) {
        if (typeof savedDefinition?.updatedAt === 'string') {
          setUpdatedAt(savedDefinition.updatedAt)
        }
      } else if (savedDefinition?.id) {
        router.replace(`/backend/definitions/visual-editor?id=${encodeURIComponent(savedDefinition.id)}`)
      }

    } catch (error) {
      console.error('Error saving workflow definition:', error)
      flash('Failed to save workflow definition. Please try again.', 'error')
    } finally {
      setIsSaving(false)
    }
  }, [nodes, edges, workflowId, workflowName, description, version, enabled, category, tags, icon, effectiveFrom, effectiveTo, triggers, definitionId, updatedAt, router])

  // Customize a code-defined workflow → creates an override and reloads the
  // editor pointed at the new UUID. Mirrors the non-visual edit page button.
  const handleCustomize = useCallback(async () => {
    if (!definitionId) return
    setIsSaving(true)
    try {
      const result = await apiCall<{ data?: { id?: string }; error?: string }>(
        `/api/workflows/definitions/${definitionId}/customize`,
        { method: 'POST' },
      )
      if (!result.ok) {
        flash(result.result?.error || 'Failed to customize workflow', 'error')
        return
      }
      const newId = result.result?.data?.id
      if (!newId) return
      router.push(`/backend/definitions/visual-editor?id=${encodeURIComponent(newId)}`)
      router.refresh()
    } finally {
      setIsSaving(false)
    }
  }, [definitionId, router])

  // Reset a code-override back to its code definition. Mirrors the
  // non-visual edit page action, with the same confirm dialog.
  const handleResetToCode = useCallback(async () => {
    if (!definitionId) return
    const confirmed = await confirm({
      title: t('workflows.actions.resetToCode'),
      description: t('workflows.actions.resetConfirm'),
      confirmText: t('workflows.actions.resetToCode'),
      variant: 'destructive',
    })
    if (!confirmed) return

    setIsSaving(true)
    try {
      const result = await apiCall<{ data?: { id?: string }; error?: string }>(
        `/api/workflows/definitions/${definitionId}/reset-to-code`,
        { method: 'POST' },
      )
      if (!result.ok) {
        flash(result.result?.error || 'Failed to reset workflow', 'error')
        return
      }
      const codeId = result.result?.data?.id || (workflowId ? `code:${workflowId}` : null)
      if (!codeId) return
      router.push(`/backend/definitions/visual-editor?id=${encodeURIComponent(codeId)}`)
      router.refresh()
    } finally {
      setIsSaving(false)
    }
  }, [definitionId, workflowId, router, confirm, t])

  // Start a workflow instance with an initial JSON context, mirroring the
  // non-visual edit page. Requires a persisted definition (the executor
  // resolves the definition by workflowId + version).
  const handleStartInstance = useCallback(async () => {
    let initialContext: Record<string, unknown>
    try {
      const parsed = startContext.trim() ? JSON.parse(startContext) : {}
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('[internal] context must be a JSON object')
      }
      initialContext = parsed as Record<string, unknown>
    } catch {
      flash(t('workflows.startInstance.invalidJson'), 'error')
      return
    }
    setStarting(true)
    try {
      const result = await runMutation({
        operation: async () => {
          const response = await apiFetch('/api/workflows/instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workflowId,
              version,
              initialContext,
            }),
          })
          if (!response.ok) {
            const errorBody = await readJsonSafe<{ error?: string }>(response, null)
            throw new Error(errorBody?.error || t('workflows.startInstance.failed'))
          }
          return readJsonSafe<{ data?: { instance?: { id?: string } } }>(response, null)
        },
        mutationPayload: { resourceId: definitionId, operation: 'start-instance' },
        context: {
          formId: mutationContextId,
          resourceKind: 'workflows.instance',
          resourceId: definitionId,
          operation: 'start-instance',
          retryLastMutation,
        },
      })
      flash(t('workflows.startInstance.started'), 'success')
      setStartOpen(false)
      const instanceId = result?.data?.instance?.id
      if (instanceId) {
        router.push(`/backend/instances/${instanceId}`)
        router.refresh()
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : t('workflows.startInstance.failed'), 'error')
    } finally {
      setStarting(false)
    }
  }, [startContext, workflowId, version, definitionId, mutationContextId, retryLastMutation, router, t])

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

  const metadata: WorkflowMetadataState = {
    workflowId, workflowName, description, version,
    enabled, category, tags, icon,
    effectiveFrom, effectiveTo, triggers,
  }

  const metadataHandlers: WorkflowMetadataHandlers = {
    setWorkflowId, setWorkflowName, setDescription, setVersion,
    setEnabled, setCategory, setTags, setIcon,
    setEffectiveFrom, setEffectiveTo, setTriggers,
  }

  const sharedDialogs = (
    <>
      {process.env.NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED === 'true' ? (
        <NodeEditDialogCrudForm node={selectedNode} isOpen={showNodeDialog} onClose={() => setShowNodeDialog(false)} onSave={handleSaveNode} onDelete={handleDeleteNode} />
      ) : (
        <NodeEditDialog node={selectedNode} isOpen={showNodeDialog} onClose={() => setShowNodeDialog(false)} onSave={handleSaveNode} onDelete={handleDeleteNode} />
      )}
      {process.env.NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED === 'true' ? (
        <EdgeEditDialogCrudForm edge={selectedEdge} isOpen={showEdgeDialog} onClose={() => setShowEdgeDialog(false)} onSave={handleSaveEdge} onDelete={handleDeleteEdge} />
      ) : (
        <EdgeEditDialog edge={selectedEdge} isOpen={showEdgeDialog} onClose={() => setShowEdgeDialog(false)} onSave={handleSaveEdge} onDelete={handleDeleteEdge} />
      )}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('workflows.visualEditor.clearTitle')}</DialogTitle>
            <DialogDescription>{t('workflows.visualEditor.clearDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearConfirm(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button variant="destructive" onClick={confirmClear}>{t('common.clear', 'Clear')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workflows.startInstance.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 px-1 py-2">
            <p className="text-xs text-muted-foreground">{t('workflows.startInstance.description')}</p>
            <label className="text-sm font-medium">{t('workflows.startInstance.contextLabel')}</label>
            <Textarea
              value={startContext}
              onChange={(e) => setStartContext(e.target.value)}
              rows={10}
              spellCheck={false}
              className="font-mono text-sm"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void handleStartInstance()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartOpen(false)} disabled={starting}>
              {t('workflows.startInstance.cancel')}
            </Button>
            <Button onClick={() => void handleStartInstance()} disabled={starting}>
              {starting ? <Spinner className="h-4 w-4" /> : t('workflows.startInstance.start')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

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
          onStartInstance={() => setStartOpen(true)}
          onLoadExample={handleLoadExample}
          onClear={handleClear}
          metadata={metadata}
          metadataHandlers={metadataHandlers}
        />
        {sharedDialogs}
        {ConfirmDialogElement}
      </Page>
    )
  }

  return (
    <Page className="space-y-0 overflow-x-hidden">
      {/* Page Header */}
      <div className={`shrink-0 border-b border-border bg-background ${focusMode ? 'px-3 py-1.5 md:px-4' : 'px-3 py-2 md:px-6 md:py-3'}`}>
        <FormHeader
          mode="detail"
          backHref="/backend/definitions"
          backLabel={t('workflows.definitions.backToList', 'Back to definitions')}
          title={definitionId ? (workflowName || t('workflows.definitions.singular')) : t('workflows.backend.definitions.visual_editor.title')}
          subtitle={focusMode
            ? undefined
            : definitionId
              ? t('workflows.definitions.detail.summary', 'Editing workflow definition')
              : t('workflows.definitions.create.summary', 'Create and edit workflow definitions visually with a drag-and-drop interface')
          }
          actionsContent={
            <div className="flex flex-wrap items-center justify-end gap-1 md:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={toggleFocus}
                disabled={isSaving}
                className="h-8 px-2 text-xs"
                aria-label={focusMode ? t('workflows.visualEditor.exitFocusMode') : t('workflows.visualEditor.enterFocusMode')}
              >
                {focusMode ? <Minimize2 className="mr-1.5 h-4 w-4" /> : <Maximize2 className="mr-1.5 h-4 w-4" />}
                {focusMode ? t('workflows.visualEditor.exitFocusMode') : t('workflows.visualEditor.enterFocusMode')}
              </Button>
              {!focusMode && (
              <>
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
              {!isCodeOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadExample}
                  disabled={isSaving}
                  className="h-8 text-xs"
                >
                  {t('workflows.visualEditor.loadExample')}
                </Button>
              )}
              {!isCodeOnly && (
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
              )}
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
              {definitionId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStartOpen(true)}
                  disabled={isSaving}
                  className="h-8 text-xs"
                >
                  <Play className="mr-1.5 h-4 w-4" />
                  {t('workflows.actions.startInstance')}
                </Button>
              )}
              {isCodeOverride && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetToCode}
                  disabled={isSaving}
                  className="h-8 text-xs"
                >
                  {t('workflows.actions.resetToCode')}
                </Button>
              )}
              </>
              )}
              {isCodeOnly ? (
                <Button
                  size="sm"
                  onClick={handleCustomize}
                  disabled={isSaving}
                  className="h-8 px-2 text-xs md:px-3"
                >
                  {t('workflows.actions.customize')}
                </Button>
              ) : (
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
              )}
            </div>
          }
        />
      </div>

      {/* Source banner (code-defined / customized) */}
      {(isCodeOnly || isCodeOverride) && (
        <div className="shrink-0 border-b border-border bg-background px-3 py-2 md:px-6 md:py-3">
          {isCodeOnly && (
            <Alert variant="info">
              <AlertTitle>{t('workflows.source.code.readonlyBanner')}</AlertTitle>
            </Alert>
          )}
          {isCodeOverride && (
            <Alert variant="warning">
              <AlertTitle>{t('workflows.source.code_override.banner')}</AlertTitle>
            </Alert>
          )}
        </div>
      )}

      {/* Workflow Metadata Form */}
      {showMetadata && !focusMode && (
        <div className={isCompactViewport
          ? 'shrink-0 border-b border-border bg-background px-3 py-2 max-h-[60svh] overflow-y-auto overscroll-contain md:px-6 md:py-3'
          : 'shrink-0 border-b border-border bg-background px-3 py-2 md:px-6 md:py-3'
        }>
          <fieldset disabled={isCodeOnly} className="rounded-lg border bg-card p-3 disabled:opacity-70 md:p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">{t('workflows.visualEditor.workflowMetadata')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 md:gap-4">
              {/* Workflow ID */}
              <div className="min-w-0 space-y-1">
                <Label htmlFor="workflowId" className="text-xs">{t('workflows.form.workflowId')} *</Label>
                <Input
                  id="workflowId"
                  value={workflowId}
                  onChange={(e) => setWorkflowId(e.target.value)}
                  placeholder="checkout_workflow"
                  disabled={!!definitionId}
                  className="h-8 text-sm"
                />
                {definitionId && <p className="text-overline text-muted-foreground">{t('workflows.visualEditor.readOnly')}</p>}
              </div>

              {/* Workflow Name */}
              <div className="min-w-0 space-y-1">
                <Label htmlFor="workflowName" className="text-xs">{t('workflows.form.workflowName')} *</Label>
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
                <Label htmlFor="category" className="text-xs">{t('workflows.form.category')}</Label>
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
                <Label htmlFor="description" className="text-xs">{t('workflows.form.description')}</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('workflows.form.placeholders.description')}
                  rows={2}
                  className="min-h-[60px] text-sm"
                />
              </div>

              {/* Version */}
              <div className="min-w-0 space-y-1">
                <Label htmlFor="version" className="text-xs">{t('workflows.form.version')} *</Label>
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
                <Label className="text-xs">{t('common.enabled', 'Enabled')}</Label>
                <div className="flex h-8 items-center gap-2">
                  <Switch
                    id="enabled"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  />
                  <Label htmlFor="enabled" className="cursor-pointer text-xs font-normal">
                    {enabled ? t('common.on', 'On') : t('common.off', 'Off')}
                  </Label>
                </div>
              </div>

              {/* Tags */}
              <div className="min-w-0 space-y-1">
                <Label className="text-xs">{t('workflows.form.tags')}</Label>
                <TagsInput
                  value={tags}
                  onChange={setTags}
                  placeholder={t('workflows.form.placeholders.tags')}
                />
              </div>

              {/* Icon */}
              <div className="min-w-0 space-y-1">
                <Label htmlFor="icon" className="text-xs">{t('workflows.form.icon')}</Label>
                <Input
                  id="icon"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  placeholder="ShoppingCart"
                  className="h-8 text-sm"
                />
              </div>

              <div className="min-w-0 space-y-1">
                <Label htmlFor="effectiveFrom" className="text-xs">{t('workflows.form.effectiveFrom')}</Label>
                <Input
                  id="effectiveFrom"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              <div className="min-w-0 space-y-1">
                <Label htmlFor="effectiveTo" className="text-xs">{t('workflows.form.effectiveTo')}</Label>
                <Input
                  id="effectiveTo"
                  type="date"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </fieldset>

          {/* Event Triggers — also locked when the workflow is code-defined */}
          <fieldset disabled={isCodeOnly} className="mt-3 disabled:opacity-70">
            <DefinitionTriggersEditor
              value={triggers}
              onChange={setTriggers}
            />
          </fieldset>
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
                editable={!isCodeOnly}
                height="100%"
              />
            </div>

            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
                <div className="text-center">
                  <h2 className="mb-2 text-lg font-semibold text-foreground">{t('workflows.visualEditor.startBuilding')}</h2>
                  <p className="mb-4 text-sm text-muted-foreground">{t('workflows.visualEditor.tapToAddBelow')}</p>
                  <button
                    onClick={handleLoadExample}
                    className="pointer-events-auto text-sm text-primary hover:underline"
                  >
                    {t('workflows.visualEditor.loadExampleWorkflow')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {!isCodeOnly && (
            <div className="mt-3 rounded-lg border bg-card p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{t('workflows.visualEditor.stepPalette')}</h2>
              <p className="mb-3 text-xs text-muted-foreground">{t('workflows.visualEditor.tapToAdd')}</p>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {(['start', 'userTask', 'automated', 'invokeAgent', 'waitForSignal', 'waitForTimer', 'subWorkflow', 'end'] as const).map((nodeType) => {
                  const Icon = NODE_TYPE_ICONS[nodeType]
                  return (
                    <button
                      key={nodeType}
                      onClick={() => handleAddNode(nodeType)}
                      className="flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted active:bg-muted/50"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{NODE_TYPE_LABELS[nodeType].title}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-[72svh] min-w-0 flex-1 border-t border-border">
          {/* Left Sidebar - Step Palette rail (hidden in read-only mode) */}
          {!isCodeOnly && (
          <div className={`${paletteCollapsed ? 'w-14' : 'w-48'} shrink-0 overflow-y-auto border-r border-border bg-background p-2`}>
            <div className={`mb-2 flex items-center ${paletteCollapsed ? 'justify-center' : 'justify-between'}`}>
              {!paletteCollapsed && (
                <h2 className="px-1 text-xs font-semibold uppercase text-muted-foreground">{t('workflows.visualEditor.stepPalette')}</h2>
              )}
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={togglePaletteCollapsed}
                title={paletteCollapsed ? t('workflows.visualEditor.expandPalette') : t('workflows.visualEditor.collapsePalette')}
                aria-label={paletteCollapsed ? t('workflows.visualEditor.expandPalette') : t('workflows.visualEditor.collapsePalette')}
              >
                {paletteCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </IconButton>
            </div>

            {!paletteCollapsed && (
              <p className="mb-2 px-1 text-xs text-muted-foreground">{t('workflows.visualEditor.clickToAdd')}</p>
            )}

            <div className={`flex flex-col gap-1 ${paletteCollapsed ? 'items-center' : ''}`}>
              {PALETTE_NODE_TYPES.map((nodeType) => {
                const Icon = NODE_TYPE_ICONS[nodeType]
                const label = NODE_TYPE_LABELS[nodeType]
                const tooltip = `${label.title} — ${label.description}`
                if (paletteCollapsed) {
                  return (
                    <button
                      key={nodeType}
                      type="button"
                      onClick={() => handleAddNode(nodeType)}
                      title={tooltip}
                      aria-label={tooltip}
                      className="flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted"
                    >
                      <Icon className={`h-4 w-4 ${NODE_TYPE_COLORS[nodeType]}`} />
                    </button>
                  )
                }
                return (
                  <button
                    key={nodeType}
                    type="button"
                    onClick={() => handleAddNode(nodeType)}
                    title={label.description}
                    className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${NODE_TYPE_COLORS[nodeType]}`} />
                    <span className="truncate font-medium text-foreground">{label.title}</span>
                  </button>
                )
              })}
            </div>

            {!paletteCollapsed && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowPaletteHowTo((prev) => !prev)}
                  aria-expanded={showPaletteHowTo}
                  className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <CircleQuestionMark className="h-3.5 w-3.5" />
                  <span>{t('workflows.visualEditor.howToUse', 'How to use:')}</span>
                </button>
                {showPaletteHowTo && (
                  <Alert variant="info" className="mt-2">
                    <AlertTitle className="text-xs">{t('workflows.visualEditor.howToUse', 'How to use:')}</AlertTitle>
                    <div className="mt-2">
                      <ul className="list-inside list-disc space-y-1 text-xs">
                        <li>{t('workflows.visualEditor.hint.addSteps', 'Click step types to add them')}</li>
                        <li>{t('workflows.visualEditor.hint.dragSteps', 'Drag steps to position them')}</li>
                        <li>{t('workflows.visualEditor.hint.connectSteps', 'Connect steps by dragging from handles')}</li>
                        <li>{t('workflows.visualEditor.hint.editSteps', 'Click steps and transitions to edit them')}</li>
                        <li>{t('workflows.visualEditor.hint.validate', 'Validate before saving')}</li>
                      </ul>
                    </div>
                  </Alert>
                )}
              </div>
            )}
          </div>
          )}

          {/* Main Canvas */}
          <div className="min-w-0 flex-1 p-6">
            <div className="relative h-[72svh] min-h-[640px]">
              {focusMode && (
                <div className="absolute right-3 top-3 z-10">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFocusMode(false)}
                    className="h-8 px-2 text-xs shadow-sm"
                    aria-label={t('workflows.visualEditor.exitFocusMode')}
                  >
                    <Minimize2 className="mr-1.5 h-4 w-4" />
                    {t('workflows.visualEditor.exitFocusMode')}
                  </Button>
                </div>
              )}
              <div className="h-full rounded-lg border bg-card">
                <WorkflowGraph
                  initialNodes={nodes}
                  initialEdges={edges}
                  onNodesChange={handleNodesChange}
                  onEdgesChange={handleEdgesChange}
                  onNodeClick={handleNodeClick}
                  onEdgeClick={handleEdgeClick}
                  onConnect={handleConnect}
                  editable={!isCodeOnly}
                  height="100%"
                />
              </div>

              {/* Empty State */}
              {nodes.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
                  <div className="text-center">
                    <h2 className="mb-2 text-xl font-semibold text-foreground">
                      {t('workflows.visualEditor.startBuilding')}
                    </h2>
                    <p className="mb-4 text-muted-foreground">
                      {t('workflows.visualEditor.clickToAddFromPalette')}
                    </p>
                    <button
                      onClick={handleLoadExample}
                      className="pointer-events-auto text-sm text-primary hover:underline"
                    >
                      {t('workflows.visualEditor.loadExampleWorkflow')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {sharedDialogs}
      {ConfirmDialogElement}
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
    waitForTimer: 'Wait for Timer',
    invokeAgent: 'Invoke Agent',
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
    waitForTimer: 'Wait for Timer',
    invokeAgent: 'Invoke Agent',
  }
  return badges[nodeType] || 'Task'
}

