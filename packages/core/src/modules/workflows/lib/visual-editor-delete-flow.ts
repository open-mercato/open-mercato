import type { Node, Edge } from '@xyflow/react'

export type ConfirmFn = (options: {
  title: string
  text: string
  variant?: 'default' | 'destructive'
}) => Promise<boolean>

export type DeleteNodeDeps = {
  nodes: Node[]
  confirm: ConfirmFn
  t: (key: string, paramsOrFallback?: any, fallback?: any) => string
  setShowNodeDialog: (open: boolean) => void
  setSelectedNode: (node: Node | null) => void
  setNodes: (updater: (nds: Node[]) => Node[]) => void
  setEdges: (updater: (eds: Edge[]) => Edge[]) => void
  notifyDeleted: () => void
}

export type DeleteEdgeDeps = {
  confirm: ConfirmFn
  t: (key: string, paramsOrFallback?: any, fallback?: any) => string
  setShowEdgeDialog: (open: boolean) => void
  setSelectedEdge: (edge: Edge | null) => void
  setEdges: (updater: (eds: Edge[]) => Edge[]) => void
  notifyDeleted: () => void
}

/**
 * Runs the step-delete confirmation flow.
 *
 * Why: The edit dialog is a Radix modal; the confirm dialog is a native
 * <dialog> in the browser top layer. If we await confirm() while the edit
 * modal is still open, Radix's onPointerDownOutside fires on the confirm
 * click and closes the edit modal mid-interaction, which leaves the
 * confirm dialog stuck open and requires a second click (issue #1585).
 *
 * We therefore close the edit dialog *before* awaiting confirmation so
 * only one modal is on screen when the user confirms.
 */
export async function performDeleteNodeFlow(nodeId: string, deps: DeleteNodeDeps): Promise<boolean> {
  const node = deps.nodes.find((n) => n.id === nodeId)
  const nodeData = node?.data as { stepName?: string; label?: string } | undefined
  const stepName = nodeData?.stepName || nodeData?.label || nodeId
  deps.setShowNodeDialog(false)
  deps.setSelectedNode(null)
  const confirmed = await deps.confirm({
    title: deps.t('workflows.confirm.deleteStepTitle'),
    text: deps.t('workflows.confirm.deleteStep', { name: stepName }),
    variant: 'destructive',
  })
  if (!confirmed) return false
  deps.setNodes((nds) => nds.filter((n) => n.id !== nodeId))
  deps.setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
  deps.notifyDeleted()
  return true
}

export async function performDeleteEdgeFlow(edgeId: string, deps: DeleteEdgeDeps): Promise<boolean> {
  deps.setShowEdgeDialog(false)
  deps.setSelectedEdge(null)
  const confirmed = await deps.confirm({
    title: deps.t('workflows.confirm.deleteTransitionTitle'),
    text: deps.t('workflows.confirm.deleteTransitionText'),
    variant: 'destructive',
  })
  if (!confirmed) return false
  deps.setEdges((eds) => eds.filter((edge) => edge.id !== edgeId))
  deps.notifyDeleted()
  return true
}
