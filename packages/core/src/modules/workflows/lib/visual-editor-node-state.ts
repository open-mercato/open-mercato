import type { Node } from '@xyflow/react'

/**
 * React Flow owns transient node state such as selection and position, while the
 * workflow editor page owns node data edited in dialogs. When React Flow emits a
 * node-change snapshot from an older internal node, keep the page-owned data so
 * dialog edits are not rolled back before the workflow is saved.
 */
export function mergeVisualEditorNodes(previousNodes: Node[], nextNodes: Node[]): Node[] {
  if (!previousNodes.length || !nextNodes.length) return nextNodes

  const previousById = new Map(previousNodes.map((node) => [node.id, node]))

  return nextNodes.map((nextNode) => {
    const previousNode = previousById.get(nextNode.id)
    if (!previousNode?.data) return nextNode

    return {
      ...nextNode,
      data: {
        ...(nextNode.data ?? {}),
        ...previousNode.data,
      },
    }
  })
}
