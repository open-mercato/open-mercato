'use client'

import { WorkflowGraph } from '../../../components/WorkflowGraph'
import { useLastRunOverlay } from '../../../components/run/useLastRunOverlay'
// Conditional imports based on feature flag
import { NodeEditDialog } from '../../../components/NodeEditDialog'
import { EdgeEditDialog } from '../../../components/EdgeEditDialog'
import { NodeEditDialogCrudForm } from '../../../components/NodeEditDialogCrudForm'
import { EdgeEditDialogCrudForm } from '../../../components/EdgeEditDialogCrudForm'
import type { InspectorPanelVariant } from '../../../components/InspectorPanel'
import type { Node, Edge, Connection } from '@xyflow/react'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { graphToDefinition, definitionToGraph, applyAutoLayout, validateWorkflowGraph, generateStepId, generateTransitionId, appendWorkflowEdge, getBadgeForNodeType, ValidationError } from '../../../lib/graph-utils'
import { convertStepType, type ConvertibleStepType } from '../../../lib/step-type-conversion'
import { collectValidationIssues, countIssuesBySeverity, type WorkflowIssueTranslator, type WorkflowValidationIssue, type ZodIssueLike } from '../../../lib/collect-validation-issues'
import { formatWorkflowValidationError } from '../../../lib/format-validation-error'
import type { WorkflowGraphDropEvent, WorkflowGraphFocusTarget, WorkflowGraphNodesChangeMeta } from '../../../components/WorkflowGraph'
import { resolveNewNodePlacement } from '../../../lib/node-placement'
import {
  commitEditorHistory,
  createEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
  type EditorHistoryState,
  type WorkflowEditorDocument,
  type WorkflowEditorPanelState,
} from '../../../lib/editor-history'
import {
  parseWorkflowSubgraph,
  pasteWorkflowSubgraph,
  serializeWorkflowSubgraph,
  stringifyWorkflowSubgraph,
  type SubgraphClipboardParseFailure,
  type WorkflowSubgraphClipboard,
} from '../../../lib/subgraph-clipboard'
import {
  annotationsFromNodes,
  annotationsToNodes,
  createGroupNode,
  createNoteNode,
  isAnnotationNode,
  readEditorAnnotations,
  removeAnnotationNode,
  updateAnnotationNode,
  type WorkflowGroupNodeData,
  type WorkflowNoteNodeData,
} from '../../../lib/editor-annotations'
import { WORKFLOW_GROUP_TOGGLE_EVENT } from '../../../lib/annotation-events'
import { AnnotationEditDialog } from '../../../components/AnnotationEditDialog'
import { WorkflowCodeView } from '../../../components/WorkflowCodeView'
import { DefinitionMetadataDrawer, type DefinitionMetadataSection } from '../../../components/DefinitionMetadataDrawer'
import { describeCodeViewDraft, evaluateCodeViewDraft } from '../../../lib/code-view-apply'
import {
  WorkflowAiDraftDialog,
  type WorkflowAiDraftApplyRefusal,
} from '../../../components/WorkflowAiDraftDialog'
import { buildAiCheckpointLabel } from '../../../lib/ai-authoring'
import {
  locateDefinitionJsonEntities,
  locateIssues,
  severityByLine,
} from '../../../lib/definition-json-locations'
import { WorkflowCommandPalette } from '../../../components/WorkflowCommandPalette'
import { buildWorkflowEditorCommands, type WorkflowEditorCommand } from '../../../lib/editor-commands'
import { NUDGE_COMMIT_DELAY_MS, nudgeOffset, nudgeSelectedNodes, resolveNudgeDirection, selectedNodeIds } from '../../../lib/node-nudge'
import { canRedoEditorHistory, canUndoEditorHistory } from '../../../lib/editor-history'
import { readPaletteDragItem, writePaletteDragPayload } from '../../../lib/palette-drag'
import { appendActivityToRoute, insertStepOnRoute, type PaletteDropRejectionCode } from '../../../lib/palette-drop'
import { useActivityTypeOptions } from '../../../components/fields/useActivityTypeOptions'
import { resolveActivityIcon } from '../../../components/WorkflowRouteChips'
import { performDeleteEdgeFlow, performDeleteNodeFlow } from '../../../lib/visual-editor-delete-flow'
import { resolveCrudFormDialogsEnabled } from '../../../lib/crud-form-dialogs-flag'
import { decideDraftRestore, isServerDraftEligible, stableSerializeDefinition } from '../../../lib/draft-restore'
import { buildDefinitionPayload, buildMetadataPayload } from '../../../lib/definition-payload'
import { resolveDefinitionInterpolationMode, type WorkflowInterpolationMode } from '../../../lib/interpolation-pipeline'
import { findRouteKindDescriptorForHandle } from '../../../lib/route-kinds'
import { isDecisionSourceHandle, type DecisionRowLike } from '../../../lib/node-outcome-rows'
import { STRUCTURAL_EDIT_CONFLICT_CODE } from '../../../lib/definition-edit-safety'
import type { WorkflowErrorHandlerConfig } from '../../../data/validators'
import { WORKFLOW_NODE_DELETE_EVENT } from '../../../components/WorkflowNodeCard'
import { WORKFLOW_ROUTE_CHIP_EVENT, type RouteChipEventDetail } from '../../../lib/route-chip-events'
import { applyRouteOrder, canNormalizeRoutePriorities, normalizeRoutePriorities, readRouteOrder, type RouteOrderEntry } from '../../../lib/route-priority'
import { classifyConnection, applyInputMappingToNodes, buildDataMappingEdge } from '../../../lib/data-edge-mapping'
import { reattachWorkflowEdge, type EdgeReattachRejection } from '../../../lib/edge-reattachment'
import { workflowDefinitionDataSchema, type WorkflowIoContract } from '../../../data/validators'
import { collectActivityConfigWarnings } from '../../../data/activity-config-warnings'
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
import { toUnresolvedContextRefIssues } from '../../../lib/definition-evaluation'
import type { PinnedSampleEnvelope } from '../../../lib/sample-resolver'
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
import {
  listStartFixtures,
  removeStartFixture,
  upsertStartFixture,
  type WorkflowStartFixtures,
} from '../../../lib/start-fixtures'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ChevronDown, ChevronRight, CircleAlert, CircleQuestionMark, Code, Command, Group, History, Maximize2, Minimize2, Network, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Play, Save, ShieldMinus, Sparkles, StickyNote, Trash2, TriangleAlert, X } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { usePersistedBooleanFlag } from '@open-mercato/ui/backend/crud/usePersistedBooleanFlag'
import { useSidebarCollapse } from '@open-mercato/ui/backend/AppShell'
import { NODE_TYPE_ICONS, NODE_TYPE_COLORS, NODE_TYPE_LABELS } from '../../../lib/node-type-icons'
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

