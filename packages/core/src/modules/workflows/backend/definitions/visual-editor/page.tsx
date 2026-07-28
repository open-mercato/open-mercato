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
import { graphToDefinition, definitionToGraph, applyAutoLayout, validateWorkflowGraph, generateStepId, generateTransitionId, appendWorkflowEdge, ValidationError } from '../../../lib/graph-utils'
import { collectValidationIssues, countIssuesBySeverity, type WorkflowValidationIssue, type ZodIssueLike } from '../../../lib/collect-validation-issues'
import { formatWorkflowValidationError } from '../../../lib/format-validation-error'
import type { WorkflowGraphFocusTarget } from '../../../components/WorkflowGraph'
import { performDeleteEdgeFlow, performDeleteNodeFlow } from '../../../lib/visual-editor-delete-flow'
import { resolveCrudFormDialogsEnabled } from '../../../lib/crud-form-dialogs-flag'
import { decideDraftRestore, isServerDraftEligible, stableSerializeDefinition } from '../../../lib/draft-restore'
import { buildDefinitionPayload, buildMetadataPayload } from '../../../lib/definition-payload'
import { resolveDefinitionInterpolationMode, type WorkflowInterpolationMode } from '../../../lib/interpolation-pipeline'
import { ERROR_SOURCE_HANDLE_ID } from '../../../lib/error-routing'
import { DefinitionErrorHandlerField } from '../../../components/DefinitionErrorHandlerField'
import type { WorkflowErrorHandlerConfig } from '../../../data/validators'
import { WORKFLOW_NODE_DELETE_EVENT } from '../../../components/WorkflowNodeCard'
import { classifyConnection, applyInputMappingToNodes, buildDataMappingEdge } from '../../../lib/data-edge-mapping'
import { workflowDefinitionDataSchema, type WorkflowIoContract } from '../../../data/validators'
import { collectActivityConfigWarnings } from '../../../data/activity-config-warnings'
import { collectBranchingRouteWarnings, collectDuplicateBranchingCaseWarnings } from '../../../data/branching-route-warnings'
import {
  applyIfElseRoutes,
  applySwitchRoutes,
  isBranchingNodeType,
  readBranchingRoutes,
  readSwitchField,
  type SwitchRoutesValue,
} from '../../../lib/branching-routes'
import {
  buildTriggerPayloadContracts,
  computeContextLedger,
  type LedgerContract,
  type LedgerWorkflowDefinition,
} from '../../../lib/context-ledger'
import { useAvailableEvents } from '@open-mercato/ui/backend/inputs/EventSelect'
import { collectUnresolvedContextRefWarnings } from '../../../lib/expression-refs'
import type { PinnedSampleEnvelope } from '../../../lib/sample-resolver'
import { Page } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
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
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { buildRecordInjectionContext, useSetCurrentRecordInjectionContext } from '@open-mercato/ui/backend/injection/recordContext'
import { readJsonSafe } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ChevronDown, ChevronRight, CircleAlert, CircleQuestionMark, Maximize2, Minimize2, Network, PanelLeftClose, PanelLeftOpen, PanelTopClose, PanelTopOpen, Play, Save, Trash2, TriangleAlert, X } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { usePersistedBooleanFlag } from '@open-mercato/ui/backend/crud/usePersistedBooleanFlag'
import { useSidebarCollapse } from '@open-mercato/ui/backend/AppShell'
import { NODE_TYPE_ICONS, NODE_TYPE_COLORS, NODE_TYPE_LABELS } from '../../../lib/node-type-icons'
import { DefinitionTriggersEditor } from '../../../components/DefinitionTriggersEditor'
import { ContextSchemaEditor } from '../../../components/ContextSchemaEditor'
import { TemplateGalleryDialog, type WorkflowTemplateGalleryItem } from '../../../components/TemplateGalleryDialog'
import { MobileVisualEditor } from '../../../components/mobile/MobileVisualEditor'
import { useIsMobile } from '@open-mercato/ui/hooks/useIsMobile'
import type { WorkflowContextSchema, WorkflowDefinitionData, WorkflowDefinitionTrigger } from '../../../data/entities'
import type { WorkflowMetadataState, WorkflowMetadataHandlers } from '../../../data/types'
import * as React from 'react'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

