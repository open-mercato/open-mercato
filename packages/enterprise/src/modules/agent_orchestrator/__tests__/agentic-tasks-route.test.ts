/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { metadata as taskDetailMeta } from '../backend/agentic-tasks/[id]/page.meta'

// P0-1 rollout invariant (spec 2026-07-12-ux-p0-hotfixes §1): core `workflows`
// owns /backend/tasks, so this module's launcher pages MUST live under
// backend/agentic-tasks — a backend/tasks directory here silently loses route
// resolution and makes the entire Agentic Tasks UI unreachable.
describe('agent_orchestrator agentic-tasks route invariant', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const workflowsTasksPage = path.resolve(
    moduleRoot,
    '../../../../core/src/modules/workflows/backend/tasks/page.tsx',
  )

  it('serves the launcher from backend/agentic-tasks, not backend/tasks', () => {
    expect(fs.existsSync(path.join(moduleRoot, 'backend/agentic-tasks/page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(moduleRoot, 'backend/agentic-tasks/[id]/page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(moduleRoot, 'backend/tasks'))).toBe(false)
  })

  it('leaves /backend/tasks to the core workflows module', () => {
    expect(fs.existsSync(workflowsTasksPage)).toBe(true)
  })

  it('points internal breadcrumbs at /backend/agentic-tasks', () => {
    const listCrumb = taskDetailMeta.breadcrumb?.find((crumb) => crumb.href)
    expect(listCrumb?.href).toBe('/backend/agentic-tasks')
  })
})
