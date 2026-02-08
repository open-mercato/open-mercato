'use client'

import { useState } from 'react'
import type { Node, Edge, NodeChange, EdgeChange, Connection } from '@xyflow/react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Save, MoreVertical, FileText, Trash2, CircleQuestionMark, Play } from 'lucide-react'
import { NODE_TYPE_ICONS, NODE_TYPE_LABELS } from '../../lib/node-type-icons'
import { WorkflowGraph } from '../WorkflowGraph'
import { MobileMetadataSheet } from './MobileMetadataSheet'
import type { WorkflowDefinitionTrigger } from '../../data/entities'

export interface MobileVisualEditorProps {
  definitionId: string | null
  isSaving: boolean
  nodes: Node[]
  edges: Edge[]
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onNodeClick: (event: React.MouseEvent, node: Node) => void
  onEdgeClick: (event: React.MouseEvent, edge: Edge) => void
  onConnect: (connection: Connection) => void
  onAddNode: (nodeType: string) => void
  onSave: () => void
  onValidate: () => void
  onTest: () => void
  onLoadExample: () => void
  onClear: () => void
  // Metadata state
  workflowId: string
  setWorkflowId: (v: string) => void
  workflowName: string
  setWorkflowName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  version: number
  setVersion: (v: number) => void
  enabled: boolean
  setEnabled: (v: boolean) => void
  category: string
  setCategory: (v: string) => void
  tags: string[]
  setTags: (v: string[]) => void
  icon: string
  setIcon: (v: string) => void
  effectiveFrom: string
  setEffectiveFrom: (v: string) => void
  effectiveTo: string
  setEffectiveTo: (v: string) => void
  triggers: WorkflowDefinitionTrigger[]
  setTriggers: (v: WorkflowDefinitionTrigger[]) => void
}

const NODE_TYPES = ['start', 'userTask', 'automated', 'waitForSignal', 'subWorkflow', 'end'] as const

export function MobileVisualEditor({
  definitionId,
  isSaving,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onEdgeClick,
  onConnect,
  onAddNode,
  onSave,
  onValidate,
  onTest,
  onLoadExample,
  onClear,
  workflowId,
  setWorkflowId,
  workflowName,
  setWorkflowName,
  description,
  setDescription,
  version,
  setVersion,
  enabled,
  setEnabled,
  category,
  setCategory,
  tags,
  setTags,
  icon,
  setIcon,
  effectiveFrom,
  setEffectiveFrom,
  effectiveTo,
  setEffectiveTo,
  triggers,
  setTriggers,
}: MobileVisualEditorProps) {
  const t = useT()
  const [showMetadata, setShowMetadata] = useState(false)
  const [showMoreActions, setShowMoreActions] = useState(false)

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between gap-1 border-b border-border bg-background px-3 py-2">
        <h1 className="truncate text-sm font-semibold">
          {definitionId ? (workflowName || t('workflows.definitions.singular')) : t('workflows.backend.definitions.visual_editor.title')}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMetadata(true)}
            className="h-8 px-2"
            aria-label={t('workflows.mobile.metadata', 'Metadata')}
          >
            <FileText className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onValidate}
            disabled={isSaving}
            className="h-8 px-2"
            aria-label={t('workflows.mobile.validate')}
          >
            <CircleQuestionMark className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={isSaving}
            className="h-8 px-2"
            aria-label={isSaving ? t('workflows.mobile.saving') : t('workflows.mobile.save')}
          >
            <Save className="h-4 w-4" />
            <span className="ml-1 text-xs">{isSaving ? '...' : definitionId ? t('workflows.common.update') : t('workflows.common.save')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setShowMoreActions(true)}
            aria-label={t('workflows.mobile.moreActions', 'More')}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="shrink-0 border-b border-border bg-background px-3 py-2">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {NODE_TYPES.map((nodeType) => {
            const Icon = NODE_TYPE_ICONS[nodeType]
            return (
              <button
                key={nodeType}
                onClick={() => onAddNode(nodeType)}
                className="flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-muted active:bg-muted/80"
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{NODE_TYPE_LABELS[nodeType].title}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <WorkflowGraph
          initialNodes={nodes}
          initialEdges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onConnect={onConnect}
          editable={true}
          height="100%"
        />

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
            <div className="text-center">
              <h2 className="mb-2 text-lg font-semibold text-foreground">{t('workflows.mobile.startBuilding', 'Start Building')}</h2>
              <p className="mb-3 text-sm text-muted-foreground">{t('workflows.mobile.startBuildingHint', 'Tap a step type above to add it')}</p>
              <button
                onClick={onLoadExample}
                className="pointer-events-auto text-sm text-primary hover:underline"
              >
                {t('workflows.mobile.loadExample', 'Load an example workflow')}
              </button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showMoreActions} onOpenChange={setShowMoreActions}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workflows.mobile.moreActions', 'More Actions')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <button
              onClick={() => { onLoadExample(); setShowMoreActions(false) }}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm hover:bg-muted active:bg-muted"
            >
              {t('workflows.mobile.loadExample', 'Load Example')}
            </button>
            <button
              onClick={() => { onTest(); setShowMoreActions(false) }}
              disabled={isSaving}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm hover:bg-muted active:bg-muted disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {t('workflows.mobile.runTest', 'Run Test')}
            </button>
            <button
              onClick={() => { onClear(); setShowMoreActions(false) }}
              disabled={isSaving}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm text-destructive hover:bg-muted active:bg-muted disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t('workflows.mobile.clear', 'Clear')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <MobileMetadataSheet
        open={showMetadata}
        onOpenChange={setShowMetadata}
        definitionId={definitionId}
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
    </div>
  )
}
