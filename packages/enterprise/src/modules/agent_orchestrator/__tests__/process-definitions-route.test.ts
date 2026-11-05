/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { metadata as definitionDetailMeta } from '../backend/processes/definitions/[id]/page.meta'

// Route invariants, carrying forward the P0-1 rollout invariant (spec
// 2026-07-12-ux-p0-hotfixes §1):
//
//  - core `workflows` owns /backend/tasks — this module must never claim it;
//  - definitions are authored at /backend/processes/definitions, a LITERAL
//    sibling of the dynamic /backend/processes/[id], which the registry's
//    specificity sort resolves first;
//  - /backend/processes keeps listing running EXECUTIONS. The two are
//    deliberately separate routes, not one tabbed page — they answer "what is
//    happening now" versus "what can happen".
describe('agent_orchestrator process-definitions route invariant', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const exists = (rel: string) => fs.existsSync(path.join(moduleRoot, rel))
  const workflowsTasksPage = path.resolve(
    moduleRoot,
    '../../../../core/src/modules/workflows/backend/tasks/page.tsx',
  )

  it('authors definitions under backend/processes/definitions, not backend/tasks', () => {
    expect(exists('backend/processes/definitions/page.tsx')).toBe(true)
    expect(exists('backend/processes/definitions/[id]/page.tsx')).toBe(true)
    expect(exists('backend/tasks')).toBe(false)
  })

  it('keeps the running-execution list on its own route', () => {
    expect(exists('backend/processes/page.tsx')).toBe(true)
    expect(exists('backend/processes/[id]/page.tsx')).toBe(true)
  })

  it('leaves /backend/tasks to the core workflows module', () => {
    expect(fs.existsSync(workflowsTasksPage)).toBe(true)
  })

  it('points internal breadcrumbs at /backend/processes/definitions', () => {
    const listCrumb = definitionDetailMeta.breadcrumb?.find((crumb) => crumb.href)
    expect(listCrumb?.href).toBe('/backend/processes/definitions')
  })

  it('drops the retired /backend/agentic-tasks bridge — nothing was ever published behind it', () => {
    expect(exists('backend/agentic-tasks')).toBe(false)
  })
})
