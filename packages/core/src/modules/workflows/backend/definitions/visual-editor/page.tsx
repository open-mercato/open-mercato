'use client'

import { WorkflowGraph } from '../../../components/WorkflowGraph'
// Conditional imports based on feature flag
import { NodeEditDialog } from '../../../components/NodeEditDialog'
import { EdgeEditDialog } from '../../../components/EdgeEditDialog'
import { NodeEditDialogCrudForm } from '../../../components/NodeEditDialogCrudForm'
import { EdgeEditDialogCrudForm } from '../../../components/EdgeEditDialogCrudForm'
import type { Node, Edge, Connection } from '@xyflow/react'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { graphToDefinition, definitionToGraph, validateWorkflowGraph, generateStepId, generateTransitionId, appendWorkflowEdge } from '../../../lib/graph-utils'
import { collectValidationIssues, countIssuesBySeverity, type WorkflowValidationIssue, type ZodIssueLike } from '../../../lib/collect-validation-issues'
import { formatWorkflowValidationError } from '../../../lib/format-validation-error'
import type { WorkflowGraphFocusTarget } from '../../../components/WorkflowGraph'
import { performDeleteEdgeFlow, performDeleteNodeFlow } from '../../../lib/visual-editor-delete-flow'
import { resolveCrudFormDialogsEnabled } from '../../../lib/crud-form-dialogs-flag'
import { decideDraftRestore, isServerDraftEligible, stableSerializeDefinition } from '../../../lib/draft-restore'
import { workflowDefinitionDataSchema } from '../../../data/validators'
import { collectActivityConfigWarnings } from '../../../data/activity-config-warnings'
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
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { buildRecordInjectionContext, useSetCurrentRecordInjectionContext } from '@open-mercato/ui/backend/injection/recordContext'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ChevronDown, ChevronRight, CircleAlert, CircleQuestionMark, PanelTopClose, PanelTopOpen, Play, Save, Trash2, TriangleAlert, X } from 'lucide-react'
import { NODE_TYPE_ICONS, NODE_TYPE_COLORS, NODE_TYPE_LABELS } from '../../../lib/node-type-icons'
import { DefinitionTriggersEditor } from '../../../components/DefinitionTriggersEditor'
import { TemplateGalleryDialog, type WorkflowTemplateGalleryItem } from '../../../components/TemplateGalleryDialog'
import { MobileVisualEditor } from '../../../components/mobile/MobileVisualEditor'
import { useIsMobile } from '@open-mercato/ui/hooks/useIsMobile'
import type { WorkflowDefinitionTrigger } from '../../../data/entities'
import type { WorkflowMetadataState, WorkflowMetadataHandlers } from '../../../data/types'
import * as React from 'react'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

type WorkflowDraftMetadata = { category?: string; tags?: string[]; icon?: string }

type WorkflowDefinitionDraftPayload = {
  definition: Record<string, unknown>
  metadata?: WorkflowDraftMetadata | null
  baseUpdatedAt: string | null
  updatedAt: string | null
}

