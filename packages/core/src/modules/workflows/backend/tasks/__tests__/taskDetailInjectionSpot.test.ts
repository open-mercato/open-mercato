/**
 * The task-detail injection spot (spec §7.6).
 *
 * A widget spot id is a FROZEN contract surface (BACKWARD_COMPATIBILITY.md §6),
 * and this one exists for exactly one reason: the task detail page can only
 * walk a `formSchema` GENERICALLY, so an agent-disposition task rendered by it
 * alone asks an operator to approve a key/value dump. The enterprise draft card
 * mounts here. These tests fail if either end moves.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TASK_DETAIL_INJECTION_SPOT_ID } from '../../../lib/work-inbox/navigation'

const detailPage = join(__dirname, '..', '[id]', 'page.tsx')
const enterpriseInjectionTable = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'enterprise',
  'src',
  'modules',
  'agent_orchestrator',
  'widgets',
  'injection-table.ts',
)

describe('workflows.task.detail:context', () => {
  test('the id is frozen', () => {
    expect(TASK_DETAIL_INJECTION_SPOT_ID).toBe('workflows.task.detail:context')
  })

  test('the detail page mounts the spot', () => {
    const source = readFileSync(detailPage, 'utf8')
    expect(source).toContain('TASK_DETAIL_INJECTION_SPOT_ID')
    expect(source).toContain('<InjectionSpot')
  })

  test('the enterprise draft card injects into exactly that spot', () => {
    const source = readFileSync(enterpriseInjectionTable, 'utf8')
    expect(source).toContain(`'${TASK_DETAIL_INJECTION_SPOT_ID}'`)
    expect(source).toContain('agent_orchestrator.injection.task-proposal-draft')
  })
})
