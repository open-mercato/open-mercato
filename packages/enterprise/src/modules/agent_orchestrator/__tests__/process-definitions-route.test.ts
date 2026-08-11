/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { metadata as definitionDetailMeta } from '../backend/processes/definitions/[id]/page.meta'
import { metadata as bridgeMeta } from '../backend/agentic-tasks/page.meta'

// Route invariants for the triggered process model (spec 2026-08-11 §Frontend
// architecture contract), carrying forward the P0-1 rollout invariant (spec
// 2026-07-12-ux-p0-hotfixes §1):
//
//  - core `workflows` owns /backend/tasks — this module must never claim it;
//  - definitions are authored at /backend/processes/definitions, a LITERAL
//    sibling of the dynamic /backend/processes/[id], which the registry's
//    specificity sort resolves first;
//  - /backend/processes keeps listing the running-process PROJECTION. The two
//    are deliberately separate routes, not one tabbed page;
//  - the retired /backend/agentic-tasks path stays as a guarded bridge.
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

  it('keeps the running-process projection on its own route', () => {
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

  it('keeps the retired /backend/agentic-tasks path as a nav-hidden, still-guarded bridge', () => {
    expect(exists('backend/agentic-tasks/page.tsx')).toBe(true)
    expect(exists('backend/agentic-tasks/[id]/page.tsx')).toBe(true)
    expect(bridgeMeta.navHidden).toBe(true)
    expect(bridgeMeta.requireFeatures).toEqual(['agent_orchestrator.processes.view'])
    const bridge = fs.readFileSync(path.join(moduleRoot, 'backend/agentic-tasks/page.tsx'), 'utf8')
    expect(bridge).toContain('PROCESS_DEFINITIONS_HREF')
  })
})