function collectContextRefWarnings(
  definitionData: WorkflowDefinitionData,
  translate: ReturnType<typeof useT>,
  triggerPayloadContracts?: Record<string, LedgerContract>,
): ZodIssueLike[] {
  const ledger = computeClientContextLedger(definitionData, triggerPayloadContracts)
  return toUnresolvedContextRefIssues(definitionData, ledger, translate)
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

/** Body of a definition update — shared by explicit Save and the quiet autosave. */
type DefinitionUpdateBody = {
  workflowName: string
  description: string | null
  version: number
  definition: ReturnType<typeof buildDefinitionPayload>
  metadata: ReturnType<typeof buildMetadataPayload>
  enabled: boolean
  effectiveFrom: string | null
  effectiveTo: string | null
}

/**
 * Edit-safety rule (spec 4.1): the definition PUT refuses a topology change
 * while instances are still executing this version. The refusal is a dead end
 * without its remedy, so the rejected payload rides along and is re-applied to
 * the freshly minted version.
 */
type StructuralEditConflict = {
  activeInstanceCount: number
  payload: DefinitionUpdateBody
}

function readStructuralEditConflictCount(status: number, body: unknown): number | null {
  if (status !== 409) return null
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  if (!record || record.code !== STRUCTURAL_EDIT_CONFLICT_CODE) return null
  return typeof record.activeInstanceCount === 'number' ? record.activeInstanceCount : 0
}

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
  const [edgeDialogFocusFieldId, setEdgeDialogFocusFieldId] = useState<string | null>(null)
  // Latest edges, readable from window-event handlers without re-subscribing on
  // every graph change (route chips resolve their edge through this).
  const edgesRef = React.useRef<Edge[]>([])
  edgesRef.current = edges
  const nodesRef = React.useRef<Node[]>([])
  nodesRef.current = nodes
  // Definition metadata lives in a right-side Drawer, so it costs the canvas
  // nothing and never needs hiding. It starts closed — the canvas is what the
  // page is for — and `handleSave` opens it when the required id/name are
  // still missing, which is the moment the author needs it.
  const [metadataOpen, setMetadataOpen] = useState(false)
  // Which section the drawer lands on. Only the canvas trigger pill sets it
  // (fidelity gap #5) — every other way in wants the top of the form — so it is
  // cleared whenever the drawer is opened by anything else.
  const [metadataFocusSection, setMetadataFocusSection] = useState<DefinitionMetadataSection | null>(null)
  // The canvas trigger pill's action. It opens the drawer AT "Inputs and
  // triggers" rather than at the top of the form: the node states how the
  // workflow starts, so the affordance has to land on the editor for it.
  const handleOpenTriggers = useCallback(() => {
    setMetadataFocusSection('inputs')
    setMetadataOpen(true)
  }, [])
  // The focus target is one-shot: every other way into the drawer wants the top
  // of the form, so closing it clears the request.
  const handleMetadataOpenChange = useCallback((open: boolean) => {
    if (!open) setMetadataFocusSection(null)
    setMetadataOpen(open)
  }, [])
  const [isCompactViewport, setIsCompactViewport] = useState(false)
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [structuralConflict, setStructuralConflict] = useState<StructuralEditConflict | null>(null)
  const [isCreatingVersion, setIsCreatingVersion] = useState(false)
  // Debounced autosave-on-drag plumbing. `performAutosaveRef` is reassigned each
  // render so the debounced timer always runs the latest closure (no stale nodes).
  const autosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const performAutosaveRef = React.useRef<() => Promise<void>>(async () => {})
  // Last payload the quiet autosave actually persisted, so an unchanged graph
  // never issues a redundant PUT (#4248). Cleared on failure so the next change
  // retries the write.
  const lastAutosavedBodyRef = React.useRef<string | null>(null)
  const { value: paletteCollapsed, toggle: togglePaletteCollapsed, setValue: setPaletteCollapsed } = usePersistedBooleanFlag('om:wf-editor-palette', false)
  const [showPaletteHowTo, setShowPaletteHowTo] = useState(false)
  const { value: focusMode, setValue: setFocusMode, toggle: toggleFocus } = usePersistedBooleanFlag('om:wf-editor-focus', false)
  // Compensation ghosts (spec §4.4) are OFF by default and remembered per
  // author: they are a read-only overlay, never part of the document.
  const { value: showCompensation, toggle: toggleCompensation } = usePersistedBooleanFlag('om:wf-editor-compensation', false)
  // "Show last run" (spec §8.3). OFF by default and remembered per author, and
  // it fetches nothing until it is on — an author editing a definition should
  // not pay for three requests they never asked for.
  const { value: showLastRun, toggle: toggleLastRun } = usePersistedBooleanFlag('om:wf-editor-last-run', false)
  const { requestCollapse, releaseRequest } = useSidebarCollapse()
  // Remember the palette state from before Focus mode took over so we can
  // restore exactly what the author had when they exit.
  const priorPaletteCollapsedRef = React.useRef<boolean | null>(null)

  // Focus mode orchestrator: collapse the app sidebar + palette when entering
  // and restore the author's prior palette state when leaving. Runs on mount
  // too, so a persisted `focusMode === true` applies the collapses immediately.
  // The metadata Drawer is not touched: it overlays rather than displaces the
  // canvas, so hiding it would buy Focus mode nothing and would only make the
  // palette's "Toggle the workflow details panel" command a silent no-op.
  useEffect(() => {
    if (focusMode) {
      if (priorPaletteCollapsedRef.current === null) priorPaletteCollapsedRef.current = paletteCollapsed
      requestCollapse(true)
      setPaletteCollapsed(true)
    } else {
      releaseRequest()
      if (priorPaletteCollapsedRef.current !== null) {
        setPaletteCollapsed(priorPaletteCollapsedRef.current)
        priorPaletteCollapsedRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode])

  // Always release the app-sidebar request when the editor unmounts so the
  // user's prior sidebar state is restored when they navigate away.
  useEffect(() => () => releaseRequest(), [releaseRequest])

  // Track the compact (<1280px) layout after hydration
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(max-width: 1279px)')
    const applyViewportMode = () => {
      setIsCompactViewport(mediaQuery.matches)
    }

    applyViewportMode()
    mediaQuery.addEventListener('change', applyViewportMode)

    return () => {
      mediaQuery.removeEventListener('change', applyViewportMode)
    }
  }, [])
  const [showNodeDialog, setShowNodeDialog] = useState(false)
  const [showEdgeDialog, setShowEdgeDialog] = useState(false)

  const crudFormDialogsEnabled = resolveCrudFormDialogsEnabled(process.env.NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED)

  // The step and route inspectors dock beside the canvas when the viewport has
  // room for a rail (spec §4.1). Below that they stay modal — a 384px rail plus
  // the palette leaves nothing of the graph, which is the problem the rail
  // exists to solve, not a smaller version of it. The legacy dialogs keep their
  // own modal chrome; they are deprecated and are not being redesigned.
  const inspectorsDocked = crudFormDialogsEnabled && !isMobile && !isCompactViewport
  const inspectorVariant: InspectorPanelVariant = inspectorsDocked ? 'docked' : 'overlay'

  // Sticky notes and groups (spec 4.5) are canvas nodes with their own tiny
  // inspector — they carry no step configuration, so they never open the step
  // dialog.
  const [selectedAnnotation, setSelectedAnnotation] = useState<Node | null>(null)
  const [showAnnotationDialog, setShowAnnotationDialog] = useState(false)
  // Cmd+K command palette (spec 4.6). Together with the inspector and the
  // Problems panel it is the complete non-pointer authoring path, so every
  // mutating action the toolbar offers is reachable through it.
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  // Code view, stage 1 (spec §2.2): the assembled definition JSON read-only,
  // beside the same structured issue list the Problems panel renders.
  const [showCodeView, setShowCodeView] = useState(false)
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
  const lastRunOverlay = useLastRunOverlay({ workflowId, enabled: showLastRun && !!definitionId })
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
  // Spec section 8.2 test-run modes. Independent by design: a real run can be
  // stepped through, and a dry run can be let loose end to end.
  const [startDryRun, setStartDryRun] = useState(false)
  const [startStepThrough, setStartStepThrough] = useState(false)
  const [fixtureName, setFixtureName] = useState('')

  // Undo/redo (spec §4.5). One stack over the whole editor document, so an
  // inspector save undoes exactly like a deleted route. Snapshots are cheap
  // because every mutating path already replaces the node/edge arrays instead
  // of mutating them, so an entry only holds references.
  const [history, setHistory] = useState<EditorHistoryState<WorkflowEditorDocument>>(createEditorHistory)
  const historyRef = React.useRef(history)
  historyRef.current = history
  const loadedMetadataRef = React.useRef<Record<string, unknown> | null>(null)
  loadedMetadataRef.current = loadedMetadata

  const historyLabels = useMemo(() => ({
    addStep: t('workflows.visualEditor.history.addStep', 'Add step'),
    editStep: t('workflows.visualEditor.history.editStep', 'Edit step'),
    editRoute: t('workflows.visualEditor.history.editRoute', 'Edit route'),
    deleteStep: t('workflows.visualEditor.history.deleteStep', 'Delete step'),
    deleteRoute: t('workflows.visualEditor.history.deleteRoute', 'Delete route'),
    connect: t('workflows.visualEditor.history.connect', 'Connect steps'),
    reattach: t('workflows.visualEditor.history.reattach', 'Re-target route'),
    move: t('workflows.visualEditor.history.move', 'Move steps'),
    convert: t('workflows.visualEditor.history.convert', 'Change step type'),
    branchRoutes: t('workflows.visualEditor.history.branchRoutes', 'Edit branch routes'),
    routeOrder: t('workflows.visualEditor.history.routeOrder', 'Reorder routes'),
    pinSample: t('workflows.visualEditor.history.pinSample', 'Pin sample'),
    unpinSample: t('workflows.visualEditor.history.unpinSample', 'Unpin sample'),
    tidy: t('workflows.visualEditor.history.tidy', 'Tidy layout'),
    paste: t('workflows.visualEditor.history.paste', 'Paste'),
    duplicate: t('workflows.visualEditor.history.duplicate', 'Duplicate'),
    insertOnRoute: t('workflows.visualEditor.history.insertOnRoute', 'Insert step on route'),
    addActivity: t('workflows.visualEditor.history.addActivity', 'Add action to route'),
    addNote: t('workflows.visualEditor.history.addNote', 'Add note'),
    addGroup: t('workflows.visualEditor.history.addGroup', 'Add group'),
    editAnnotation: t('workflows.visualEditor.history.editAnnotation', 'Edit annotation'),
    deleteAnnotation: t('workflows.visualEditor.history.deleteAnnotation', 'Delete annotation'),
    toggleGroup: t('workflows.visualEditor.history.toggleGroup', 'Collapse group'),
    saveFixture: t('workflows.visualEditor.history.saveFixture', 'Save start fixture'),
    deleteFixture: t('workflows.visualEditor.history.deleteFixture', 'Delete start fixture'),
    applyCode: t('workflows.visualEditor.history.applyCode', 'Apply JSON from Code view'),
  }), [t])

  // The definition-panel fields ride ALONG with the document so the Code view's
  // Apply — which replaces the whole definition, panel fields included — is one
  // fully reversible action. Every other entry captures them too, which costs
  // five references and makes an undo restore the state it claims to.
  const panelStateRef = React.useRef<WorkflowEditorPanelState>({
    triggers: [],
    contextSchema: undefined,
    io: undefined,
    interpolation: undefined,
    errorHandler: undefined,
  })
  useEffect(() => {
    panelStateRef.current = {
      triggers,
      contextSchema,
      io: definitionIo,
      interpolation,
      errorHandler,
    }
  }, [triggers, contextSchema, definitionIo, interpolation, errorHandler])

  const captureDocument = useCallback((): WorkflowEditorDocument => ({
    nodes: nodesRef.current,
    edges: edgesRef.current,
    metadata: loadedMetadataRef.current,
    panel: panelStateRef.current,
  }), [])

  const commitCapturedDocument = useCallback((document: WorkflowEditorDocument, label: string) => {
    setHistory((current) => commitEditorHistory(current, document, label))
  }, [])

  const commitHistory = useCallback((label: string) => {
    commitCapturedDocument(captureDocument(), label)
  }, [captureDocument, commitCapturedDocument])

  // A whole-document replacement (draft restore, template load, clear) starts a
  // fresh stack: those paths also rewrite the definition-panel fields, which the
  // document deliberately does not version, so undoing into them would restore
  // half a workflow.
  const resetHistory = useCallback(() => {
    setHistory(createEditorHistory<WorkflowEditorDocument>())
  }, [])

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

        // Convert definition to graph. Annotations ride alongside the steps as
        // canvas nodes so a note drags, undoes and autosaves like everything
        // else — they are filtered back out on the way to `definition.steps`.
        const graph = definitionToGraph(definition.definition, { childContracts })
        const loadedMetadataBag = definition.metadata && typeof definition.metadata === 'object'
          ? (definition.metadata as Record<string, unknown>)
          : null
        const annotationNodes = annotationsToNodes(readEditorAnnotations(loadedMetadataBag))
        setNodes([...graph.nodes, ...annotationNodes])
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
        const loadedMetadataObject = loadedMetadataBag ? { ...loadedMetadataBag } : null
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
          annotations: annotationsFromNodes(annotationNodes),
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

  // The canvas owns the annotations, so every persistence path derives them back
  // out of the node array rather than tracking a second copy that could drift.
  const annotations = useMemo(() => annotationsFromNodes(nodes), [nodes])

  const draftMetadata = useMemo(
    () => buildMetadataPayload({ loadedMetadata, tags, category, icon, annotations }),
    [loadedMetadata, tags, category, icon, annotations],
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
      setNodes([...graph.nodes, ...annotationsToNodes(readEditorAnnotations(pendingDraft.draft.metadata ?? null))])
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
      resetHistory()
      flash(t('workflows.visualEditor.draft.restored', 'Draft restored'), 'success')
    } catch (error) {
      logger.error('Error restoring workflow definition draft', { err: error })
      flash(t('workflows.visualEditor.draft.restoreFailed', 'Failed to restore draft'), 'error')
    } finally {
      setPendingDraft(null)
      setDraftAutosaveReady(true)
    }
  }, [pendingDraft, resetHistory, t])

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

  const applyHistoryDocument = useCallback((document: WorkflowEditorDocument) => {
    setNodes(document.nodes)
    setEdges(document.edges)
    setLoadedMetadata(document.metadata)
    // Entries captured before the panel fields were versioned carry none; then
    // the panel is left exactly as it is, which is the previous behaviour.
    if (document.panel) {
      setTriggers(document.panel.triggers as WorkflowDefinitionTrigger[])
      setContextSchema(document.panel.contextSchema as WorkflowContextSchema | undefined)
      setDefinitionIo(document.panel.io as WorkflowIoContract | undefined)
      setInterpolation(document.panel.interpolation as WorkflowInterpolationMode | undefined)
      setErrorHandler(document.panel.errorHandler as WorkflowErrorHandlerConfig | undefined)
    }
    scheduleAutosave()
  }, [scheduleAutosave])

  const handleUndo = useCallback(() => {
    if (isCodeOnly) return
    const step = undoEditorHistory(historyRef.current, captureDocument())
    if (!step) {
      flash(t('workflows.visualEditor.history.nothingToUndo', 'Nothing to undo'), 'info')
      return
    }
    setHistory(step.state)
    applyHistoryDocument(step.document)
    flash(t('workflows.visualEditor.history.undone', 'Undone: {label}', { label: step.label }), 'success')
  }, [isCodeOnly, captureDocument, applyHistoryDocument, t])

  const handleRedo = useCallback(() => {
    if (isCodeOnly) return
    const step = redoEditorHistory(historyRef.current, captureDocument())
    if (!step) {
      flash(t('workflows.visualEditor.history.nothingToRedo', 'Nothing to redo'), 'info')
      return
    }
    setHistory(step.state)
    applyHistoryDocument(step.document)
    flash(t('workflows.visualEditor.history.redone', 'Redone: {label}', { label: step.label }), 'success')
  }, [isCodeOnly, captureDocument, applyHistoryDocument, t])

  // Copy / paste / duplicate of a selected subgraph (spec §4.5). The payload on
  // the system clipboard is portable JSON in the DEFINITION vocabulary, so it
  // travels to another workflow and to the Code view. When the browser denies
  // clipboard access (insecure context, no permission) the editor falls back to
  // an in-page buffer and says so, rather than failing silently.
  const localClipboardRef = React.useRef<string | null>(null)

  const selectedSubgraph = useCallback(() => {
    const selectedIds = nodesRef.current.filter((node) => node.selected).map((node) => node.id)
    return serializeWorkflowSubgraph(nodesRef.current, edgesRef.current, selectedIds)
  }, [])

  const handleCopySelection = useCallback(async () => {
    const payload = selectedSubgraph()
    if (!payload) {
      flash(t('workflows.visualEditor.clipboard.nothingSelected', 'Select one or more steps first'), 'info')
      return
    }
    const serialized = stringifyWorkflowSubgraph(payload)
    localClipboardRef.current = serialized
    try {
      await navigator.clipboard.writeText(serialized)
      flash(
        t('workflows.visualEditor.clipboard.copied', 'Copied {count} step(s)', { count: String(payload.steps.length) }),
        'success',
      )
    } catch (error) {
      logger.warn('Workflow subgraph copy fell back to the in-page buffer', { err: error })
      flash(
        t(
          'workflows.visualEditor.clipboard.copyUnavailable',
          'The browser blocked clipboard access, so the selection was kept in this editor only — pasting into another tab will not work.',
        ),
        'warning',
      )
    }
  }, [selectedSubgraph, t])

  const describeClipboardFailure = useCallback((code: SubgraphClipboardParseFailure['code']) => {
    switch (code) {
      case 'invalidJson':
        return t('workflows.visualEditor.clipboard.invalidJson', 'The clipboard does not contain valid JSON.')
      case 'empty':
        return t('workflows.visualEditor.clipboard.empty', 'The copied selection contains no steps.')
      default:
        return t('workflows.visualEditor.clipboard.unsupportedFormat', 'The clipboard does not contain a copied workflow selection.')
    }
  }, [t])

  const spliceSubgraph = useCallback((payload: WorkflowSubgraphClipboard, label: string) => {
    const result = pasteWorkflowSubgraph(nodesRef.current, edgesRef.current, payload)
    commitHistory(label)
    setNodes(result.nodes)
    setEdges(result.edges)
    scheduleAutosave()
    flash(
      t('workflows.visualEditor.clipboard.pasted', 'Pasted {count} step(s)', { count: String(result.pastedNodeIds.length) }),
      'success',
    )
  }, [commitHistory, scheduleAutosave, t])

  const handlePaste = useCallback(async () => {
    if (isCodeOnly) return
    let text: string | null = null
    try {
      text = await navigator.clipboard.readText()
    } catch (error) {
      logger.warn('Workflow subgraph paste fell back to the in-page buffer', { err: error })
      text = localClipboardRef.current
      if (!text) {
        flash(
          t(
            'workflows.visualEditor.clipboard.pasteUnavailable',
            'The browser blocked clipboard access, so there is nothing to paste. Copy a selection in this editor first.',
          ),
          'error',
        )
        return
      }
    }
    const parsed = parseWorkflowSubgraph(text ?? '')
    if (!parsed.ok) {
      flash(describeClipboardFailure(parsed.code), 'error')
      return
    }
    spliceSubgraph(parsed.payload, historyLabels.paste)
  }, [isCodeOnly, describeClipboardFailure, spliceSubgraph, historyLabels.paste, t])

  const handleDuplicateSelection = useCallback(() => {
    if (isCodeOnly) return
    const payload = selectedSubgraph()
    if (!payload) {
      flash(t('workflows.visualEditor.clipboard.nothingSelected', 'Select one or more steps first'), 'info')
      return
    }
    spliceSubgraph(payload, historyLabels.duplicate)
  }, [isCodeOnly, selectedSubgraph, spliceSubgraph, historyLabels.duplicate, t])

  // Handle node changes from ReactFlow. The lazy graph applies React Flow's
  // change reducers internally (#3169) and hands back the resolved nodes plus a
  // note on what the batch meant, so this page never imports the @xyflow/react
  // runtime. A drag persists once, on drag end (#4248); selecting or measuring
  // a node changes nothing worth saving and must not touch the stored row.
  // A drag reports one change batch per frame, so the undoable "before" state is
  // the arrangement captured when the drag STARTED — not the previous frame.
  const dragBaselineRef = React.useRef<WorkflowEditorDocument | null>(null)

  const handleNodesChange = useCallback((nextNodes: Node[], meta?: WorkflowGraphNodesChangeMeta) => {
    if (isCodeOnly) return
    if ((meta?.dragging || meta?.resizing) && !dragBaselineRef.current) dragBaselineRef.current = captureDocument()
    const baseline = dragBaselineRef.current ?? captureDocument()
    setNodes(nextNodes)
    if (meta && !meta.persistable) return
    dragBaselineRef.current = null
    commitCapturedDocument(baseline, historyLabels.move)
    scheduleAutosave()
  }, [isCodeOnly, captureDocument, commitCapturedDocument, historyLabels.move, scheduleAutosave])

  // Auto-arrange / Tidy: the single intentional full re-layout. Re-runs dagre
  // (LR) over the current graph, overwrites positions, and persists via autosave.
  const handleAutoArrange = useCallback(() => {
    if (isCodeOnly) return
    commitHistory(historyLabels.tidy)
    setNodes((nds) => applyAutoLayout(nds, edges))
    scheduleAutosave()
  }, [isCodeOnly, edges, commitHistory, historyLabels.tidy, scheduleAutosave])

  // Handle edge changes from ReactFlow (resolved edges from the lazy graph).
  const handleEdgesChange = useCallback((nextEdges: Edge[]) => {
    if (isCodeOnly) return
    setEdges(nextEdges)
  }, [isCodeOnly])

  const buildPaletteNode = useCallback((nodeType: string, dropPosition?: { x: number; y: number } | null): Node => ({
    id: generateStepId(nodeType),
    type: nodeType,
    position: resolveNewNodePlacement(nodesRef.current, { dropPosition }),
    data: {
      label: getDefaultLabel(nodeType),
      description: '',
      badge: getDefaultBadge(nodeType),
      status: 'pending',
    },
  }), [])

  // Handle adding new node from palette. A drop position (drag-from-palette)
  // places the card under the cursor; the click-append path lands after the
  // right-most card. Both are nudged clear of existing cards (#4248) and both
  // count as a manual arrangement, so the placement is persisted like a drag.
  const handleAddNode = useCallback((nodeType: string, dropPosition?: { x: number; y: number } | null) => {
    if (isCodeOnly) return
    const newNode = buildPaletteNode(nodeType, dropPosition)
    commitHistory(historyLabels.addStep)
    setNodes((nds) => [...nds, newNode])
    scheduleAutosave()
  }, [isCodeOnly, buildPaletteNode, commitHistory, historyLabels.addStep, scheduleAutosave])

  // Notes and groups are added from the palette exactly like steps: a click
  // appends one at a free spot and opens its inspector, so the keyboard path is
  // the same path.
  const handleAddAnnotation = useCallback((kind: 'note' | 'group') => {
    if (isCodeOnly) return
    const position = resolveNewNodePlacement(nodesRef.current, {})
    const node = kind === 'note'
      ? createNoteNode(position, '')
      : createGroupNode(position, t('workflows.annotations.group.untitled', 'Untitled group'))
    commitHistory(kind === 'note' ? historyLabels.addNote : historyLabels.addGroup)
    setNodes((nds) => [...nds, node])
    setSelectedAnnotation(node)
    setShowAnnotationDialog(true)
    scheduleAutosave()
  }, [isCodeOnly, commitHistory, historyLabels.addNote, historyLabels.addGroup, scheduleAutosave, t])

  const activityTypeOptions = useActivityTypeOptions()

  const describePaletteDropRejection = useCallback((code: PaletteDropRejectionCode) => {
    switch (code) {
      case 'dataMappingRoute':
        return t('workflows.visualEditor.palette.rejected.dataMappingRoute', 'Data mapping links are edited in the step configuration, not on the canvas.')
      default:
        return t('workflows.visualEditor.palette.rejected.unknownRoute', 'That route no longer exists.')
    }
  }, [t])

  // Drag-from-palette (spec §4.2). Dropping on empty canvas places the step at
  // the cursor; dropping on a route splices it between that route's endpoints;
  // dropping an action on a route appends it to the route's activities. The
  // graph resolved the flow-space position and the route under the cursor — the
  // effect itself is pure (`lib/palette-drop.ts`).
  const handleCanvasDrop = useCallback((event: WorkflowGraphDropEvent) => {
    if (isCodeOnly) return
    const item = readPaletteDragItem(event.dataTransfer)
    if (!item) return

    if (item.kind === 'step') {
      if (!event.edgeId) {
        handleAddNode(item.nodeType, event.position)
        return
      }
      const result = insertStepOnRoute(
        nodesRef.current,
        edgesRef.current,
        event.edgeId,
        buildPaletteNode(item.nodeType, event.position),
      )
      if (!result.ok) {
        flash(describePaletteDropRejection(result.code), 'error')
        return
      }
      commitHistory(historyLabels.insertOnRoute)
      setNodes(result.nodes)
      setEdges(result.edges)
      scheduleAutosave()
      flash(t('workflows.visualEditor.palette.insertedOnRoute', 'Step inserted on the route'), 'success')
      return
    }

    if (!event.edgeId) {
      flash(t('workflows.visualEditor.palette.dragActionHint', 'Drop an action onto a route to add it there'), 'info')
      return
    }
    const activityLabel = activityTypeOptions.find((option) => option.value === item.activityType)?.label ?? item.activityType
    const result = appendActivityToRoute(edgesRef.current, event.edgeId, {
      activityId: `activity_${Date.now()}`,
      activityName: activityLabel,
      activityType: item.activityType,
      config: {},
    })
    if (!result.ok) {
      flash(describePaletteDropRejection(result.code), 'error')
      return
    }
    commitHistory(historyLabels.addActivity)
    setEdges(result.edges)
    scheduleAutosave()
    flash(t('workflows.visualEditor.palette.activityAdded', '{activity} added to the route', { activity: activityLabel }), 'success')
  }, [
    isCodeOnly,
    handleAddNode,
    buildPaletteNode,
    activityTypeOptions,
    describePaletteDropRejection,
    commitHistory,
    historyLabels.insertOnRoute,
    historyLabels.addActivity,
    scheduleAutosave,
    t,
  ])

  const handlePaletteStepDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>, nodeType: string) => {
    writePaletteDragPayload(event.dataTransfer, { kind: 'step', nodeType }, NODE_TYPE_LABELS[nodeType as keyof typeof NODE_TYPE_LABELS]?.title ?? nodeType)
  }, [])

  const handlePaletteActivityDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>, activityType: string, label: string) => {
    writePaletteDragPayload(event.dataTransfer, { kind: 'activity', activityType }, label)
  }, [])

  // Handle node selection - open edit dialog (suppressed in read-only mode
  // so users can't open the node editor on a code-defined workflow).
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (isCodeOnly) return
    if (isAnnotationNode(node)) {
      setSelectedAnnotation(node)
      setSelectedNode(null)
      setSelectedEdge(null)
      setShowAnnotationDialog(true)
      return
    }
    setSelectedNode(node)
    setSelectedEdge(null)
    // With a docked rail the canvas stays clickable, so a step click can arrive
    // while the ROUTE inspector is open. Closing the other one keeps a single
    // rail; the modal variant could never reach this state.
    setShowEdgeDialog(false)
    setShowNodeDialog(true)
  }, [isCodeOnly])

  // Handle edge selection - open edit dialog
  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    if (isCodeOnly) return
    setSelectedEdge(edge)
    setSelectedNode(null)
    setEdgeDialogFocusFieldId(null)
    setShowNodeDialog(false)
    setShowEdgeDialog(true)
  }, [isCodeOnly])

  // Route chips (#4244) open the edge dialog on the section behind the chip.
  // Chips render inside React Flow's label portal, so they announce on `window`
  // instead of bubbling to `onEdgeClick` — same bridge as the node delete button.
  const handleRouteChipOpen = useCallback((edgeId: string, section: RouteChipEventDetail['section']) => {
    if (isCodeOnly) return
    const edge = edgesRef.current.find((candidate) => candidate.id === edgeId)
    if (!edge) return
    setSelectedEdge(edge)
    setSelectedNode(null)
    setEdgeDialogFocusFieldId(section === 'condition' ? 'condition' : 'activities')
    setShowEdgeDialog(true)
  }, [isCodeOnly])

  // Save node updates
  const handleSaveNode = useCallback((nodeId: string, updates: Partial<Node['data']>) => {
    commitHistory(historyLabels.editStep)
    if (Object.prototype.hasOwnProperty.call(updates, 'decisions')) {
      const previousNode = nodesRef.current.find((node) => node.id === nodeId)
      const previousDecisions = previousNode?.data.decisions as DecisionRowLike[] | undefined
      const nextDecisions = updates.decisions as DecisionRowLike[] | undefined
      const previousIds = new Set(
        (previousDecisions ?? []).flatMap((decision) =>
          typeof decision.transitionId === 'string' ? [decision.transitionId] : []
        ),
      )
      const nextIds = new Set(
        (nextDecisions ?? []).flatMap((decision) =>
          typeof decision.transitionId === 'string' ? [decision.transitionId] : []
        ),
      )
      setEdges((currentEdges) =>
        currentEdges.map((edge) => {
          if (edge.source !== nodeId) return edge
          if (nextIds.has(edge.id)) return { ...edge, sourceHandle: edge.id }
          if (previousIds.has(edge.id) && edge.sourceHandle === edge.id) {
            const { sourceHandle: _removed, ...remainingEdge } = edge
            return remainingEdge
          }
          return edge
        }),
      )
    }
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...updates } }
          : node
      )
    )
    flash('Node updated successfully', 'success')
  }, [commitHistory, historyLabels.editStep])

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
    commitHistory(historyLabels.branchRoutes)
    setEdges((eds) => (nodeType === 'switch' ? applySwitchRoutes(eds, nodeId, value) : applyIfElseRoutes(eds, nodeId, value.routes)))
    scheduleAutosave()
  }, [nodes, commitHistory, historyLabels.branchRoutes, scheduleAutosave])

  // Route order (spec 4.4): a non-branching step's outgoing routes are ordered
  // in the inspector and the priority number is derived from that order.
  const routeOrderValue = useMemo<RouteOrderEntry[] | undefined>(() => {
    if (!selectedNode || isBranchingNodeType(selectedNode.type)) return undefined
    return readRouteOrder(edges, selectedNode.id)
  }, [selectedNode, edges])

  // Nodes whose legacy priorities have already been rewritten this session. The
  // normalization pass runs on the FIRST edit of a node's routes and is
  // idempotent afterwards.
  const normalizedRouteNodesRef = React.useRef<Set<string>>(new Set())

  // A `source: 'code'` definition is read-only in the editor, so normalization
  // simply cannot run for it. Customize mints an editable override (source
  // becomes 'code_override') and the pass runs there on the first route edit —
  // which is exactly the spec's "only on Customize".
  const normalizeRoutesOnFirstEdit = useCallback((nodeId: string) => {
    if (!canNormalizeRoutePriorities(source)) return
    if (normalizedRouteNodesRef.current.has(nodeId)) return
    normalizedRouteNodesRef.current.add(nodeId)
    setEdges((eds) => normalizeRoutePriorities(eds, nodeId))
  }, [source])

  const handleSaveRouteOrder = useCallback((nodeId: string, entries: RouteOrderEntry[]) => {
    if (isCodeOnly) return
    commitHistory(historyLabels.routeOrder)
    normalizeRoutesOnFirstEdit(nodeId)
    setEdges((eds) => applyRouteOrder(eds, nodeId, entries))
    scheduleAutosave()
  }, [isCodeOnly, normalizeRoutesOnFirstEdit, commitHistory, historyLabels.routeOrder, scheduleAutosave])

  // Save edge updates
  const handleSaveEdge = useCallback((edgeId: string, updates: Partial<Edge['data']>) => {
    commitHistory(historyLabels.editRoute)
    setEdges((eds) =>
      eds.map((edge) =>
        edge.id === edgeId
          ? { ...edge, data: { ...edge.data, ...updates } }
          : edge
      )
    )
    flash('Transition updated successfully', 'success')
  }, [commitHistory, historyLabels.editRoute])

  // Delete edge. The undo snapshot is taken before the confirmation and only
  // committed once the delete actually lands, so a cancelled confirm leaves no
  // entry on the stack.
  const handleDeleteEdge = useCallback(async (edgeId: string) => {
    const before = captureDocument()
    const deleted = await performDeleteEdgeFlow(edgeId, {
      confirm,
      t,
      setShowEdgeDialog,
      setSelectedEdge,
      setEdges,
      notifyDeleted: () => flash('Transition deleted successfully', 'success'),
    })
    if (deleted) commitCapturedDocument(before, historyLabels.deleteRoute)
  }, [confirm, t, captureDocument, commitCapturedDocument, historyLabels.deleteRoute])

  // Annotation inspector (spec 4.5). Notes and groups edit a single field each
  // and commit one undo entry, exactly like a step inspector save.
  const handleSaveAnnotation = useCallback((nodeId: string, updates: Partial<WorkflowNoteNodeData & WorkflowGroupNodeData>) => {
    if (isCodeOnly) return
    commitHistory(historyLabels.editAnnotation)
    setNodes((nds) => updateAnnotationNode(nds, nodeId, updates))
    scheduleAutosave()
  }, [isCodeOnly, commitHistory, historyLabels.editAnnotation, scheduleAutosave])

  const handleDeleteAnnotation = useCallback(async (nodeId: string) => {
    if (isCodeOnly) return
    const before = captureDocument()
    setShowAnnotationDialog(false)
    setSelectedAnnotation(null)
    const confirmed = await confirm({
      title: t('workflows.annotations.confirmDeleteTitle', 'Delete annotation?'),
      text: t('workflows.annotations.confirmDeleteText', 'The note or group is removed from the canvas. Nothing the workflow executes changes.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    commitCapturedDocument(before, historyLabels.deleteAnnotation)
    setNodes((nds) => removeAnnotationNode(nds, nodeId))
    scheduleAutosave()
  }, [isCodeOnly, captureDocument, commitCapturedDocument, historyLabels.deleteAnnotation, confirm, scheduleAutosave, t])

  const handleToggleGroupCollapsed = useCallback((nodeId: string) => {
    if (isCodeOnly) return
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId)
    if (!node) return
    const collapsed = (node.data as Partial<WorkflowGroupNodeData> | undefined)?.collapsed === true
    commitHistory(historyLabels.toggleGroup)
    setNodes((nds) => updateAnnotationNode(nds, nodeId, { collapsed: !collapsed }))
    scheduleAutosave()
  }, [isCodeOnly, commitHistory, historyLabels.toggleGroup, scheduleAutosave])

  useEffect(() => {
    const onToggle = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId
      if (typeof nodeId === 'string') handleToggleGroupCollapsed(nodeId)
    }
    window.addEventListener(WORKFLOW_GROUP_TOGGLE_EVENT, onToggle)
    return () => window.removeEventListener(WORKFLOW_GROUP_TOGGLE_EVENT, onToggle)
  }, [handleToggleGroupCollapsed])

  // Delete node
  const handleDeleteNode = useCallback(async (nodeId: string) => {
    const annotation = nodesRef.current.find((candidate) => candidate.id === nodeId && isAnnotationNode(candidate))
    if (annotation) {
      await handleDeleteAnnotation(nodeId)
      return
    }
    const before = captureDocument()
    const deleted = await performDeleteNodeFlow(nodeId, {
      nodes,
      confirm,
      t,
      setShowNodeDialog,
      setSelectedNode,
      setNodes,
      setEdges,
      notifyDeleted: () => flash('Step deleted successfully', 'success'),
    })
    if (deleted) commitCapturedDocument(before, historyLabels.deleteStep)
  }, [confirm, nodes, t, captureDocument, commitCapturedDocument, historyLabels.deleteStep, handleDeleteAnnotation])

  // In-place step type conversion (spec 4.5, #4237). The step keeps its id,
  // name, position and every incoming/outgoing route; config the new type
  // cannot execute is quarantined by `convertStepType` and stays visible in the
  // inspector. The dialog closes before the confirm so only one modal is on
  // screen (same reason as the delete flow).
  const handleConvertNodeType = useCallback(async (nodeId: string, targetType: ConvertibleStepType) => {
    if (isCodeOnly) return
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId)
    if (!node) return

    const before = captureDocument()
    const result = convertStepType({ type: node.type, data: node.data as Record<string, unknown> }, targetType)
    if (!result.ok) {
      flash(t('workflows.stepConversion.unavailable', 'This step type cannot be changed.'), 'error')
      return
    }

    setShowNodeDialog(false)
    setSelectedNode(null)
    const confirmed = await confirm({
      title: t('workflows.stepConversion.confirmTitle', 'Change step type?'),
      text: result.quarantined.length > 0
        ? t(
            'workflows.stepConversion.confirmWithQuarantine',
            'The step keeps its name, position and routes. {count} setting(s) the new type cannot execute move to Unmapped configuration: {keys}',
            { count: String(result.quarantined.length), keys: result.quarantined.join(', ') },
          )
        : t('workflows.stepConversion.confirm', 'The step keeps its name, position and routes.'),
    })
    if (!confirmed) return

    commitCapturedDocument(before, historyLabels.convert)
    setNodes((nds) =>
      nds.map((candidate) =>
        candidate.id === nodeId
          ? { ...candidate, type: result.type, data: { ...result.data, badge: getBadgeForNodeType(result.type) } }
          : candidate,
      ),
    )
    scheduleAutosave()
    flash(
      result.quarantined.length > 0
        ? t('workflows.stepConversion.convertedWithQuarantine', 'Step type changed; {count} setting(s) parked as unmapped configuration', { count: String(result.quarantined.length) })
        : t('workflows.stepConversion.converted', 'Step type changed'),
      result.quarantined.length > 0 ? 'warning' : 'success',
    )
  }, [isCodeOnly, confirm, captureDocument, commitCapturedDocument, historyLabels.convert, scheduleAutosave, t])

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

  useEffect(() => {
    const onChipOpen = (event: Event) => {
      const detail = (event as CustomEvent<RouteChipEventDetail>).detail
      if (detail?.edgeId) handleRouteChipOpen(detail.edgeId, detail.section)
    }
    window.addEventListener(WORKFLOW_ROUTE_CHIP_EVENT, onChipOpen)
    return () => window.removeEventListener(WORKFLOW_ROUTE_CHIP_EVENT, onChipOpen)
  }, [handleRouteChipOpen])

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
      commitHistory(historyLabels.connect)
      setNodes((nds) => applyInputMappingToNodes(nds, targetNodeId, childPortKey, parentPath))
      const dataEdge = buildDataMappingEdge(connection, childPortKey)
      setEdges((eds) => appendWorkflowEdge(eds.filter((e) => e.id !== dataEdge.id), dataEdge))
      return
    }

    // A connection drawn from one of a node's kinded output handles authors that
    // kind of route (spec 5.9 error routes, SLA-breach routes, …): normal
    // routing never selects one, the engine follows it only down its own path.
    const routeKind = findRouteKindDescriptorForHandle(connection.sourceHandle)
    const sourceNode = nodesRef.current.find((node) => node.id === connection.source)
    const decisions = sourceNode?.data.decisions as DecisionRowLike[] | undefined
    const decisionTransitionId = isDecisionSourceHandle(decisions, connection.sourceHandle)
      ? connection.sourceHandle
      : null
    if (
      decisionTransitionId &&
      edgesRef.current.some(
        (edge) =>
          edge.source === connection.source &&
          (edge.id === decisionTransitionId || edge.sourceHandle === decisionTransitionId),
      )
    ) {
      return
    }

    const routeData = routeKind
      ? {
          kind: routeKind.kind,
          ...routeKind.discriminatorFields({
            sourceHandle: connection.sourceHandle,
          }),
        }
      : {}

    const newEdge: Edge = {
      id: decisionTransitionId ?? generateTransitionId(),
      source: connection.source!,
      target: connection.target!,
      // A kinded route must read as one the moment it is drawn, so it takes the
      // workflow edge renderer immediately instead of on the next reload.
      type: routeKind ? 'workflowTransition' : 'smoothstep',
      ...(routeKind
        ? { sourceHandle: connection.sourceHandle }
        : decisionTransitionId
          ? { sourceHandle: decisionTransitionId }
          : {}),
      data: {
        trigger: 'auto',
        preConditions: [],
        postConditions: [],
        activities: [],
        label: '',
        ...routeData,
      },
    }

    commitHistory(historyLabels.connect)
    setEdges((eds) => appendWorkflowEdge(eds, newEdge))
  }, [commitHistory, historyLabels.connect])

  // Route reattachment (#4233): dropping an existing route endpoint on another
  // node re-targets it. The route keeps its durable transitionId, so its label,
  // condition, activities and priority travel with it. A refused target leaves
  // the edge list untouched, which is what snaps the endpoint back — the reason
  // is surfaced instead of silently reverting.
  const describeReattachRejection = useCallback((rejection: EdgeReattachRejection) => {
    switch (rejection.code) {
      case 'selfLoop':
        return t('workflows.reattach.rejected.selfLoop', 'A route cannot start and end on the same step.')
      case 'duplicateRoute':
        return t('workflows.reattach.rejected.duplicateRoute', 'A route already connects those two steps.')
      case 'dataMappingRoute':
        return t('workflows.reattach.rejected.dataMappingRoute', 'Data mapping links are edited in the step configuration, not on the canvas.')
      case 'errorHandleUnsupported':
        return t('workflows.reattach.rejected.errorHandleUnsupported', 'An error route can only start at a step that can fail.')
      case 'kindHandleUnsupported':
        return t('workflows.reattach.rejected.kindHandleUnsupported', 'This route cannot start at that type of step.')
      case 'graphInvalid':
        return t('workflows.reattach.rejected.graphInvalid', 'That target would break the workflow: {reason}', { reason: rejection.detail ?? '' })
      case 'forkJoinInvalid':
        return t('workflows.reattach.rejected.forkJoinInvalid', 'That target would break the parallel branch structure: {reason}', { reason: rejection.detail ?? '' })
      default:
        return t('workflows.reattach.rejected.unsupported', 'That route cannot be re-targeted.')
    }
  }, [t])

  const handleReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    if (isCodeOnly) return
    const result = reattachWorkflowEdge(nodesRef.current, edgesRef.current, oldEdge.id, connection)
    if (!result.ok) {
      flash(describeReattachRejection(result), 'error')
      return
    }
    commitHistory(historyLabels.reattach)
    setEdges(result.edges)
    scheduleAutosave()
    flash(t('workflows.reattach.retargeted', 'Route re-targeted'), 'success')
  }, [isCodeOnly, describeReattachRejection, commitHistory, historyLabels.reattach, scheduleAutosave, t])

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
    commitHistory(historyLabels.pinSample)
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
  }, [commitHistory, historyLabels.pinSample, t])

  const handleUnpinSample = useCallback((stepId: string) => {
    commitHistory(historyLabels.unpinSample)
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
  }, [commitHistory, historyLabels.unpinSample])

  // Named START contexts (spec section 8.1). They live beside samples in
  // metadata.editor, but they are a DIFFERENT thing — a whole start context,
  // not per-step data — so they get their own key and their own cap.
  const startFixtures = useMemo(() => {
    const editorValue = loadedMetadata?.editor
    if (!editorValue || typeof editorValue !== 'object' || Array.isArray(editorValue)) return undefined
    const fixturesValue = (editorValue as Record<string, unknown>).fixtures
    if (!fixturesValue || typeof fixturesValue !== 'object' || Array.isArray(fixturesValue)) return undefined
    return fixturesValue as WorkflowStartFixtures
  }, [loadedMetadata])

  const startFixtureList = useMemo(() => listStartFixtures(startFixtures), [startFixtures])

  const handleSaveFixture = useCallback(() => {
    let context: Record<string, unknown>
    try {
      const parsed = startContext.trim() ? JSON.parse(startContext) : {}
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('[internal] context must be a JSON object')
      }
      context = parsed as Record<string, unknown>
    } catch {
      flash(t('workflows.startInstance.invalidJson'), 'error')
      return
    }

    const result = upsertStartFixture(startFixtures, fixtureName, context, new Date().toISOString())
    if (!result.ok) {
      flash(t(`workflows.fixtures.errors.${result.reason}`), 'error')
      return
    }

    commitHistory(historyLabels.saveFixture)
    setLoadedMetadata((previous) => {
      const base: Record<string, unknown> = { ...(previous ?? {}) }
      const editorValue = base.editor
      const editor: Record<string, unknown> =
        editorValue && typeof editorValue === 'object' && !Array.isArray(editorValue)
          ? { ...(editorValue as Record<string, unknown>) }
          : {}
      editor.fixtures = result.fixtures
      base.editor = editor
      return base
    })
    setFixtureName('')
    flash(t('workflows.fixtures.saved'), 'success')
  }, [startContext, startFixtures, fixtureName, commitHistory, historyLabels.saveFixture, t])

  const handleApplyFixture = useCallback((name: string) => {
    const fixture = startFixtures?.[name]
    if (!fixture) return
    setStartContext(JSON.stringify(fixture.context, null, 2))
    setFixtureName(fixture.name)
  }, [startFixtures])

  const handleDeleteFixture = useCallback((name: string) => {
    commitHistory(historyLabels.deleteFixture)
    setLoadedMetadata((previous) => {
      if (!previous) return previous
      const editorValue = previous.editor
      if (!editorValue || typeof editorValue !== 'object' || Array.isArray(editorValue)) return previous
      const editor = { ...(editorValue as Record<string, unknown>) }
      const next = removeStartFixture(editor.fixtures as WorkflowStartFixtures | undefined, name)
      if (Object.keys(next).length > 0) editor.fixtures = next
      else delete editor.fixtures
      const base = { ...previous }
      if (Object.keys(editor).length > 0) base.editor = editor
      else delete base.editor
      return Object.keys(base).length > 0 ? base : null
    })
  }, [commitHistory, historyLabels.deleteFixture])

  const edgeDialogLedgerEntries = useMemo(
    () => (dialogLedger && selectedEdge ? dialogLedger.steps[selectedEdge.target]?.entries : undefined),
    [dialogLedger, selectedEdge],
  )

  // Bridge the pure issue collector to the page's i18n. `t` already accepts a
  // fallback plus params, so the flow-logic messages stay translatable without
  // the collector depending on React.
  const translateIssue = useCallback<WorkflowIssueTranslator>(
    (key, fallback, params) => t(key, fallback, params),
    [t],
  )

  // Collect every graph and schema issue for the current document. Shared by the
  // explicit Validate action and the Code view's JSON-schema validation display
  // (spec §2.2), so both surfaces can never disagree about what is wrong.
  const evaluateWorkflowIssues = useCallback((): WorkflowValidationIssue[] => {
    const graphErrors = validateWorkflowGraph(nodes, edges)
    let zodIssues: ZodIssueLike[] = []
    let configWarnings: ZodIssueLike[] = []
    let schemaFailureMessage: string | null = null
    let flowLogicDefinition: WorkflowDefinitionData | null = null
    let flowLogicLedger: ReturnType<typeof computeClientContextLedger> | undefined

    try {
      const definitionData = graphToDefinition(nodes, edges, { includePositions: true })
      const result = workflowDefinitionDataSchema.safeParse(definitionData)
      if (!result.success) {
        zodIssues = result.error.issues
      }
      const ledgerDefinition = buildDefinitionPayload({ graphDefinition: definitionData, triggers, contextSchema, io: definitionIo, interpolation, errorHandler })
      flowLogicDefinition = ledgerDefinition
      flowLogicLedger = computeClientContextLedger(ledgerDefinition, triggerPayloadContracts)
      configWarnings = [
        ...collectActivityConfigWarnings(definitionData),
        ...collectContextRefWarnings(ledgerDefinition, t, triggerPayloadContracts),
      ]
    } catch (error) {
      schemaFailureMessage = error instanceof Error ? error.message : String(error)
    }

    const issues = collectValidationIssues({
      graphErrors,
      zodIssues,
      configWarnings,
      nodes,
      edges,
      definition: flowLogicDefinition,
      ledger: flowLogicLedger,
      translate: translateIssue,
    })
    if (schemaFailureMessage) {
      issues.unshift({
        id: 'schema-exception',
        severity: 'error',
        message: t('workflows.visualEditor.problems.schemaValidationFailed', 'Schema validation failed: {message}', { message: schemaFailureMessage }),
      })
    }
    return issues
  }, [nodes, edges, triggers, contextSchema, definitionIo, interpolation, errorHandler, triggerPayloadContracts, translateIssue, t])

  // Validate workflow — collect every graph and schema issue into the problems
  // panel. Shared by the explicit Validate action and by the "Problems pass
  // already run" an applied AI draft owes the author (spec §9).
  const runProblemsPass = useCallback(() => {
    const issues = evaluateWorkflowIssues()
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
  }, [evaluateWorkflowIssues, t])

  const handleValidate = runProblemsPass

  // Code view, stage 1 (spec §2.2). The JSON is assembled through the same
  // builders Save uses, so what an author reads is exactly what is persisted;
  // it is only computed while the panel is open.
  const codeViewJson = useMemo(() => {
    if (!showCodeView) return ''
    try {
      const definitionData = buildDefinitionPayload({
        graphDefinition: graphToDefinition(nodes, edges, { includePositions: true }),
        triggers,
        contextSchema,
        io: definitionIo,
        interpolation,
        errorHandler,
      })
      return JSON.stringify(definitionData, null, 2)
    } catch (error) {
      return t(
        'workflows.visualEditor.codeView.assemblyFailed',
        'The definition could not be assembled: {message}',
        { message: error instanceof Error ? error.message : String(error) },
      )
    }
  }, [showCodeView, nodes, edges, triggers, contextSchema, definitionIo, interpolation, errorHandler, t])

  const codeViewIssues = useMemo(
    () => (showCodeView ? evaluateWorkflowIssues() : []),
    [showCodeView, evaluateWorkflowIssues],
  )

  // Code view stage 2 (spec §2.2). Safety model, stated once:
  // canvas → code is LIVE (the panel re-renders from the canvas whenever the
  // author has not started editing); code → canvas needs an explicit Apply.
  // Parsing, validation and the gutter markers stay live as you type, so the
  // feedback loop is immediate even though the commit is not — mutating the
  // canvas per keystroke would delete every node the moment "steps" is
  // mid-rename, and push one undo entry per character.
  const [codeDraft, setCodeDraft] = useState<string | null>(null)
  const codeDraftText = codeDraft ?? codeViewJson

  // The ONE gate a whole definition passes before it may replace the document.
  // Extracted so the Code view's Apply and the AI draft's Apply (spec §9) share
  // it verbatim — an AI-authored graph has earned exactly as much trust as a
  // pasted one, which is to say none.
  const definitionApplyGate = useMemo(() => ({
    parseDefinition: (parsed: unknown) => {
      const result = workflowDefinitionDataSchema.safeParse(parsed)
      if (result.success) return { ok: true as const, definition: result.data as WorkflowDefinitionData }
      return {
        ok: false as const,
        messages: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      }
    },
    // Warnings never block, exactly as they never block a Save; only graph
    // ERRORS do, because a canvas holding a graph the engine rejects is worse
    // than no apply — the author has lost the text they typed.
    // `autoLayout: false` on purpose: whether a definition is VALID cannot
    // depend on running a layout engine over it, and skipping dagre keeps this
    // memo cheap enough to run on every keystroke.
    validateGraph: (definition: WorkflowDefinitionData) => {
      const graph = definitionToGraph(definition, { autoLayout: false })
      return validateWorkflowGraph(graph.nodes, graph.edges)
        .filter((issue) => issue.type === 'error')
        .map((issue) => issue.message)
    },
  }), [])

  const codeApplyDecision = useMemo(
    () => evaluateCodeViewDraft<WorkflowDefinitionData>({
      draftText: codeDraftText,
      canvasText: codeViewJson,
      ...definitionApplyGate,
    }),
    [codeDraftText, codeViewJson, definitionApplyGate],
  )

  const codeDraftStatus = useMemo(() => describeCodeViewDraft(codeApplyDecision), [codeApplyDecision])

  const codeIssueLocations = useMemo(() => {
    if (!showCodeView) return { severityByLine: new Map<number, 'error' | 'warning'>(), lineByIssueId: new Map<string, number>() }
    let parsed: unknown
    try {
      parsed = JSON.parse(codeDraftText)
    } catch {
      // Unparseable text has no entity positions to point at; the parse-error
      // line is marked on its own by `codeDraftStatus`.
      return { severityByLine: new Map<number, 'error' | 'warning'>(), lineByIssueId: new Map<string, number>() }
    }
    const locations = locateDefinitionJsonEntities(codeDraftText, parsed)
    const located = locateIssues(codeViewIssues, locations)
    return {
      severityByLine: severityByLine(located),
      lineByIssueId: new Map(located.map((issue) => [issue.issueId, issue.line])),
    }
  }, [showCodeView, codeDraftText, codeViewIssues])

  // Replace the whole editor document from a validated definition, as ONE undo
  // entry named `label`. Shared by the Code view's Apply and the AI draft's
  // Apply so a twenty-node generation is exactly as reversible as a paste.
  const applyDefinitionDocument = useCallback((definition: WorkflowDefinitionData, label: string) => {
    // Committed BEFORE the replacement, so undo restores the graph AND the
    // panel fields the applied definition also carried.
    commitHistory(label)
    const graph = definitionToGraph(definition, { autoLayout: true })
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setTriggers(definition.triggers ?? [])
    // The zod-parsed shapes leave the optional field flags optional; the editor
    // state types have them resolved. The same narrowing the draft-restore path
    // uses applies here.
    setContextSchema(definition.contextSchema as WorkflowContextSchema | undefined)
    setDefinitionIo(definition.io as WorkflowIoContract | undefined)
    setInterpolation(definition.interpolation)
    setErrorHandler(definition.errorHandler)
    scheduleAutosave()
  }, [commitHistory, scheduleAutosave])

  const handleApplyCodeDraft = useCallback(() => {
    if (!codeApplyDecision.ok) return
    applyDefinitionDocument(codeApplyDecision.definition, historyLabels.applyCode)
    setCodeDraft(null)
    flash(t('workflows.visualEditor.codeView.applied'), 'success')
  }, [codeApplyDecision, applyDefinitionDocument, historyLabels.applyCode, t])

  // ---------------------------------------------------------------------
  // Prompt-to-draft (spec §9)
  //
  // The generated definition NEVER reaches the canvas by a path of its own: it
  // goes through `evaluateCodeViewDraft`, the same gate a pasted definition
  // passes, and lands through `applyDefinitionDocument`, the same replacement
  // the Code view's Apply performs. So a refused draft leaves the canvas
  // byte-identical, and an applied one — however many nodes it minted — is ONE
  // named entry on the existing undo stack.
  //
  // Nothing here writes to the server. The route that generated the draft
  // persisted nothing either; Save and Enable stay exactly where they were.
  // ---------------------------------------------------------------------
  const [showAiDraft, setShowAiDraft] = useState(false)
  const [problemsPassToken, setProblemsPassToken] = useState(0)

  // The pass has to observe the APPLIED graph, and `evaluateWorkflowIssues`
  // closes over the node/edge state, so it runs on the commit after the apply
  // rather than inside it. The ref keeps it the page's ONE evaluator.
  const runProblemsPassRef = React.useRef(runProblemsPass)
  runProblemsPassRef.current = runProblemsPass
  useEffect(() => {
    if (problemsPassToken === 0) return
    runProblemsPassRef.current()
  }, [problemsPassToken])

  const handleApplyAiDraft = useCallback((input: {
    definition: Record<string, unknown>
    prompt: string
  }): WorkflowAiDraftApplyRefusal | null => {
    const decision = evaluateCodeViewDraft<WorkflowDefinitionData>({
      // Serialized so the AI path and the Code view path are literally the same
      // call. It also proves the draft survives the JSON round trip the Code
      // view and every save will put it through.
      draftText: JSON.stringify(input.definition, null, 2),
      ...definitionApplyGate,
    })

    if (!decision.ok) {
      switch (decision.reason) {
        case 'parseError':
          return { reason: 'parseError', messages: [decision.message] }
        case 'schemaError':
        case 'graphError':
          return { reason: decision.reason, messages: decision.messages }
        default:
          // `unchanged` cannot occur — no `canvasText` is supplied — but a
          // refusal must never fall through into a silent apply.
          return {
            reason: 'schemaError',
            messages: [t('workflows.aiDraft.refusedUnknown', 'The generated definition was refused.')],
          }
      }
    }

    applyDefinitionDocument(
      decision.definition,
      buildAiCheckpointLabel(input.prompt, {
        prefix: t('workflows.visualEditor.history.aiDraft', 'AI draft'),
      }),
    )
    setProblemsPassToken((token) => token + 1)
    flash(
      t('workflows.aiDraft.applied', 'AI draft applied. Review the problems, then save when you are happy with it.'),
      'success',
    )
    return null
  }, [definitionApplyGate, applyDefinitionDocument, t])

  const handleRevertCodeDraft = useCallback(() => {
    setCodeDraft(null)
  }, [])

  // Closing the panel discards an unapplied draft: keeping it would let the
  // author reopen the view onto text that no longer describes the canvas, with
  // no signal that the two had diverged.
  const handleCloseCodeView = useCallback(() => {
    setCodeDraft(null)
    setShowCodeView(false)
  }, [])

  const handleCopyDefinitionJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeViewJson)
      flash(t('workflows.visualEditor.codeView.copied', 'Definition JSON copied'), 'success')
    } catch (error) {
      logger.warn('Workflow definition JSON copy was blocked by the browser', { err: error })
      flash(
        t(
          'workflows.visualEditor.codeView.copyUnavailable',
          'The browser blocked clipboard access, so nothing was copied — select the JSON and copy it manually.',
        ),
        'warning',
      )
    }
  }, [codeViewJson, t])

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
    // Validate required fields. They live in the details drawer, so open it —
    // an error toast pointing at fields the author cannot see is a dead end.
    if (!workflowId || !workflowName) {
      setMetadataOpen(true)
      flash(t('workflows.visualEditor.metadata.requiredFields', 'Workflow ID and name are required.'), 'error')
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
        ...collectContextRefWarnings(definitionData, t, triggerPayloadContracts),
      ],
      nodes,
      edges,
      definition: definitionData,
      ledger: computeClientContextLedger(definitionData, triggerPayloadContracts),
      translate: translateIssue,
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

      const metadataPayload = buildMetadataPayload({ loadedMetadata, tags, category, icon, definition: definitionData, annotations })

      // Determine if creating new or updating existing
      const isUpdate = !!definitionId

      let result
      let updateBody: DefinitionUpdateBody | null = null
      if (isUpdate) {
        // Update existing definition — send the full editable payload so metadata
        // edits (name, description, version, category, tags, icon, effective
        // dates) actually persist. Previously only `definition` + `enabled`
        // were sent, silently dropping every other field.
        updateBody = {
          workflowName,
          description: description || null,
          version,
          definition: definitionData,
          metadata: metadataPayload,
          enabled,
          effectiveFrom: effectiveFrom || null,
          effectiveTo: effectiveTo || null,
        }
        result = await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(updatedAt),
          () => apiCall<{ data: any; error?: string }>(`/api/workflows/definitions/${definitionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateBody),
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
        const activeInstanceCount = readStructuralEditConflictCount(result.status, result.result)
        if (activeInstanceCount !== null && updateBody) {
          setStructuralConflict({ activeInstanceCount, payload: updateBody })
          return
        }
        const conflictError = Object.assign(new Error(t('workflows.messages.saveFailed', 'Failed to save')), {
          status: result.status,
          ...(result.result && typeof result.result === 'object' ? result.result : {}),
        })
        if (!surfaceRecordConflict(conflictError, t)) {
          flash(formatWorkflowValidationError(result.result, t('workflows.messages.saveFailed', 'Failed to save')), 'error')
        }
        return
      }

      setStructuralConflict(null)
      if (updateBody) lastAutosavedBodyRef.current = stableSerializeDefinition(updateBody)

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
  }, [nodes, edges, workflowId, workflowName, description, version, enabled, category, tags, icon, effectiveFrom, effectiveTo, triggers, contextSchema, definitionIo, interpolation, errorHandler, loadedMetadata, annotations, definitionId, updatedAt, router, t])

  // ── Non-pointer authoring path (spec §4.6) ────────────────────────────────
  // Every canvas operation is reachable from the keyboard: the command palette
  // reaches all of them, and the direct bindings below cover the ones an author
  // performs constantly (open, delete, nudge).

  const focusNode = useCallback((nodeId: string) => {
    focusRequestRef.current += 1
    setFocusTarget({ nodeId, requestId: focusRequestRef.current })
  }, [])

  const openSelectedInspector = useCallback(() => {
    const selected = nodesRef.current.find((node) => node.selected)
    if (!selected) {
      const selectedEdgeNode = edgesRef.current.find((edge) => edge.selected)
      if (!selectedEdgeNode || isCodeOnly) return
      setSelectedEdge(selectedEdgeNode)
      setSelectedNode(null)
      setEdgeDialogFocusFieldId(null)
      setShowEdgeDialog(true)
      return
    }
    handleNodeClick({} as React.MouseEvent, selected)
  }, [isCodeOnly, handleNodeClick])

  // Del removes whatever is selected. Each removal runs its own confirm +
  // cleanup flow, so a multi-selection deletes exactly as clicking each trash
  // button would — and each one is undoable.
  const handleDeleteSelection = useCallback(async () => {
    if (isCodeOnly) return
    const nodeIds = selectedNodeIds(nodesRef.current)
    const edgeIds = edgesRef.current.filter((edge) => edge.selected).map((edge) => edge.id)
    if (nodeIds.length === 0 && edgeIds.length === 0) {
      flash(t('workflows.visualEditor.keyboard.nothingSelected', 'Select a step or a route first'), 'info')
      return
    }
    for (const edgeId of edgeIds) await handleDeleteEdge(edgeId)
    for (const nodeId of nodeIds) await handleDeleteNode(nodeId)
  }, [isCodeOnly, handleDeleteEdge, handleDeleteNode, t])

  // Arrow-key nudging follows the drag rule (#4248): a burst of keystrokes is
  // ONE arrangement, so the baseline is captured on the first press and the undo
  // entry plus the autosave land once the burst settles.
  const nudgeBaselineRef = React.useRef<WorkflowEditorDocument | null>(null)
  const nudgeCommitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleNudge = useCallback((key: string, coarse: boolean) => {
    if (isCodeOnly) return false
    const direction = resolveNudgeDirection(key)
    if (!direction) return false
    if (selectedNodeIds(nodesRef.current).length === 0) return false
    if (!nudgeBaselineRef.current) nudgeBaselineRef.current = captureDocument()
    setNodes((nds) => nudgeSelectedNodes(nds, nudgeOffset(direction, coarse)))
    if (nudgeCommitTimerRef.current) clearTimeout(nudgeCommitTimerRef.current)
    nudgeCommitTimerRef.current = setTimeout(() => {
      nudgeCommitTimerRef.current = null
      const baseline = nudgeBaselineRef.current
      nudgeBaselineRef.current = null
      if (baseline) commitCapturedDocument(baseline, historyLabels.move)
      scheduleAutosave()
    }, NUDGE_COMMIT_DELAY_MS)
    return true
  }, [isCodeOnly, captureDocument, commitCapturedDocument, historyLabels.move, scheduleAutosave])

  useEffect(() => () => {
    if (nudgeCommitTimerRef.current) clearTimeout(nudgeCommitTimerRef.current)
  }, [])

  const commandPaletteCommands = useMemo<WorkflowEditorCommand[]>(() => buildWorkflowEditorCommands({
    readOnly: isCodeOnly,
    canUndo: canUndoEditorHistory(history),
    canRedo: canRedoEditorHistory(history),
    hasNodes: nodes.length > 0,
    hasSelection: nodes.some((node) => node.selected) || edges.some((edge) => edge.selected),
    canRunTest: !!definitionId,
    stepTypes: PALETTE_NODE_TYPES.map((nodeType) => ({
      nodeType,
      typeLabel: NODE_TYPE_LABELS[nodeType]?.title ?? nodeType,
    })),
    steps: nodes
      .filter((node) => !isAnnotationNode(node))
      .map((node) => ({
        id: node.id,
        label: typeof node.data?.label === 'string' && node.data.label ? node.data.label : node.id,
        typeLabel: NODE_TYPE_LABELS[(node.type ?? '') as keyof typeof NODE_TYPE_LABELS]?.title ?? node.type ?? '',
      })),
    labels: {
      undo: t('workflows.commandPalette.undo', 'Undo'),
      redo: t('workflows.commandPalette.redo', 'Redo'),
      deleteSelection: t('workflows.commandPalette.delete', 'Delete selection'),
      copy: t('workflows.commandPalette.copy', 'Copy selection'),
      paste: t('workflows.commandPalette.paste', 'Paste'),
      duplicate: t('workflows.commandPalette.duplicate', 'Duplicate selection'),
      addStep: (typeLabel: string) => t('workflows.commandPalette.addStep', 'Add step: {type}', { type: typeLabel }),
      addNote: t('workflows.commandPalette.addNote', 'Add note'),
      addGroup: t('workflows.commandPalette.addGroup', 'Add group'),
      goToStep: t('workflows.commandPalette.goToStep', 'Go to step'),
      tidy: t('workflows.visualEditor.autoArrange'),
      togglePalette: t('workflows.commandPalette.togglePalette', 'Toggle the step palette'),
      toggleMetadata: t('workflows.commandPalette.toggleMetadata', 'Toggle the workflow details panel'),
      toggleFocus: t('workflows.commandPalette.toggleFocus', 'Toggle focus mode'),
      toggleProblems: t('workflows.commandPalette.toggleProblems', 'Toggle the Problems panel'),
      toggleCodeView: t('workflows.commandPalette.toggleCodeView', 'Toggle the Code view'),
      toggleCompensation: t('workflows.commandPalette.toggleCompensation', 'Toggle compensation paths'),
      validate: t('workflows.visualEditor.validate'),
      runTest: t('workflows.actions.startInstance'),
      save: t('workflows.common.save'),
      aiDraft: t('workflows.aiDraft.open', 'Draft this workflow with AI'),
    },
    actions: {
      undo: handleUndo,
      redo: handleRedo,
      deleteSelection: () => { void handleDeleteSelection() },
      copy: () => { void handleCopySelection() },
      paste: () => { void handlePaste() },
      duplicate: handleDuplicateSelection,
      addStep: (nodeType: string) => handleAddNode(nodeType),
      addNote: () => handleAddAnnotation('note'),
      addGroup: () => handleAddAnnotation('group'),
      goToStep: focusNode,
      tidy: handleAutoArrange,
      togglePalette: togglePaletteCollapsed,
      toggleMetadata: () => setMetadataOpen((open) => !open),
      toggleFocus,
      toggleProblems: () => setShowProblems((visible) => !visible),
      toggleCodeView: () => setShowCodeView((visible) => !visible),
      toggleCompensation,
      validate: handleValidate,
      runTest: () => setStartOpen(true),
      save: () => { void handleSave() },
      aiDraft: () => setShowAiDraft(true),
    },
  }), [
    isCodeOnly, history, nodes, edges, definitionId, t,
    handleUndo, handleRedo, handleDeleteSelection, handleCopySelection, handlePaste, handleDuplicateSelection,
    handleAddNode, handleAddAnnotation, focusNode, handleAutoArrange, togglePaletteCollapsed, toggleFocus,
    toggleCompensation, handleValidate, handleSave,
  ])

  // Keyboard shortcuts: Cmd/Ctrl+K opens the command palette, Cmd/Ctrl+Z undoes,
  // Cmd/Ctrl+Shift+Z redoes, Cmd/Ctrl+C, +V and +D copy, paste and duplicate the
  // selected subgraph, Enter opens the inspector for the selection, Del removes
  // it, the arrows nudge it, `F` toggles Focus mode and `Esc` exits it.
  //
  // Everything except the palette is suppressed while the user is typing in a
  // field (a text input keeps its own native undo, copy/paste and caret keys) or
  // while a dialog is open, so a shortcut never hijacks form input or the
  // dialog's own Escape-to-close. Cmd+K is deliberately exempt from the typing
  // guard: it is the way out of any focus, which is the whole point of a palette.
  useEffect(() => {
    if (isMobile) return
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null
      const tag = (active?.tagName || '').toLowerCase()
      const isEditing = tag === 'input' || tag === 'textarea' || tag === 'select' || !!active?.isContentEditable
      // Docking is a SPATIAL change, not a keyboard one: an open inspector
      // still owns the shortcuts, because it holds a form with unsaved values
      // and every canvas binding here either mutates the document under it
      // (undo, delete, paste) or would save a graph that omits the edit sitting
      // in the rail. What docking buys is that the canvas stays visible and
      // clickable — re-targeting is a click, and Escape closes the rail.
      const isInspectorOpen = showNodeDialog || showEdgeDialog
      const isDialogOpen = isInspectorOpen || showAnnotationDialog || showClearConfirm || startOpen || showCodeView
      // The details drawer is a modal overlay, so the canvas bindings must not
      // fire behind it. Cmd+S is the deliberate exception: the drawer has no
      // submit of its own to protect — saving the workflow IS its primary
      // action — so the shortcut keeps working while it is open.
      const isOverlayOpen = isDialogOpen || metadataOpen || showAiDraft
      const isCommandKey = (event.metaKey || event.ctrlKey) && !event.altKey

      if (isCommandKey && (event.key === 'k' || event.key === 'K')) {
        if (isOverlayOpen) return
        event.preventDefault()
        setShowCommandPalette((open) => !open)
        return
      }
      if (isCommandKey && !event.shiftKey && (event.key === 's' || event.key === 'S')) {
        if (isDialogOpen || isCodeOnly) return
        event.preventDefault()
        void handleSave()
        return
      }
      if (isEditing || showCommandPalette) return

      if (isCommandKey && (event.key === 'z' || event.key === 'Z')) {
        if (isOverlayOpen) return
        event.preventDefault()
        if (event.shiftKey) handleRedo()
        else handleUndo()
        return
      }
      if (isCommandKey && !event.shiftKey && !isOverlayOpen) {
        if (event.key === 'c' || event.key === 'C') {
          event.preventDefault()
          void handleCopySelection()
          return
        }
        if (event.key === 'v' || event.key === 'V') {
          event.preventDefault()
          void handlePaste()
          return
        }
        if (event.key === 'd' || event.key === 'D') {
          event.preventDefault()
          handleDuplicateSelection()
          return
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        // Escape raised inside the rail is claimed by the rail itself. Reaching
        // here means focus is on the canvas, where Escape should still close the
        // inspector before it falls through to leaving Focus mode.
        if (inspectorsDocked && isInspectorOpen) {
          event.preventDefault()
          setShowNodeDialog(false)
          setShowEdgeDialog(false)
          return
        }
        if (focusMode && !isOverlayOpen) {
          event.preventDefault()
          setFocusMode(false)
        }
        return
      }
      if (isOverlayOpen) return
      if (event.key === 'Enter') {
        event.preventDefault()
        openSelectedInspector()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        void handleDeleteSelection()
        return
      }
      if (resolveNudgeDirection(event.key)) {
        if (handleNudge(event.key, event.shiftKey)) event.preventDefault()
        return
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault()
        toggleFocus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    isMobile, focusMode, inspectorsDocked, showNodeDialog, showEdgeDialog, showAnnotationDialog, showClearConfirm, startOpen,
    showCodeView, metadataOpen, showAiDraft, showCommandPalette, toggleFocus, setFocusMode, handleUndo, handleRedo, handleCopySelection, handlePaste,
    handleDuplicateSelection, openSelectedInspector, handleDeleteSelection, handleNudge,
    handleSave, isCodeOnly,
  ])

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

    const metadataPayload = buildMetadataPayload({ loadedMetadata, tags, category, icon, definition: definitionData, annotations })

    const updateBody: DefinitionUpdateBody = {
      workflowName,
      description: description || null,
      version,
      definition: definitionData,
      metadata: metadataPayload,
      enabled,
      effectiveFrom: effectiveFrom || null,
      effectiveTo: effectiveTo || null,
    }

    // Autosave only when the payload actually differs from what the row already
    // holds. Without this a selection or a re-render would PUT an identical body
    // and bump the optimistic-lock token for nothing.
    const serializedBody = stableSerializeDefinition(updateBody)
    if (serializedBody === lastAutosavedBodyRef.current) return
    lastAutosavedBodyRef.current = serializedBody

    setAutosaveState('saving')
    try {
      const result = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(updatedAt),
        () => apiCall<{ data: any; error?: string }>(`/api/workflows/definitions/${definitionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateBody),
        }),
      )

      if (!result.ok) {
        setAutosaveState('idle')
        lastAutosavedBodyRef.current = null
        // A quiet autosave carrying a structural change hits the same edit-safety
        // rule as Save. Surfacing the banner here keeps the author from watching
        // "Saved" never appear with no explanation.
        const activeInstanceCount = readStructuralEditConflictCount(result.status, result.result)
        if (activeInstanceCount !== null) {
          setStructuralConflict({ activeInstanceCount, payload: updateBody })
          return
        }
        const conflictError = Object.assign(new Error('[internal] workflow autosave failed'), {
          status: result.status,
          ...(result.result && typeof result.result === 'object' ? result.result : {}),
        })
        surfaceRecordConflict(conflictError, t)
        return
      }

      setStructuralConflict(null)

      const savedDefinition = result.result?.data
      if (typeof savedDefinition?.updatedAt === 'string') {
        setUpdatedAt(savedDefinition.updatedAt)
      }
      setAutosaveState('saved')
    } catch (error) {
      console.error('[internal] workflow autosave failed', error)
      lastAutosavedBodyRef.current = null
      setAutosaveState('idle')
    }
  }

  // Fade the "Saved" affordance back to idle shortly after a successful autosave.
  useEffect(() => {
    if (autosaveState !== 'saved') return
    const timer = setTimeout(() => setAutosaveState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [autosaveState])

  // Remedy for the edit-safety rule: mint the next version from the stored
  // definition (the same machinery Publish uses), apply the rejected edit to
  // that fresh row, and continue editing it. Instances that pinned the previous
  // row keep executing the definition they started on.
  const handleCreateVersion = useCallback(async () => {
    if (!definitionId || !structuralConflict) return
    setIsCreatingVersion(true)
    try {
      const publishResult = await apiCall<{ data?: { id?: string; version?: number; updatedAt?: string }; error?: string }>(
        `/api/workflows/definitions/${definitionId}/publish`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      )
      const mintedVersion = publishResult.result?.data
      if (!publishResult.ok || !mintedVersion?.id) {
        flash(
          publishResult.result?.error
            || t('workflows.visualEditor.editSafety.createVersionFailed', 'Could not create a new version.'),
          'error',
        )
        return
      }

      const nextVersion = mintedVersion.version ?? version
      const saveResult = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(mintedVersion.updatedAt ?? null),
        () => apiCall<{ data?: { updatedAt?: string }; error?: string }>(
          `/api/workflows/definitions/${mintedVersion.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...structuralConflict.payload, version: nextVersion }),
          },
        ),
      )
      if (!saveResult.ok) {
        flash(
          formatWorkflowValidationError(
            saveResult.result,
            t('workflows.visualEditor.editSafety.createVersionFailed', 'Could not create a new version.'),
          ),
          'error',
        )
        return
      }

      setStructuralConflict(null)
      setVersion(nextVersion)
      setUpdatedAt(saveResult.result?.data?.updatedAt ?? null)
      flash(
        t('workflows.visualEditor.editSafety.createVersionSucceeded', 'Version {version} created. Your changes were saved there.', {
          version: String(nextVersion),
        }),
        'success',
      )
      router.replace(`/backend/definitions/visual-editor?id=${encodeURIComponent(mintedVersion.id)}`)
    } finally {
      setIsCreatingVersion(false)
    }
  }, [definitionId, structuralConflict, version, router, t])

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
              ...(startDryRun ? { dryRun: true } : {}),
              ...(startStepThrough ? { stepThrough: true } : {}),
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
  }, [startContext, startDryRun, startStepThrough, workflowId, version, definitionId, mutationContextId, retryLastMutation, router, t])

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
    resetHistory()
    flash(t('workflows.visualEditor.templateLoaded', 'Template loaded'), 'success')
  }, [resetHistory, t])

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
    resetHistory()
    flash('Canvas cleared', 'success')
  }, [resetHistory])

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
    contextSchema, interpolation, errorHandler,
  }

  const metadataHandlers: WorkflowMetadataHandlers = {
    setWorkflowId, setWorkflowName, setDescription, setVersion,
    setEnabled, setCategory, setTags, setIcon,
    setEffectiveFrom, setEffectiveTo, setTriggers,
    setContextSchema,
    setInterpolation,
    setErrorHandler: (next) => setErrorHandler(next ?? undefined),
  }

  // The required identity fields now live behind the details drawer, so the
  // toolbar has to say when they are still blank.
  const metadataIncomplete = !isCodeOnly && (!workflowId || !workflowName)

  const inspectorPanels = (
    <>
      {crudFormDialogsEnabled ? (
        <NodeEditDialogCrudForm node={selectedNode} isOpen={showNodeDialog} onClose={() => setShowNodeDialog(false)} onSave={handleSaveNode} onDelete={handleDeleteNode} ledgerEntries={nodeDialogLedgerEntries} definitionId={definitionId} samples={editorSamples} onPinSample={handlePinSample} onUnpinSample={handleUnpinSample} branchingRoutes={branchingRoutesValue} onSaveBranchingRoutes={handleSaveBranchingRoutes} routeOrder={routeOrderValue} onSaveRouteOrder={handleSaveRouteOrder} onConvertType={handleConvertNodeType} variant={inspectorVariant} />
      ) : (
        <NodeEditDialog node={selectedNode} isOpen={showNodeDialog} onClose={() => setShowNodeDialog(false)} onSave={handleSaveNode} onDelete={handleDeleteNode} />
      )}
      {crudFormDialogsEnabled ? (
        <EdgeEditDialogCrudForm edge={selectedEdge} isOpen={showEdgeDialog} onClose={() => setShowEdgeDialog(false)} onSave={handleSaveEdge} onDelete={handleDeleteEdge} ledgerEntries={edgeDialogLedgerEntries} focusFieldId={edgeDialogFocusFieldId} variant={inspectorVariant} />
      ) : (
        <EdgeEditDialog edge={selectedEdge} isOpen={showEdgeDialog} onClose={() => setShowEdgeDialog(false)} onSave={handleSaveEdge} onDelete={handleDeleteEdge} />
      )}
    </>
  )

  const sharedDialogs = (
    <>
      {/* Docked inspectors render inside the editor's layout row instead, so
          they shrink the canvas rather than covering it. */}
      {inspectorsDocked ? null : inspectorPanels}
      <WorkflowCommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        commands={commandPaletteCommands}
      />
      <DefinitionMetadataDrawer
        open={metadataOpen}
        onOpenChange={handleMetadataOpenChange}
        focusSection={metadataFocusSection}
        definitionId={definitionId}
        readOnly={isCodeOnly}
        metadata={metadata}
        handlers={metadataHandlers}
        errorHandlerStepOptions={errorHandlerStepOptions}
        onSave={() => { void handleSave() }}
        isSaving={isSaving}
      />
      <WorkflowCodeView
        isOpen={showCodeView}
        onClose={handleCloseCodeView}
        definitionJson={codeViewJson}
        issues={codeViewIssues}
        onCopy={() => { void handleCopyDefinitionJson() }}
        onPasteSubgraph={() => { void handlePaste() }}
        canPaste={!isCodeOnly}
        onIssueClick={handleProblemClick}
        draftText={codeDraftText}
        onDraftChange={setCodeDraft}
        onApply={handleApplyCodeDraft}
        onRevert={handleRevertCodeDraft}
        draftStatus={codeDraftStatus}
        severityByLine={codeIssueLocations.severityByLine}
        lineByIssueId={codeIssueLocations.lineByIssueId}
      />
      <WorkflowAiDraftDialog
        open={showAiDraft}
        onOpenChange={setShowAiDraft}
        onApply={handleApplyAiDraft}
        canvasHasContent={nodes.length > 0}
      />
      <AnnotationEditDialog
        node={selectedAnnotation}
        isOpen={showAnnotationDialog}
        onClose={() => setShowAnnotationDialog(false)}
        onSave={handleSaveAnnotation}
        onDelete={handleDeleteAnnotation}
      />
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
          <div className="space-y-3 px-1 py-2">
            <p className="text-xs text-muted-foreground">{t('workflows.startInstance.description')}</p>

            {startFixtureList.length > 0 ? (
              <div className="space-y-1">
                <span className="text-overline text-muted-foreground">{t('workflows.fixtures.label')}</span>
                <div className="flex flex-wrap gap-1">
                  {startFixtureList.map((fixture) => (
                    <span key={fixture.name} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1">
                      <button
                        type="button"
                        className="text-xs font-medium hover:underline"
                        onClick={() => handleApplyFixture(fixture.name)}
                      >
                        {fixture.name}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        aria-label={t('workflows.fixtures.delete', { name: fixture.name })}
                        onClick={() => handleDeleteFixture(fixture.name)}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="text-sm font-medium" htmlFor="workflow-start-context">
              {t('workflows.startInstance.contextLabel')}
            </label>
            <Textarea
              id="workflow-start-context"
              value={startContext}
              onChange={(e) => setStartContext(e.target.value)}
              rows={9}
              spellCheck={false}
              className="font-mono text-sm"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void handleStartInstance()
                }
              }}
            />

            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="workflow-fixture-name" className="text-xs">
                  {t('workflows.fixtures.nameLabel')}
                </Label>
                <Input
                  id="workflow-fixture-name"
                  value={fixtureName}
                  onChange={(e) => setFixtureName(e.target.value)}
                  placeholder={t('workflows.fixtures.namePlaceholder')}
                />
              </div>
              <Button variant="outline" onClick={handleSaveFixture} disabled={!fixtureName.trim()}>
                {t('workflows.fixtures.save')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('workflows.fixtures.storageWarning')}</p>

            <div className="space-y-2 rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="workflow-start-dry-run" className="text-sm font-medium">
                  {t('workflows.startInstance.dryRunLabel')}
                </Label>
                <Switch
                  id="workflow-start-dry-run"
                  checked={startDryRun}
                  onCheckedChange={(checked) => setStartDryRun(checked === true)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('workflows.startInstance.dryRunHint')}</p>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="workflow-start-step-through" className="text-sm font-medium">
                  {t('workflows.startInstance.stepThroughLabel')}
                </Label>
                <Switch
                  id="workflow-start-step-through"
                  checked={startStepThrough}
                  onCheckedChange={(checked) => setStartStepThrough(checked === true)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('workflows.startInstance.stepThroughHint')}</p>
            </div>
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

  const structuralConflictBanner = structuralConflict ? (
    <div className="shrink-0 border-b border-border bg-background px-3 py-2 md:px-6 md:py-3">
      <Alert variant="warning">
        <AlertTitle>
          {t('workflows.visualEditor.editSafety.bannerTitle', 'This change needs a new version')}
        </AlertTitle>
        <AlertDescription>
          {t(
            'workflows.visualEditor.editSafety.bannerDescription',
            '{count} instance(s) are still running on this version. Changing the steps or routes would re-point them mid-flight, so the change is saved to a new version instead.',
            { count: String(structuralConflict.activeInstanceCount) },
          )}
        </AlertDescription>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={handleCreateVersion} disabled={isCreatingVersion} className="h-8 text-xs">
            {t('workflows.visualEditor.editSafety.createVersion', 'Create version')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStructuralConflict(null)}
            disabled={isCreatingVersion}
            className="h-8 text-xs"
          >
            {t('workflows.visualEditor.editSafety.keepEditing', 'Keep editing')}
          </Button>
        </div>
      </Alert>
    </div>
  ) : null

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
        {structuralConflictBanner}
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
          onReconnect={handleReconnect}
          onAddNode={handleAddNode}
          onSave={handleSave}
          onValidate={handleValidate}
          onStartInstance={() => setStartOpen(true)}
          onLoadExample={handleOpenTemplateGallery}
          onClear={handleClear}
          metadata={metadata}
          onMetadataOpenChange={handleMetadataOpenChange}
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
              {/* The palette is the non-pointer authoring path (spec §4.6); the
                  button is how a pointer user discovers the shortcut exists. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCommandPalette(true)}
                className="h-8 px-2 text-xs"
                aria-label={t('workflows.commandPalette.open', 'Commands (Cmd+K)')}
              >
                <Command className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('workflows.commandPalette.buttonLabel', 'Commands')}
              </Button>
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
              {/* Details drawer trigger. When the required id/name are still
                  blank it carries a marker — the fields are behind an overlay
                  now, so their absence has to be visible from the toolbar and
                  not only after a refused save. Shape + text, never colour
                  alone (spec §4.6). */}
              <Button
                variant="outline"
                size="sm"
                data-testid="workflow-details-trigger"
                onClick={() => setMetadataOpen(true)}
                disabled={isSaving}
                className="h-8 px-2 text-xs"
                aria-label={metadataIncomplete
                  ? `${t('workflows.visualEditor.metadata.open')} — ${t('workflows.visualEditor.metadata.requiredFields')}`
                  : t('workflows.visualEditor.metadata.open')}
              >
                <PanelRightOpen className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('workflows.visualEditor.metadata.buttonLabel')}
                {metadataIncomplete && (
                  <>
                    <TriangleAlert className="ml-1.5 h-3.5 w-3.5 text-status-warning-text" aria-hidden="true" />
                    <span className="sr-only">{t('workflows.visualEditor.metadata.requiredFields')}</span>
                  </>
                )}
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
              {/* Prompt-to-draft (spec §9). Offered for every author who can
                  create definitions; the route 403s otherwise and the dialog
                  says so rather than the button quietly doing nothing. */}
              {!isCodeOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAiDraft(true)}
                  className="h-8 px-2 text-xs"
                  aria-label={t('workflows.aiDraft.open', 'Draft this workflow with AI')}
                >
                  <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('workflows.aiDraft.toggleShort', 'AI draft')}
                </Button>
              )}
              {/* Code view (spec §2.2): read-only definition JSON plus the
                  schema-validation display — the retirement precondition for
                  the form editor. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCodeView(true)}
                className="h-8 px-2 text-xs"
                aria-label={t('workflows.visualEditor.codeView.open', 'Show the definition JSON')}
              >
                <Code className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('workflows.visualEditor.codeView.title', 'Code')}
              </Button>
              {/* Compensation ghosts (spec §4.4): a read-only overlay of the
                  undo paths a failure would walk. Never an engine change. */}
              <Button
                variant="outline"
                size="sm"
                onClick={toggleCompensation}
                aria-pressed={showCompensation}
                className="h-8 px-2 text-xs"
                aria-label={t('workflows.compensation.toggle', 'Show compensation paths')}
              >
                <ShieldMinus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('workflows.compensation.toggleShort', 'Compensation')}
              </Button>
              {/* Execution overlay (spec §8.3): "Show last run" paints node
                  states with DS status tokens and the taken path. Read-only —
                  derived at render time, never part of the document. */}
              {definitionId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleLastRun}
                  aria-pressed={showLastRun}
                  className="h-8 px-2 text-xs"
                  aria-label={t('workflows.lastRun.toggle', 'Show the last run on the canvas')}
                >
                  <History className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('workflows.lastRun.toggleShort', 'Last run')}
                  {showLastRun && lastRunOverlay.isUnavailable ? (
                    <span className="ml-1.5 text-muted-foreground">
                      {t('workflows.lastRun.never', '(never run)')}
                    </span>
                  ) : null}
                </Button>
              )}
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

      {/* Edit-safety rule: structural change refused while instances run (spec §4.1) */}
      {structuralConflictBanner}

      {/* Per-user draft restore banner (spec §4.7) */}
      {draftRestoreBanner}

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
                onReconnect={handleReconnect}
                onCanvasDrop={handleCanvasDrop}
                editable={!isCodeOnly}
                height="100%"
                focusTarget={focusTarget}
                nodeErrorCounts={nodeErrorCounts}
                showCompensation={showCompensation}
                runOverlay={lastRunOverlay.execution}
                triggers={triggers}
                definitionEnabled={enabled}
                onOpenTriggers={handleOpenTriggers}
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
                      draggable
                      onDragStart={(event) => handlePaletteStepDragStart(event, nodeType)}
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
        <div data-testid="workflow-editor-row" className="flex min-h-0 min-w-0 flex-1 border-t border-border pl-3 md:pl-6">
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
                      draggable
                      onDragStart={(event) => handlePaletteStepDragStart(event, nodeType)}
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
                    draggable
                    onDragStart={(event) => handlePaletteStepDragStart(event, nodeType)}
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

            {/* Actions (spec §4.4): drag one onto a route to append it to that
                route's activities — the chips (#4244) then render it. Clicking
                explains where the keyboard path is, so the entry is never dead. */}
            {!paletteCollapsed && (
              <div className="mt-4">
                <h2 className="mb-1 px-1 text-xs font-semibold uppercase text-muted-foreground">
                  {t('workflows.visualEditor.palette.actionsTitle', 'Actions')}
                </h2>
                <p className="mb-2 px-1 text-xs text-muted-foreground">
                  {t('workflows.visualEditor.palette.dragActionHint', 'Drop an action onto a route to add it there')}
                </p>
                <div className="flex flex-col gap-1">
                  {activityTypeOptions.map((option) => {
                    const ActionIcon = resolveActivityIcon(option.value)
                    return (
                      <button
                        key={option.value}
                        type="button"
                        draggable
                        onDragStart={(event) => handlePaletteActivityDragStart(event, option.value, option.label)}
                        onClick={() => flash(t('workflows.visualEditor.palette.dragActionHint', 'Drop an action onto a route to add it there'), 'info')}
                        title={t('workflows.visualEditor.palette.dragActionHint', 'Drop an action onto a route to add it there')}
                        className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted"
                      >
                        <ActionIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium text-foreground">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Annotations (spec §4.5): documentation only — filtered out of the
                saved definition, so they can never change what the engine runs. */}
            {!paletteCollapsed && (
              <div className="mt-4">
                <h2 className="mb-1 px-1 text-xs font-semibold uppercase text-muted-foreground">
                  {t('workflows.annotations.paletteTitle', 'Annotations')}
                </h2>
                <p className="mb-2 px-1 text-xs text-muted-foreground">
                  {t('workflows.annotations.paletteHint', 'Documentation only — never executed')}
                </p>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => handleAddAnnotation('note')}
                    title={t('workflows.annotations.note.addHint', 'Add a markdown sticky note to the canvas')}
                    className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <StickyNote className="h-4 w-4 shrink-0 text-status-warning-text" aria-hidden="true" />
                    <span className="truncate font-medium text-foreground">{t('workflows.annotations.note.add', 'Note')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddAnnotation('group')}
                    title={t('workflows.annotations.group.addHint', 'Add a named region around part of the canvas')}
                    className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <Group className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate font-medium text-foreground">{t('workflows.annotations.group.add', 'Group')}</span>
                  </button>
                </div>
              </div>
            )}

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
                        <li>{t('workflows.visualEditor.hint.dragFromPalette', 'Drag a step onto the canvas, or onto a route to insert it there')}</li>
                        <li>{t('workflows.visualEditor.hint.dragSteps', 'Drag steps to position them')}</li>
                        <li>{t('workflows.visualEditor.hint.connectSteps', 'Connect steps by dragging from handles')}</li>
                        <li>{t('workflows.visualEditor.hint.editSteps', 'Click steps and transitions to edit them')}</li>
                        <li>{t('workflows.visualEditor.hint.copyPaste', 'Select steps and copy, paste or duplicate them with Cmd/Ctrl+C, +V and +D')}</li>
                        <li>{t('workflows.visualEditor.hint.commandPalette', 'Press Cmd/Ctrl+K for every command without the mouse')}</li>
                        <li>{t('workflows.visualEditor.hint.keyboardCanvas', 'With a step selected: Enter opens it, Del removes it, arrows nudge it (hold Shift for bigger steps)')}</li>
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
                  onReconnect={handleReconnect}
                  onCanvasDrop={handleCanvasDrop}
                  editable={!isCodeOnly}
                  height="100%"
                  focusTarget={focusTarget}
                  nodeErrorCounts={nodeErrorCounts}
                  showCompensation={showCompensation}
                  runOverlay={lastRunOverlay.execution}
                  triggers={triggers}
                  definitionEnabled={enabled}
                  onOpenTriggers={handleOpenTriggers}
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

          {/* Docked step / route inspector (spec §4.1). It is a sibling of the
              canvas, not an overlay on it, so opening it narrows the graph and
              leaves it visible and clickable. */}
          {inspectorsDocked ? inspectorPanels : null}
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