type WorkflowDefinitionDraftPayload = {
  definition: Record<string, unknown>
  metadata?: Record<string, unknown> | null
  baseUpdatedAt: string | null
  updatedAt: string | null
}

const DRAFT_AUTOSAVE_DEBOUNCE_MS = 2000
const DRAFT_SAVED_LABEL_REFRESH_MS = 30000

/**
 * Ledger-checked context-reference warnings for the Problems panel (spec
 * section 3.5). The editor validates UNSAVED state, so the ledger is computed
 * CLIENT-side with `resolveOutputContract` pinned to 'unknown' instead of
 * fetching the server ledger from the context-schema API: the client ledger is
 * type-poorer (activity outputs stay single `unknown` nodes rather than typed
 * contract entries) but structurally identical, and since `unknown` entries
 * resolve every sub-path in the checker, the degradation can only suppress
 * warnings, never fabricate them. Warnings merge into the same ZodIssueLike
 * channel as activity-config warnings, so `collectValidationIssues` maps them
 * to nodes/edges and they never block saves.
 */
function computeClientContextLedger(
  definitionData: WorkflowDefinitionData,
  triggerPayloadContracts?: Record<string, LedgerContract>,
) {
  return computeContextLedger(definitionData as unknown as LedgerWorkflowDefinition, {
    resolveOutputContract: () => 'unknown',
    triggerPayloadContracts,
  })
}

/**
 * Advisory warnings for branching steps (IF_ELSE / SWITCH) whose outgoing
 * routes are all conditioned. Routing lives entirely in the transition
 * evaluator, so a branching node without an unconditioned "otherwise" route can
 * strand an instance — the editor warns, never blocks.
 */
function collectOtherwiseRouteWarnings(
  definitionData: WorkflowDefinitionData,
  translate: ReturnType<typeof useT>,
): ZodIssueLike[] {
  return collectBranchingRouteWarnings(definitionData).map((warning) => ({
    path: warning.path,
    message: translate(
      'workflows.visualEditor.problems.branchingWithoutOtherwise',
      'Branching step "{stepId}" has no unconditioned route; add an otherwise route so the workflow cannot stall when no condition matches',
      { stepId: warning.stepId },
    ),
  }))
}

function collectDuplicateCaseWarnings(
  definitionData: WorkflowDefinitionData,
  translate: ReturnType<typeof useT>,
): ZodIssueLike[] {
  return collectDuplicateBranchingCaseWarnings(definitionData).map((warning) => ({
    path: warning.path,
    message: translate(
      'workflows.visualEditor.problems.duplicateBranchingCase',
      'Branching step "{stepId}" has more than one route for {caseValue}; only the highest-priority one can ever match',
      { stepId: warning.stepId, caseValue: warning.caseValue },
    ),
  }))
}

function collectContextRefWarnings(
  definitionData: WorkflowDefinitionData,
  translate: ReturnType<typeof useT>,
  triggerPayloadContracts?: Record<string, LedgerContract>,
): ZodIssueLike[] {
  const ledger = computeClientContextLedger(definitionData, triggerPayloadContracts)
  return collectUnresolvedContextRefWarnings(definitionData, ledger).map((warning) => ({
    path: warning.path,
    message: translate(
      'workflows.visualEditor.problems.unresolvedContextRef',
      'Context reference "{path}" is not provided by any earlier step, trigger, or input',
      { path: warning.refPath },
    ),
  }))
}

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