const DRAFT_AUTOSAVE_DEBOUNCE_MS = 2000
const DRAFT_SAVED_LABEL_REFRESH_MS = 30000

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
  const pathname = usePathname()
  const definitionId = searchParams.get('id')
  const templateId = searchParams.get('template')
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
  const [showTemplateGallery, setShowTemplateGallery] = useState(false)
  const [problems, setProblems] = useState<WorkflowValidationIssue[]>([])
  const [showProblems, setShowProblems] = useState(false)
  const [problemsCollapsed, setProblemsCollapsed] = useState(false)
  const [focusTarget, setFocusTarget] = useState<WorkflowGraphFocusTarget | null>(null)
  const focusRequestRef = React.useRef(0)

  // Error-severity issue counts per node id — drives the per-node error badges
  // on the canvas; clearing the problems list clears every badge.
  const nodeErrorCounts = React.useMemo(() => {
    const counts: Record<string, number> = {}
    for (const issue of problems) {
      if (issue.severity !== 'error' || !issue.nodeId) continue
      counts[issue.nodeId] = (counts[issue.nodeId] ?? 0) + 1
    }
    return counts
  }, [problems])

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

  const isCodeOnly = source === 'code'
  const isCodeOverride = source === 'code_override'

  // Per-user draft layer (spec §4.7): drafts persist server-side only for
  // SAVED definitions (uuid ids). Unsaved/new definitions and code-defined
  // workflows keep their state client-side only — no persistence at all.
  // Draft saves deliberately never participate in the definition's optimistic
  // lock; only the explicit Save PUT sends the lock header.
  const draftEligible = isServerDraftEligible(definitionId) && !isCodeOnly
  const [pendingDraft, setPendingDraft] = useState<{ draft: WorkflowDefinitionDraftPayload; baseMismatch: boolean } | null>(null)
  const [draftAutosaveReady, setDraftAutosaveReady] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [draftSaveFailed, setDraftSaveFailed] = useState(false)
  const [draftClock, setDraftClock] = useState(0)
  const lastPersistedDraftRef = useRef<string | null>(null)
  const draftSuspendedRef = useRef(false)

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
        const loadedTriggers = definition.definition?.triggers || []
        setTriggers(loadedTriggers)

        // Track source so the editor mirrors the non-visual edit page UX:
        // code → read-only with Customize button; code_override → editable
        // with Reset to code; user → editable, no banner.
        const loadedSource = (definition.source as 'code' | 'code_override' | 'user') ?? null
        setSource(loadedSource)
        const loadedUpdatedAt = typeof definition.updatedAt === 'string' ? definition.updatedAt : null
        setUpdatedAt(loadedUpdatedAt)

        // Draft layer: compare against the ROUND-TRIPPED definition (graph →
        // definition with the same normalization the autosave uses) so a mere
        // load/serialize drift never looks like an unsaved draft.
        const comparableDefinition = {
          ...graphToDefinition(graph.nodes, graph.edges, { includePositions: true }),
          triggers: loadedTriggers.length > 0 ? loadedTriggers : undefined,
        }
        const loadedDraftMetadata: WorkflowDraftMetadata = {}
        if (definition.metadata?.category) loadedDraftMetadata.category = definition.metadata.category
        if (Array.isArray(definition.metadata?.tags) && definition.metadata.tags.length > 0) loadedDraftMetadata.tags = definition.metadata.tags
        if (definition.metadata?.icon) loadedDraftMetadata.icon = definition.metadata.icon
        lastPersistedDraftRef.current = stableSerializeDefinition({
          definition: comparableDefinition,
          metadata: Object.keys(loadedDraftMetadata).length > 0 ? loadedDraftMetadata : null,
        })

        if (loadedSource !== 'code' && isServerDraftEligible(definitionId)) {
          const draftResult = await apiCall<{ data?: WorkflowDefinitionDraftPayload; error?: string }>(
            `/api/workflows/definitions/${definitionId}/draft`,
          )
          const draft = draftResult.ok ? draftResult.result?.data : undefined
          const decision = draft
            ? decideDraftRestore({
                draftDefinition: draft.definition,
                draftBaseUpdatedAt: draft.baseUpdatedAt,
                loadedDefinition: comparableDefinition,
                definitionUpdatedAt: loadedUpdatedAt,
              })
            : { offerRestore: false as const }
          if (draft && decision.offerRestore) {
            // Hold autosave until the user restores or discards, so editing
            // with the banner open can never silently overwrite the draft.
            setPendingDraft({ draft, baseMismatch: decision.baseMismatch })
          } else {
            setDraftAutosaveReady(true)
          }
        }
      } catch (error) {
        logger.error('Error loading workflow definition', { err: error })
        flash('Failed to load workflow definition', 'error')
      } finally {
        setIsLoading(false)
      }
    }

    loadDefinition()
  }, [definitionId])

  const draftMetadata = useMemo(() => {
    const metadata: WorkflowDraftMetadata = {}
    if (category) metadata.category = category
    if (tags.length > 0) metadata.tags = tags
    if (icon) metadata.icon = icon
    return metadata
  }, [category, tags, icon])

  // Debounced autosave-to-draft (~2s): watches the same editor-state dep set
  // the save handler uses and PUTs the per-user draft. Never fires for
  // unsaved/new or code-defined definitions, and failures stay quiet — the
  // small indicator flips to "draft not saved" and the next change retries.
  useEffect(() => {
    if (!draftAutosaveReady || !draftEligible || !definitionId) return
    if (draftSuspendedRef.current) return
    let payload: { definition: Record<string, unknown>; metadata: WorkflowDraftMetadata | null; baseUpdatedAt: string | null }
    try {
      payload = {
        definition: {
          ...graphToDefinition(nodes, edges, { includePositions: true }),
          triggers: triggers.length > 0 ? triggers : undefined,
        },
        metadata: Object.keys(draftMetadata).length > 0 ? draftMetadata : null,
        baseUpdatedAt: updatedAt,
      }
    } catch {
      return
    }
    const serialized = stableSerializeDefinition({ definition: payload.definition, metadata: payload.metadata })
    if (serialized === lastPersistedDraftRef.current) return
    const timer = window.setTimeout(async () => {
      if (draftSuspendedRef.current) return
      try {
        const result = await apiCall<{ data?: WorkflowDefinitionDraftPayload; error?: string }>(
          `/api/workflows/definitions/${definitionId}/draft`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        )
        if (result.ok) {
          lastPersistedDraftRef.current = serialized
          setDraftSavedAt(new Date().toISOString())
          setDraftSaveFailed(false)
        } else {
          setDraftSaveFailed(true)
        }
      } catch {
        setDraftSaveFailed(true)
      }
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draftAutosaveReady, draftEligible, definitionId, nodes, edges, triggers, draftMetadata, updatedAt, workflowName, description, version, enabled, effectiveFrom, effectiveTo])

  // Keep the "Draft saved Xs ago" label fresh without re-rendering per second.
  useEffect(() => {
    if (!draftSavedAt) return
    const interval = window.setInterval(() => setDraftClock((tick) => tick + 1), DRAFT_SAVED_LABEL_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [draftSavedAt])

  const draftSavedLabel = useMemo(() => {
    if (!draftSavedAt) return null
    return formatRelativeTime(draftSavedAt, { translate: t })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSavedAt, draftClock, t])

  const handleRestoreDraft = useCallback(() => {
    if (!pendingDraft) return
    try {
      const draftDefinition = pendingDraft.draft.definition as unknown as Parameters<typeof definitionToGraph>[0]
      const graph = definitionToGraph(draftDefinition)
      setNodes(graph.nodes)
      setEdges(graph.edges)
      const draftTriggers = pendingDraft.draft.definition.triggers
      setTriggers(Array.isArray(draftTriggers) ? (draftTriggers as WorkflowDefinitionTrigger[]) : [])
      if (pendingDraft.draft.metadata) {
        setCategory(pendingDraft.draft.metadata.category || '')
        setTags(pendingDraft.draft.metadata.tags || [])
        setIcon(pendingDraft.draft.metadata.icon || '')
      }
      lastPersistedDraftRef.current = stableSerializeDefinition({
        definition: pendingDraft.draft.definition,
        metadata: pendingDraft.draft.metadata ?? null,
      })
      flash(t('workflows.visualEditor.draft.restored', 'Draft restored'), 'success')
    } catch (error) {
      logger.error('Error restoring workflow definition draft', { err: error })
      flash(t('workflows.visualEditor.draft.restoreFailed', 'Failed to restore draft'), 'error')
    } finally {
      setPendingDraft(null)
      setDraftAutosaveReady(true)
    }
  }, [pendingDraft, t])

  const handleDiscardDraft = useCallback(async () => {
    setPendingDraft(null)
    setDraftAutosaveReady(true)
    if (!definitionId) return
    try {
      await apiCall(`/api/workflows/definitions/${definitionId}/draft`, { method: 'DELETE' })
    } catch (error) {
      logger.error('Error discarding workflow definition draft', { err: error })
    }
  }, [definitionId])

  // Handle node changes from ReactFlow. The lazy graph applies React Flow's
  // change reducers internally (#3169) and hands back the resolved nodes, so
  // this page never imports the @xyflow/react runtime.
  const handleNodesChange = useCallback((nextNodes: Node[]) => {
    if (isCodeOnly) return
    setNodes(nextNodes)
  }, [isCodeOnly])

  // Handle edge changes from ReactFlow (resolved edges from the lazy graph).
  const handleEdgesChange = useCallback((nextEdges: Edge[]) => {
    if (isCodeOnly) return
    setEdges(nextEdges)
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

    setEdges((eds) => appendWorkflowEdge(eds, newEdge))
  }, [])

  // Validate workflow — collect every graph and schema issue into the problems panel
  const handleValidate = useCallback(() => {
    const graphErrors = validateWorkflowGraph(nodes, edges)
    let zodIssues: ZodIssueLike[] = []
    let configWarnings: ZodIssueLike[] = []
    let schemaFailureMessage: string | null = null

    try {
      const definitionData = graphToDefinition(nodes, edges, { includePositions: true })
      const result = workflowDefinitionDataSchema.safeParse(definitionData)
      if (!result.success) {
        zodIssues = result.error.issues
      }
      configWarnings = collectActivityConfigWarnings(definitionData)
    } catch (error) {
      schemaFailureMessage = error instanceof Error ? error.message : String(error)
    }

    const issues = collectValidationIssues({ graphErrors, zodIssues, configWarnings, nodes, edges })
    if (schemaFailureMessage) {
      issues.unshift({
        id: 'schema-exception',
        severity: 'error',
        message: t('workflows.visualEditor.problems.schemaValidationFailed', 'Schema validation failed: {message}', { message: schemaFailureMessage }),
      })
    }
    setProblems(issues)

    if (issues.length === 0) {
      setShowProblems(false)
      flash(t('workflows.visualEditor.problems.validationPassed', 'Validation passed! Your workflow is valid and ready to save.'), 'success')
    } else {
      setShowProblems(true)
      setProblemsCollapsed(false)
      const { errors, warnings } = countIssuesBySeverity(issues)
      flash(
        t('workflows.visualEditor.problems.summary', 'Validation found {errors} error(s) and {warnings} warning(s).', { errors, warnings }),
        errors > 0 ? 'error' : 'warning',
      )
    }
  }, [nodes, edges, t])

  // Focus the offending node or edge on the canvas when a problem row is clicked
  const handleProblemClick = useCallback((issue: WorkflowValidationIssue) => {
    if (!issue.nodeId && !issue.edgeId) return
    focusRequestRef.current += 1
    setFocusTarget({
      ...(issue.nodeId ? { nodeId: issue.nodeId } : { edgeId: issue.edgeId }),
      requestId: focusRequestRef.current,
    })
  }, [])

  // Save workflow definition
  const handleSave = useCallback(async () => {
    // Validate required fields
    if (!workflowId || !workflowName) {
      flash('Workflow ID and Name are required fields', 'error')
      return
    }

    // Validate workflow structure and schema, surfacing every issue in the problems panel
    const graphErrors = validateWorkflowGraph(nodes, edges)

    // Generate definition data and include triggers
    const graphDefinition = graphToDefinition(nodes, edges, { includePositions: true })
    const definitionData = {
      ...graphDefinition,
      triggers: triggers.length > 0 ? triggers : undefined,
    }

    const schemaResult = workflowDefinitionDataSchema.safeParse(definitionData)
    const issues = collectValidationIssues({
      graphErrors,
      zodIssues: schemaResult.success ? [] : schemaResult.error.issues,
      configWarnings: collectActivityConfigWarnings(definitionData),
      nodes,
      edges,
    })
    setProblems(issues)
    const { errors } = countIssuesBySeverity(issues)
    if (errors > 0) {
      setShowProblems(true)
      setProblemsCollapsed(false)
      flash(t('workflows.visualEditor.problems.saveBlocked', 'Cannot save: {count} validation error(s) found. Please fix them first.', { count: errors }), 'error')
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
          flash(formatWorkflowValidationError(result.result, t('workflows.messages.saveFailed', 'Failed to save')), 'error')
        }
        return
      }

      const savedDefinition = result.result?.data

      // Explicit Save promoted the working copy: drop the per-user draft
      // (fire-and-forget) and suspend autosave so a pending debounce can't
      // recreate it before the redirect.
      draftSuspendedRef.current = true
      setPendingDraft(null)
      setDraftSavedAt(null)
      setDraftSaveFailed(false)
      if (isUpdate && isServerDraftEligible(definitionId)) {
        void apiCall(`/api/workflows/definitions/${definitionId}/draft`, { method: 'DELETE' }).catch(() => undefined)
      }

      flash(
        isUpdate
          ? t('workflows.messages.workflowUpdated', 'Workflow updated successfully')
          : t('workflows.messages.workflowCreated', 'Workflow created successfully'),
        'success',
      )

      // Redirect to definition detail page after short delay
      setTimeout(() => {
        router.push(`/backend/definitions/${savedDefinition.id}`)
      }, 1500)

    } catch (error) {
      logger.error('Error saving workflow definition', { err: error })
      flash(t('workflows.messages.saveFailed', 'Failed to save'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [nodes, edges, workflowId, workflowName, description, version, enabled, category, tags, icon, effectiveFrom, effectiveTo, triggers, definitionId, updatedAt, router, t])

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

  // Apply a gallery template to the canvas: populate metadata from the
  // template's i18n keys and convert its definition into graph nodes/edges.
  const applyTemplate = useCallback((template: WorkflowTemplateGalleryItem) => {
    setWorkflowId(template.id.replace(/-/g, '_'))
    setWorkflowName(t(template.nameKey))
    setDescription(t(template.descriptionKey))
    setVersion(1)
    setEnabled(true)
    setCategory(template.category)
    setTags([])
    setIcon(template.icon)

    const graph = definitionToGraph(template.definition)
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setTriggers(template.definition.triggers || [])
    flash(t('workflows.visualEditor.templateLoaded', 'Template loaded'), 'success')
  }, [t])

  // Open the template gallery (replaces the old hardcoded inline example).
  const handleOpenTemplateGallery = useCallback(() => {
    setShowTemplateGallery(true)
  }, [])

  const handleTemplateSelect = useCallback((template: WorkflowTemplateGalleryItem | null) => {
    if (template) applyTemplate(template)
  }, [applyTemplate])

  // Populate the canvas from ?template=<id> when creating a new workflow.
  useEffect(() => {
    if (definitionId || !templateId) return
    let cancelled = false
    const loadTemplate = async () => {
      const result = await apiCall<{ items?: WorkflowTemplateGalleryItem[]; error?: string }>('/api/workflows/templates')
      if (cancelled) return
      const template = result.ok
        ? (result.result?.items || []).find((item) => item.id === templateId)
        : undefined
      if (template) {
        applyTemplate(template)
      } else {
        flash(t('workflows.templates.gallery.notFound', 'Template not found'), 'error')
      }
    }
    void loadTemplate()
    return () => {
      cancelled = true
    }
  }, [definitionId, templateId, applyTemplate, t])

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

  // Publish page-load record context to the AppShell-owned `backend:record:current`
  // mount so the enterprise record_locks widget resolves `workflows.definition` + id
  // explicitly. This is the highest-value record_locks target (long-lived visual
  // edits): presence holds the lock while the graph is open, and the raw `apiCall`
  // save already routes its 409 through `surfaceRecordConflict`. Cleared on create
  // (no `definitionId`) and on unmount. Mirrors the form edit page's resourceKind so
  // a lock held in either editor surfaces in the other.
  useSetCurrentRecordInjectionContext(
    buildRecordInjectionContext({
      resourceKind: 'workflows.definition',
      resourceId: definitionId,
      updatedAt,
      path: pathname,
    }),
  )

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

  const crudFormDialogsEnabled = resolveCrudFormDialogsEnabled(process.env.NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED)

  const sharedDialogs = (
    <>
      {crudFormDialogsEnabled ? (
        <NodeEditDialogCrudForm node={selectedNode} isOpen={showNodeDialog} onClose={() => setShowNodeDialog(false)} onSave={handleSaveNode} onDelete={handleDeleteNode} />
      ) : (
        <NodeEditDialog node={selectedNode} isOpen={showNodeDialog} onClose={() => setShowNodeDialog(false)} onSave={handleSaveNode} onDelete={handleDeleteNode} />
      )}
      {crudFormDialogsEnabled ? (
        <EdgeEditDialogCrudForm edge={selectedEdge} isOpen={showEdgeDialog} onClose={() => setShowEdgeDialog(false)} onSave={handleSaveEdge} onDelete={handleDeleteEdge} />
      ) : (
        <EdgeEditDialog edge={selectedEdge} isOpen={showEdgeDialog} onClose={() => setShowEdgeDialog(false)} onSave={handleSaveEdge} onDelete={handleDeleteEdge} />
      )}
      <TemplateGalleryDialog
        open={showTemplateGallery}
        onOpenChange={setShowTemplateGallery}
        onSelect={handleTemplateSelect}
      />
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
    </>
  )

  const draftRestoreBanner = pendingDraft ? (
    <div className="shrink-0 border-b border-border bg-background px-3 py-2 md:px-6 md:py-3">
      <Alert variant="info">
        <AlertTitle>
          {t('workflows.visualEditor.draft.bannerTitle', 'You have an unsaved draft from {time}', {
            time: formatRelativeTime(pendingDraft.draft.updatedAt, { translate: t }) ?? '',
          })}
        </AlertTitle>
        {pendingDraft.baseMismatch && (
          <AlertDescription>
            {t('workflows.visualEditor.draft.bannerConflict', 'The workflow definition has changed since this draft was made. Restoring will apply your draft over the newer version.')}
          </AlertDescription>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={handleRestoreDraft} className="h-8 text-xs">
            {t('workflows.visualEditor.draft.restore', 'Restore draft')}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDiscardDraft} className="h-8 text-xs">
            {t('workflows.visualEditor.draft.discard', 'Discard')}
          </Button>
        </div>
      </Alert>
    </div>
  ) : null

  const { errors: problemErrorCount, warnings: problemWarningCount } = countIssuesBySeverity(problems)

  const problemsPanel = showProblems && problems.length > 0 ? (
    <div className="shrink-0 border-t border-border bg-background px-3 py-2 md:px-6 md:py-3">
      <div className={`rounded-lg border bg-card ${problemErrorCount > 0 ? 'border-status-error-border' : 'border-status-warning-border'}`}>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setProblemsCollapsed((collapsed) => !collapsed)}
            aria-expanded={!problemsCollapsed}
            className="h-auto gap-2 p-0 text-sm font-semibold text-foreground hover:bg-transparent"
          >
            {problemsCollapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
            {t('workflows.visualEditor.problems.title', 'Problems')}
            <span className="text-xs font-normal text-muted-foreground">
              {t('workflows.visualEditor.problems.counts', '{errors} error(s) · {warnings} warning(s)', { errors: problemErrorCount, warnings: problemWarningCount })}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowProblems(false)}
            aria-label={t('workflows.visualEditor.problems.dismiss', 'Dismiss problems')}
            className="h-7 w-7 p-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        {!problemsCollapsed && (
          <ul className="max-h-56 overflow-y-auto border-t border-border">
            {problems.map((issue) => {
              const isNavigable = Boolean(issue.nodeId || issue.edgeId)
              return (
                <li key={issue.id}>
                  <Button
                    variant="ghost"
                    onClick={() => handleProblemClick(issue)}
                    disabled={!isNavigable}
                    className={`flex h-auto w-full items-start justify-start gap-2 rounded-none px-3 py-1.5 text-left text-sm font-normal ${isNavigable ? 'hover:bg-muted' : 'cursor-default hover:bg-transparent'}`}
                  >
                    {issue.severity === 'error' ? (
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-error-text" aria-hidden="true" />
                    ) : (
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-warning-text" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 text-foreground">{issue.message}</span>
                    {issue.nodeLabel && (
                      <span className="shrink-0 text-xs text-muted-foreground">{issue.nodeLabel}</span>
                    )}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  ) : null

  if (isMobile) {
    return (
      <Page className="flex h-[100svh] flex-col space-y-0 overflow-hidden">
        {draftRestoreBanner}
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
          onLoadExample={handleOpenTemplateGallery}
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
      <div className="shrink-0 border-b border-border bg-background px-3 py-2 md:px-6 md:py-3">
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
              {draftEligible && (draftSaveFailed || draftSavedLabel) && (
                <span role="status" className="text-xs text-muted-foreground">
                  {draftSaveFailed
                    ? t('workflows.visualEditor.draft.saveFailed', 'Draft not saved')
                    : t('workflows.visualEditor.draft.saved', 'Draft saved {time}', { time: draftSavedLabel ?? '' })}
                </span>
              )}
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
                  onClick={handleOpenTemplateGallery}
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
              {!isCodeOnly && (
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

      {/* Per-user draft restore banner (spec §4.7) */}
      {draftRestoreBanner}

      {/* Workflow Metadata Form */}
      {showMetadata && (
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
                focusTarget={focusTarget}
                nodeErrorCounts={nodeErrorCounts}
              />
            </div>

            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
                <div className="text-center">
                  <h2 className="mb-2 text-lg font-semibold text-foreground">{t('workflows.visualEditor.startBuilding')}</h2>
                  <p className="mb-4 text-sm text-muted-foreground">{t('workflows.visualEditor.tapToAddBelow')}</p>
                  <button
                    onClick={handleOpenTemplateGallery}
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
                {(['start', 'userTask', 'automated', 'waitForSignal', 'waitForTimer', 'subWorkflow', 'end'] as const).map((nodeType) => {
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
          {/* Left Sidebar - Step Palette (hidden in read-only mode) */}
          {!isCodeOnly && (
          <div className="w-[24rem] shrink-0 overflow-y-auto border-r border-border bg-background p-6">
            <div className="rounded-lg border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">{t('workflows.visualEditor.stepPalette')}</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                {t('workflows.visualEditor.clickToAdd')}
              </p>

              <div className="space-y-3">
                {/* START Step */}
                <button
                  onClick={() => handleAddNode('start')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-border bg-background px-4 py-3 text-left transition-all hover:border-muted-foreground/30 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.start} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.start
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{NODE_TYPE_LABELS.start.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{NODE_TYPE_LABELS.start.description}</div>
                </button>

                {/* USER_TASK Step */}
                <button
                  onClick={() => handleAddNode('userTask')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-border bg-background px-4 py-3 text-left transition-all hover:border-muted-foreground/30 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.userTask} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.userTask
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{NODE_TYPE_LABELS.userTask.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{NODE_TYPE_LABELS.userTask.description}</div>
                </button>

                {/* AUTOMATED Step */}
                <button
                  onClick={() => handleAddNode('automated')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-border bg-background px-4 py-3 text-left transition-all hover:border-muted-foreground/30 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.automated} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.automated
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{NODE_TYPE_LABELS.automated.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{NODE_TYPE_LABELS.automated.description}</div>
                </button>

                {/* WAIT_FOR_SIGNAL Step */}
                <button
                  onClick={() => handleAddNode('waitForSignal')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-border bg-background px-4 py-3 text-left transition-all hover:border-muted-foreground/30 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.waitForSignal} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.waitForSignal
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{NODE_TYPE_LABELS.waitForSignal.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{NODE_TYPE_LABELS.waitForSignal.description}</div>
                </button>

                {/* WAIT_FOR_TIMER Step */}
                <button
                  onClick={() => handleAddNode('waitForTimer')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-border bg-background px-4 py-3 text-left transition-all hover:border-muted-foreground/30 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.waitForTimer} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.waitForTimer
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{NODE_TYPE_LABELS.waitForTimer.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{NODE_TYPE_LABELS.waitForTimer.description}</div>
                </button>

                {/* SUB_WORKFLOW Step */}
                <button
                  onClick={() => handleAddNode('subWorkflow')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-border bg-background px-4 py-3 text-left transition-all hover:border-muted-foreground/30 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.subWorkflow} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.subWorkflow
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{NODE_TYPE_LABELS.subWorkflow.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{NODE_TYPE_LABELS.subWorkflow.description}</div>
                </button>

                {/* END Step */}
                <button
                  onClick={() => handleAddNode('end')}
                  className="group relative w-full cursor-pointer rounded-xl border-2 border-border bg-background px-4 py-3 text-left transition-all hover:border-muted-foreground/30 hover:shadow-md"
                >
                  <div className={`absolute right-2 top-2 ${NODE_TYPE_COLORS.end} opacity-60 transition-opacity group-hover:opacity-100`}>
                    {(() => {
                      const Icon = NODE_TYPE_ICONS.end
                      return <Icon className="h-4 w-4" />
                    })()}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{NODE_TYPE_LABELS.end.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{NODE_TYPE_LABELS.end.description}</div>
                </button>
              </div>

              {/* Instructions */}
              <Alert variant="info" className="mt-6">
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
            </div>
          </div>
          )}

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
                  editable={!isCodeOnly}
                  height="100%"
                  focusTarget={focusTarget}
                  nodeErrorCounts={nodeErrorCounts}
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
                      onClick={handleOpenTemplateGallery}
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
      {problemsPanel}
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
  }
  return badges[nodeType] || 'Task'
}

