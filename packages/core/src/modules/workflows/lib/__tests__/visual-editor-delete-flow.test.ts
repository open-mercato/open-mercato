import type { Node, Edge } from '@xyflow/react'
import { performDeleteEdgeFlow, performDeleteNodeFlow, type ConfirmFn } from '../visual-editor-delete-flow'

describe('performDeleteNodeFlow', () => {
  const makeNodes = (): Node[] => [
    { id: 'n1', type: 'automated', position: { x: 0, y: 0 }, data: { stepName: 'Step One' } },
    { id: 'n2', type: 'automated', position: { x: 0, y: 0 }, data: { stepName: 'Step Two' } },
  ]
  const t = (key: string) => key
  const nopSetEdges = (_u: (eds: Edge[]) => Edge[]) => {}

  it('closes the edit dialog before awaiting the confirm dialog', async () => {
    const calls: string[] = []
    const confirm: ConfirmFn = async () => {
      calls.push('confirm:await')
      return true
    }
    await performDeleteNodeFlow('n1', {
      nodes: makeNodes(),
      confirm,
      t,
      setShowNodeDialog: (open) => {
        if (!open) calls.push('setShowNodeDialog:false')
      },
      setSelectedNode: (node) => {
        if (node === null) calls.push('setSelectedNode:null')
      },
      setNodes: () => calls.push('setNodes'),
      setEdges: () => calls.push('setEdges'),
      notifyDeleted: () => calls.push('notifyDeleted'),
    })

    const closeIdx = calls.indexOf('setShowNodeDialog:false')
    const confirmIdx = calls.indexOf('confirm:await')
    expect(closeIdx).toBeGreaterThanOrEqual(0)
    expect(confirmIdx).toBeGreaterThanOrEqual(0)
    expect(closeIdx).toBeLessThan(confirmIdx)
  })

  it('removes the node and connected edges when confirmed', async () => {
    let nodesState: Node[] = makeNodes()
    let edgesState: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n1' },
      { id: 'e3', source: 'n2', target: 'n2' },
    ]
    const notify = jest.fn()
    const result = await performDeleteNodeFlow('n1', {
      nodes: nodesState,
      confirm: async () => true,
      t,
      setShowNodeDialog: () => {},
      setSelectedNode: () => {},
      setNodes: (updater) => {
        nodesState = updater(nodesState)
      },
      setEdges: (updater) => {
        edgesState = updater(edgesState)
      },
      notifyDeleted: notify,
    })
    expect(result).toBe(true)
    expect(nodesState.map((n) => n.id)).toEqual(['n2'])
    expect(edgesState.map((e) => e.id)).toEqual(['e3'])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does not mutate graph state when cancelled', async () => {
    let nodesState: Node[] = makeNodes()
    let edgesState: Edge[] = []
    const notify = jest.fn()
    const result = await performDeleteNodeFlow('n1', {
      nodes: nodesState,
      confirm: async () => false,
      t,
      setShowNodeDialog: () => {},
      setSelectedNode: () => {},
      setNodes: (updater) => {
        nodesState = updater(nodesState)
      },
      setEdges: (updater) => {
        edgesState = updater(edgesState)
      },
      notifyDeleted: notify,
    })
    expect(result).toBe(false)
    expect(nodesState.map((n) => n.id)).toEqual(['n1', 'n2'])
    expect(edgesState).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })

  it('uses stepName in the confirmation text when available', async () => {
    const confirm = jest.fn().mockResolvedValue(false)
    await performDeleteNodeFlow('n1', {
      nodes: makeNodes(),
      confirm,
      t: (key, paramsOrFallback, fallback) => {
        if (key === 'workflows.confirm.deleteStep') {
          return `delete:${paramsOrFallback?.name ?? fallback ?? key}`
        }
        return key
      },
      setShowNodeDialog: () => {},
      setSelectedNode: () => {},
      setNodes: nopSetEdges,
      setEdges: nopSetEdges,
      notifyDeleted: () => {},
    })
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'delete:Step One', variant: 'destructive' }),
    )
  })
})

describe('performDeleteEdgeFlow', () => {
  it('closes the edit dialog before awaiting the confirm dialog', async () => {
    const calls: string[] = []
    const confirm: ConfirmFn = async () => {
      calls.push('confirm:await')
      return true
    }
    await performDeleteEdgeFlow('e1', {
      confirm,
      t: (k) => k,
      setShowEdgeDialog: (open) => {
        if (!open) calls.push('setShowEdgeDialog:false')
      },
      setSelectedEdge: (edge) => {
        if (edge === null) calls.push('setSelectedEdge:null')
      },
      setEdges: () => calls.push('setEdges'),
      notifyDeleted: () => calls.push('notifyDeleted'),
    })
    const closeIdx = calls.indexOf('setShowEdgeDialog:false')
    const confirmIdx = calls.indexOf('confirm:await')
    expect(closeIdx).toBeGreaterThanOrEqual(0)
    expect(confirmIdx).toBeGreaterThanOrEqual(0)
    expect(closeIdx).toBeLessThan(confirmIdx)
  })

  it('removes only the target edge when confirmed', async () => {
    let edgesState: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ]
    const notify = jest.fn()
    const result = await performDeleteEdgeFlow('e1', {
      confirm: async () => true,
      t: (k) => k,
      setShowEdgeDialog: () => {},
      setSelectedEdge: () => {},
      setEdges: (updater) => {
        edgesState = updater(edgesState)
      },
      notifyDeleted: notify,
    })
    expect(result).toBe(true)
    expect(edgesState.map((e) => e.id)).toEqual(['e2'])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does not mutate edges when cancelled', async () => {
    let edgesState: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2' }]
    const result = await performDeleteEdgeFlow('e1', {
      confirm: async () => false,
      t: (k) => k,
      setShowEdgeDialog: () => {},
      setSelectedEdge: () => {},
      setEdges: (updater) => {
        edgesState = updater(edgesState)
      },
      notifyDeleted: () => {},
    })
    expect(result).toBe(false)
    expect(edgesState).toEqual([{ id: 'e1', source: 'n1', target: 'n2' }])
  })
})