const PALETTE_NODE_TYPES = ['start', 'userTask', 'automated', 'invokeAgent', 'ifElse', 'switch', 'waitForSignal', 'waitForTimer', 'waitForCondition', 'subWorkflow', 'end'] as const

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
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  // Debounced autosave-on-drag plumbing. `performAutosaveRef` is reassigned each
  // render so the debounced timer always runs the latest closure (no stale nodes).
  const autosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const performAutosaveRef = React.useRef<() => Promise<void>>(async () => {})
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
  const [contextSchema, setContextSchema] = useState<WorkflowContextSchema | undefined>(undefined)
  // The sub-workflow io port contract is not edited on this page, but it must
  // survive the graph → definition rebuild on save/draft, so it is carried as
  // pass-through state exactly like contextSchema.
  const [definitionIo, setDefinitionIo] = useState<WorkflowIoContract | undefined>(undefined)
  // Interpolation mode (spec §3.6): new definitions start strict (matching the
  // POST create default); loaded definitions keep their stored value, and
  // ABSENT stays absent through save round-trips so existing lenient
  // definitions are never flipped by an unrelated edit.
  const [interpolation, setInterpolation] = useState<WorkflowInterpolationMode | undefined>(undefined)
  // Definition-level catch-all error handler (spec section 5.9). Pass-through
  // state like contextSchema/io: absent stays absent through save round-trips.
  const [errorHandler, setErrorHandler] = useState<WorkflowErrorHandlerConfig | undefined>(undefined)
  const [loadedMetadata, setLoadedMetadata] = useState<Record<string, unknown> | null>(null)
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
        setInterpolation('strict')
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
        const loadedTriggers = definition.definition?.triggers || []
        setTriggers(loadedTriggers)

        // Carry the declared context schema and the FULL metadata object so
        // save/draft rebuilds cannot silently strip keys the editor does not
        // edit (contextSchema, future metadata.editor.* keys).
        const loadedContextSchema = (definition.definition?.contextSchema ?? undefined) as WorkflowContextSchema | undefined
        setContextSchema(loadedContextSchema)
        const loadedIo = (definition.definition?.io ?? undefined) as WorkflowIoContract | undefined
        setDefinitionIo(loadedIo)
        const loadedInterpolation = resolveDefinitionInterpolationMode(definition.definition)
        setInterpolation(loadedInterpolation)
        const loadedErrorHandler = (definition.definition?.errorHandler ?? undefined) as WorkflowErrorHandlerConfig | undefined
        setErrorHandler(loadedErrorHandler)
        const loadedMetadataObject = definition.metadata && typeof definition.metadata === 'object'
          ? { ...(definition.metadata as Record<string, unknown>) }
          : null
        setLoadedMetadata(loadedMetadataObject)

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
        const comparableDefinition = buildDefinitionPayload({
          graphDefinition: graphToDefinition(graph.nodes, graph.edges, { includePositions: true }),
          triggers: loadedTriggers,
          contextSchema: loadedContextSchema,
          io: loadedIo,
          interpolation: loadedInterpolation,
          errorHandler: loadedErrorHandler,
        })
        const loadedDraftMetadata = buildMetadataPayload({
          loadedMetadata: loadedMetadataObject,
          category: definition.metadata?.category || '',
          tags: definition.metadata?.tags || [],
          icon: definition.metadata?.icon || '',
        })
        lastPersistedDraftRef.current = stableSerializeDefinition({
          definition: comparableDefinition,
          metadata: loadedDraftMetadata,
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

  const draftMetadata = useMemo(
    () => buildMetadataPayload({ loadedMetadata, tags, category, icon }),
    [loadedMetadata, tags, category, icon],
  )

  // Debounced autosave-to-draft (~2s): watches the same editor-state dep set
  // the save handler uses and PUTs the per-user draft. Never fires for
  // unsaved/new or code-defined definitions, and failures stay quiet — the
  // small indicator flips to "draft not saved" and the next change retries.
  useEffect(() => {
    if (!draftAutosaveReady || !draftEligible || !definitionId) return
    if (draftSuspendedRef.current) return
    let payload: { definition: ReturnType<typeof buildDefinitionPayload>; metadata: Record<string, unknown> | null; baseUpdatedAt: string | null }
    try {
      payload = {
        definition: buildDefinitionPayload({
          graphDefinition: graphToDefinition(nodes, edges, { includePositions: true }),
          triggers,
          contextSchema,
          io: definitionIo,
          interpolation,
          errorHandler,
        }),
        metadata: draftMetadata,
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
  }, [draftAutosaveReady, draftEligible, definitionId, nodes, edges, triggers, contextSchema, definitionIo, interpolation, errorHandler, draftMetadata, updatedAt, workflowName, description, version, enabled, effectiveFrom, effectiveTo])

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
      const draftContextSchema = pendingDraft.draft.definition.contextSchema
      setContextSchema(draftContextSchema ? (draftContextSchema as WorkflowContextSchema) : undefined)
      const draftIo = (pendingDraft.draft.definition as { io?: WorkflowIoContract }).io
      setDefinitionIo(draftIo ?? undefined)
      setInterpolation(resolveDefinitionInterpolationMode(pendingDraft.draft.definition))
      const draftErrorHandler = (pendingDraft.draft.definition as { errorHandler?: WorkflowErrorHandlerConfig }).errorHandler
      setErrorHandler(draftErrorHandler ?? undefined)
      const restoredMetadata = pendingDraft.draft.metadata ?? null
      setLoadedMetadata(restoredMetadata)
      if (restoredMetadata) {
        setCategory(typeof restoredMetadata.category === 'string' ? restoredMetadata.category : '')
        setTags(Array.isArray(restoredMetadata.tags) ? restoredMetadata.tags.filter((tag): tag is string => typeof tag === 'string') : [])
        setIcon(typeof restoredMetadata.icon === 'string' ? restoredMetadata.icon : '')
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

  // Schedule a quiet debounced autosave (~900ms). Only for already-saved,
  // editable definitions; new unsaved drafts fall back to an explicit Save.
  const scheduleAutosave = useCallback(() => {
    if (!definitionId || isCodeOnly) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void performAutosaveRef.current()
    }, 900)
  }, [definitionId, isCodeOnly])

  // Clear any pending autosave timer on unmount.
  useEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
  }, [])

  // Handle node changes from ReactFlow. The lazy graph applies React Flow's
  // change reducers internally (#3169) and hands back the resolved nodes, so
  // this page never imports the @xyflow/react runtime. Position changes land
  // here too, so the debounced autosave persists drag arrangements quietly.
  const handleNodesChange = useCallback((nextNodes: Node[]) => {
    if (isCodeOnly) return
    setNodes(nextNodes)
    scheduleAutosave()
  }, [isCodeOnly, scheduleAutosave])

  // Auto-arrange / Tidy: the single intentional full re-layout. Re-runs dagre
  // (LR) over the current graph, overwrites positions, and persists via autosave.
  const handleAutoArrange = useCallback(() => {
    if (isCodeOnly) return
    setNodes((nds) => applyAutoLayout(nds, edges))
    scheduleAutosave()
  }, [isCodeOnly, edges, scheduleAutosave])

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

  // Branching (IF_ELSE / SWITCH) routes are read from and written back to the
  // node's outgoing edges — the inspector never introduces a bespoke shape.
  const branchingRoutesValue = useMemo<SwitchRoutesValue | undefined>(() => {
    if (!selectedNode || !isBranchingNodeType(selectedNode.type)) return undefined
    return {
      field: readSwitchField(edges, selectedNode.id),
      routes: readBranchingRoutes(edges, selectedNode.id),
    }
  }, [selectedNode, edges])

  const handleSaveBranchingRoutes = useCallback((nodeId: string, value: SwitchRoutesValue) => {
    const nodeType = nodes.find((node) => node.id === nodeId)?.type
    setEdges((eds) => (nodeType === 'switch' ? applySwitchRoutes(eds, nodeId, value) : applyIfElseRoutes(eds, nodeId, value.routes)))
    scheduleAutosave()
  }, [nodes, scheduleAutosave])

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

  // Inline node delete: a node's trash button dispatches WORKFLOW_NODE_DELETE_EVENT
  // (decoupled from the node component); route it through the same confirm +
  // edge-cleanup flow as the edit dialog's delete. No-op in read-only mode.
  useEffect(() => {
    if (isCodeOnly) return
    const onNodeDelete = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId
      if (typeof nodeId === 'string') void handleDeleteNode(nodeId)
    }
    window.addEventListener(WORKFLOW_NODE_DELETE_EVENT, onNodeDelete)
    return () => window.removeEventListener(WORKFLOW_NODE_DELETE_EVENT, onNodeDelete)
  }, [isCodeOnly, handleDeleteNode])

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
      setEdges((eds) => appendWorkflowEdge(eds.filter((e) => e.id !== dataEdge.id), dataEdge))
      return
    }

    // A connection drawn from a node's error output handle authors an error
    // route (spec 5.9): normal routing never selects it, the engine follows it
    // only when that step fails.
    const isErrorRoute = connection.sourceHandle === ERROR_SOURCE_HANDLE_ID

    const newEdge: Edge = {
      id: generateTransitionId(connection.source!, connection.target!),
      source: connection.source!,
      target: connection.target!,
      // An error route must read as one the moment it is drawn, so it takes the
      // workflow edge renderer immediately instead of on the next reload.
      type: isErrorRoute ? 'workflowTransition' : 'smoothstep',
      ...(isErrorRoute ? { sourceHandle: ERROR_SOURCE_HANDLE_ID } : {}),
      data: {
        trigger: 'auto',
        preConditions: [],
        postConditions: [],
        activities: [],
        label: '',
        ...(isErrorRoute ? { kind: 'error' } : {}),
      },
    }

    setEdges((eds) => appendWorkflowEdge(eds, newEdge))
  }, [])

  // Typed trigger contextMapping targets (spec section 3.1, step 1.9): the
  // ledger stays pure, so trigger event payload contracts are pre-resolved
  // here from the already-fetched declared-events list (which carries
  // payloadSchema since step 1.7) and passed in as plain data. Schema-less or
  // wildcard triggers get no contract and their mapping targets stay unknown.
  // Handler-step candidates for the definition-level error handler: every step
  // that can actually receive the run (START/END are not recovery targets).
  const errorHandlerStepOptions = useMemo(
    () =>
      nodes
        .filter((node) => node.type !== 'start' && node.type !== 'end')
        .map((node) => ({
          stepId: node.id,
          label: typeof node.data?.label === 'string' && node.data.label ? node.data.label : node.id,
        })),
    [nodes],
  )

  const { events: availableEvents } = useAvailableEvents()
  const triggerPayloadContracts = useMemo(
    () => buildTriggerPayloadContracts(triggers, availableEvents),
    [triggers, availableEvents],
  )

  // Ledger entries for the variable picker in the open edit dialog (spec
  // section 3.5, step 3.2). Computed lazily — only while a dialog is open —
  // with the same client-side 'unknown'-contract ledger the Problems warnings
  // use, so the picker never offers a path the ref checker would then flag.
  // Node dialogs get the edited step's incoming view; edge dialogs get the
  // TARGET step's incoming view, matching the transition scope rule in
  // lib/expression-refs.ts.
  const dialogLedger = useMemo(() => {
    if (!showNodeDialog && !showEdgeDialog) return null
    try {
      const definitionData = buildDefinitionPayload({
        graphDefinition: graphToDefinition(nodes, edges),
        triggers,
        contextSchema,
        io: definitionIo,
      })
      return computeClientContextLedger(definitionData, triggerPayloadContracts)
    } catch {
      return null
    }
  }, [showNodeDialog, showEdgeDialog, nodes, edges, triggers, contextSchema, definitionIo, triggerPayloadContracts])

  const nodeDialogLedgerEntries = useMemo(
    () => (dialogLedger && selectedNode ? dialogLedger.steps[selectedNode.id]?.entries : undefined),
    [dialogLedger, selectedNode],
  )

  // Pinned per-step samples carried inside metadata.editor.samples (spec
  // section 3.6, step 4.4). The page owns the metadata object, so pin/unpin
  // write through setLoadedMetadata and the explicit Save (and draft
  // autosave) persist them via buildMetadataPayload's spread.
  const editorSamples = useMemo(() => {
    const editorValue = loadedMetadata?.editor
    if (!editorValue || typeof editorValue !== 'object' || Array.isArray(editorValue)) return undefined
    const samplesValue = (editorValue as Record<string, unknown>).samples
    if (!samplesValue || typeof samplesValue !== 'object' || Array.isArray(samplesValue)) return undefined
    return samplesValue as Record<string, PinnedSampleEnvelope>
  }, [loadedMetadata])

  const handlePinSample = useCallback((stepId: string, data: unknown) => {
    setLoadedMetadata((previous) => {
      const base: Record<string, unknown> = { ...(previous ?? {}) }
      const editorValue = base.editor
      const editor: Record<string, unknown> =
        editorValue && typeof editorValue === 'object' && !Array.isArray(editorValue)
          ? { ...(editorValue as Record<string, unknown>) }
          : {}
      const samplesValue = editor.samples
      const samples: Record<string, unknown> =
        samplesValue && typeof samplesValue === 'object' && !Array.isArray(samplesValue)
          ? { ...(samplesValue as Record<string, unknown>) }
          : {}
      samples[stepId] = { pinnedAt: new Date().toISOString(), source: 'test', data }
      editor.samples = samples
      base.editor = editor
      return base
    })
    flash(t('workflows.testStep.pinnedFlash', 'Sample pinned — it is stored with the definition on save'), 'success')
  }, [t])

  const handleUnpinSample = useCallback((stepId: string) => {
    setLoadedMetadata((previous) => {
      if (!previous) return previous
      const editorValue = previous.editor
      if (!editorValue || typeof editorValue !== 'object' || Array.isArray(editorValue)) return previous
      const editor = { ...(editorValue as Record<string, unknown>) }
      const samplesValue = editor.samples
      if (!samplesValue || typeof samplesValue !== 'object' || Array.isArray(samplesValue)) return previous
      const samples = { ...(samplesValue as Record<string, unknown>) }
      if (!(stepId in samples)) return previous
      delete samples[stepId]
      if (Object.keys(samples).length > 0) editor.samples = samples
      else delete editor.samples
      const base = { ...previous }
      if (Object.keys(editor).length > 0) base.editor = editor
      else delete base.editor
      return Object.keys(base).length > 0 ? base : null
    })
  }, [])

  const edgeDialogLedgerEntries = useMemo(
    () => (dialogLedger && selectedEdge ? dialogLedger.steps[selectedEdge.target]?.entries : undefined),
    [dialogLedger, selectedEdge],
  )

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
      const ledgerDefinition = buildDefinitionPayload({ graphDefinition: definitionData, triggers, contextSchema, io: definitionIo, interpolation, errorHandler })
      configWarnings = [
        ...collectActivityConfigWarnings(definitionData),
        ...collectOtherwiseRouteWarnings(definitionData, t),
        ...collectDuplicateCaseWarnings(definitionData, t),
        ...collectContextRefWarnings(ledgerDefinition, t, triggerPayloadContracts),
      ]
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
  }, [nodes, edges, triggers, contextSchema, definitionIo, interpolation, errorHandler, t])

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

    // Generate definition data and re-attach triggers, contextSchema, io, and
    // the interpolation mode
    const definitionData = buildDefinitionPayload({
      graphDefinition: graphToDefinition(nodes, edges, { includePositions: true }),
      triggers,
      contextSchema,
      io: definitionIo,
      interpolation,
      errorHandler,
    })

    const schemaResult = workflowDefinitionDataSchema.safeParse(definitionData)
    const issues = collectValidationIssues({
      graphErrors,
      zodIssues: schemaResult.success ? [] : schemaResult.error.issues,
      configWarnings: [
        ...collectActivityConfigWarnings(definitionData),
        ...collectOtherwiseRouteWarnings(definitionData, t),
        ...collectDuplicateCaseWarnings(definitionData, t),
        ...collectContextRefWarnings(definitionData, t, triggerPayloadContracts),
      ],
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

      const metadataPayload = buildMetadataPayload({ loadedMetadata, tags, category, icon, definition: definitionData })

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
              metadata: metadataPayload,
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
            metadata: metadataPayload,
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
      logger.error('Error saving workflow definition', { err: error })
      flash(t('workflows.messages.saveFailed', 'Failed to save'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [nodes, edges, workflowId, workflowName, description, version, enabled, category, tags, icon, effectiveFrom, effectiveTo, triggers, contextSchema, definitionIo, interpolation, errorHandler, loadedMetadata, definitionId, updatedAt, router, t])

  // Quiet autosave routine (no redirect, no success flash). Mirrors the update
  // branch of `handleSave` exactly — same payload and the same optimistic-lock
  // header — so dragged positions persist without an explicit Save. Reassigned
  // every render and invoked through `performAutosaveRef` by the debounced timer
  // so it always sees the latest nodes/edges/metadata.
  performAutosaveRef.current = async () => {
    if (!definitionId || isCodeOnly) return
    if (!workflowId || !workflowName) return

    const criticalErrors = validateWorkflowGraph(nodes, edges).filter((e) => e.type === 'error')
    if (criticalErrors.length > 0) return

    // Same payload builders as the explicit Save: the quiet autosave must not
    // strip contextSchema, io, interpolation, or unedited metadata keys
    // (editor samples).
    const definitionData = buildDefinitionPayload({
      graphDefinition: graphToDefinition(nodes, edges, { includePositions: true }),
      triggers,
      contextSchema,
      io: definitionIo,
      interpolation,
      errorHandler,
    })
    if (!workflowDefinitionDataSchema.safeParse(definitionData).success) return

    const metadataPayload = buildMetadataPayload({ loadedMetadata, tags, category, icon, definition: definitionData })

    setAutosaveState('saving')
    try {
      const result = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(updatedAt),
        () => apiCall<{ data: any; error?: string }>(`/api/workflows/definitions/${definitionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowName,
            description: description || null,
            version,
            definition: definitionData,
            metadata: metadataPayload,
            enabled,
            effectiveFrom: effectiveFrom || null,
            effectiveTo: effectiveTo || null,
          }),
        }),
      )

      if (!result.ok) {
        setAutosaveState('idle')
        const conflictError = Object.assign(new Error('[internal] workflow autosave failed'), {
          status: result.status,
          ...(result.result && typeof result.result === 'object' ? result.result : {}),
        })
        surfaceRecordConflict(conflictError, t)
        return
      }

      const savedDefinition = result.result?.data
      if (typeof savedDefinition?.updatedAt === 'string') {
        setUpdatedAt(savedDefinition.updatedAt)
      }
      setAutosaveState('saved')
    } catch (error) {
      console.error('[internal] workflow autosave failed', error)
      setAutosaveState('idle')
    }
  }

  // Fade the "Saved" affordance back to idle shortly after a successful autosave.
  useEffect(() => {
    if (autosaveState !== 'saved') return
    const timer = setTimeout(() => setAutosaveState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [autosaveState])

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
    setContextSchema(template.definition.contextSchema ?? undefined)
    setDefinitionIo((template.definition.io ?? undefined) as WorkflowIoContract | undefined)
    setInterpolation(resolveDefinitionInterpolationMode(template.definition) ?? 'strict')
    setErrorHandler((template.definition as { errorHandler?: WorkflowErrorHandlerConfig }).errorHandler ?? undefined)
    setLoadedMetadata(null)
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
    setContextSchema(undefined)
    setDefinitionIo(undefined)
    setLoadedMetadata(null)
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
        <NodeEditDialogCrudForm node={selectedNode} isOpen={showNodeDialog} onClose={() => setShowNodeDialog(false)} onSave={handleSaveNode} onDelete={handleDeleteNode} ledgerEntries={nodeDialogLedgerEntries} definitionId={definitionId} samples={editorSamples} onPinSample={handlePinSample} onUnpinSample={handleUnpinSample} branchingRoutes={branchingRoutesValue} onSaveBranchingRoutes={handleSaveBranchingRoutes} />
      ) : (
        <NodeEditDialog node={selectedNode} isOpen={showNodeDialog} onClose={() => setShowNodeDialog(false)} onSave={handleSaveNode} onDelete={handleDeleteNode} />
      )}
      {crudFormDialogsEnabled ? (
        <EdgeEditDialogCrudForm edge={selectedEdge} isOpen={showEdgeDialog} onClose={() => setShowEdgeDialog(false)} onSave={handleSaveEdge} onDelete={handleDeleteEdge} ledgerEntries={edgeDialogLedgerEntries} />
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
          onStartInstance={() => setStartOpen(true)}
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

  // Break the editor out of `main`'s centered `max-w-screen-2xl` so the canvas
  // uses the full content column on wide screens (the side gutters the author
  // saw). Width = the content column (viewport minus the sidebar offset exposed
  // by AppShell); the negative margins cancel `main`'s auto-centering
  // (`max(0, (col-1536)/2)`) and its `lg:p-6` padding (24px). Desktop-only — the
  // compact (<1280px) layout keeps the normal centered container.
  const fullBleedSideMargin =
    'calc(-1 * (max(0px, (100vw - var(--app-content-offset, 0px) - 1536px) / 2) + 24px))'
  const fullBleedStyle: React.CSSProperties = !isCompactViewport
    ? {
        width: 'calc(100vw - var(--app-content-offset, 0px))',
        marginLeft: fullBleedSideMargin,
        marginRight: fullBleedSideMargin,
      }
    : {}

  return (
    <Page
      className="flex min-h-[calc(100svh-7rem)] flex-col space-y-0 overflow-x-hidden"
      style={fullBleedStyle}
    >
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
              {draftEligible && (draftSaveFailed || draftSavedLabel) && (
                <span role="status" className="text-xs text-muted-foreground">
                  {draftSaveFailed
                    ? t('workflows.visualEditor.draft.saveFailed', 'Draft not saved')
                    : t('workflows.visualEditor.draft.saved', 'Draft saved {time}', { time: draftSavedLabel ?? '' })}
                </span>
              )}
              {!isCodeOnly && definitionId && autosaveState !== 'idle' && (
                <span className="mr-1 text-xs text-muted-foreground" aria-live="polite">
                  {autosaveState === 'saving' ? t('workflows.visualEditor.autosaving') : t('workflows.visualEditor.autosaved')}
                </span>
              )}
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
                  onClick={handleOpenTemplateGallery}
                  disabled={isSaving}
                  className="h-8 text-xs"
                >
                  {t('workflows.visualEditor.loadExample')}
                </Button>
              )}
              {!isCodeOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAutoArrange}
                  disabled={isSaving || nodes.length === 0}
                  className="h-8 px-2 text-xs"
                  aria-label={t('workflows.visualEditor.autoArrange')}
                >
                  <Network className="mr-1.5 h-4 w-4" />
                  {t('workflows.visualEditor.autoArrange')}
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

      {/* Per-user draft restore banner (spec §4.7) */}
      {draftRestoreBanner}

      {/* Workflow Metadata Form */}
      {showMetadata && !focusMode && (
        <div className={isCompactViewport
          ? 'shrink-0 border-b border-border bg-background px-3 py-2 max-h-[60svh] overflow-y-auto overscroll-contain md:px-6 md:py-3'
          : 'shrink-0 border-b border-border bg-background px-3 py-2 max-h-[45svh] overflow-y-auto overscroll-contain md:px-6 md:py-3'
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

          {/* Declared context inputs (spec §3.1) — same lock as triggers */}
          <fieldset disabled={isCodeOnly} className="mt-3 disabled:opacity-70">
            <ContextSchemaEditor
              value={contextSchema}
              onChange={setContextSchema}
            />
          </fieldset>

          {/* Interpolation mode (spec §3.6) — same lock as triggers/context */}
          <fieldset disabled={isCodeOnly} className="mt-3 disabled:opacity-70">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="interpolation-mode" className="text-xs">
                {t('workflows.visualEditor.interpolation.label', 'Missing variables')}
              </Label>
              <Select
                value={interpolation ?? 'lenient'}
                onValueChange={(mode) => setInterpolation(mode as WorkflowInterpolationMode)}
              >
                <SelectTrigger
                  id="interpolation-mode"
                  className="w-full sm:w-[280px]"
                  aria-label={t('workflows.visualEditor.interpolation.label', 'Missing variables')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="strict">
                    {t('workflows.visualEditor.interpolation.strict', 'Strict — fail the step')}
                  </SelectItem>
                  <SelectItem value="lenient">
                    {t('workflows.visualEditor.interpolation.lenient', 'Lenient — keep the text as written')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                'workflows.visualEditor.interpolation.help',
                'Controls what happens when a variable placeholder cannot be resolved at run time: strict fails the step so problems surface immediately; lenient keeps the unresolved text unchanged. New workflows start strict.',
              )}
            </p>
          </fieldset>

          {/* Workflow-level error handler (spec §5.9) — same lock as triggers/context */}
          <fieldset disabled={isCodeOnly} className="mt-3 disabled:opacity-70">
            <DefinitionErrorHandlerField
              value={errorHandler ?? null}
              onChange={(next) => setErrorHandler(next ?? undefined)}
              stepOptions={errorHandlerStepOptions}
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
        <div className="flex min-h-0 min-w-0 flex-1 border-t border-border pl-3 md:pl-6">
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

          {/* Main Canvas — the header already carries the Focus toggle, so no
              separate in-canvas Exit-focus button (avoids two identical controls). */}
          <div className="min-w-0 flex-1 p-6">
            <div className="relative h-full min-h-[480px]">
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
    waitForCondition: 'Wait for Condition',
    invokeAgent: 'Invoke Agent',
    ifElse: 'If / Else',
    switch: 'Switch',
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
    waitForCondition: 'Wait for Condition',
    invokeAgent: 'Invoke Agent',
    ifElse: 'If / Else',
    switch: 'Switch',
  }
  return badges[nodeType] || 'Task'
}

