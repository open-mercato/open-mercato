import { NextRequest } from 'next/server'
import { GET } from '../route'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { registerCommand, unregisterCommand } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler } from '@open-mercato/shared/lib/commands/types'
import {
  clearSchedulerSafeCommandsForTests,
  registerSchedulerSafeCommands,
} from '../../../lib/scheduler-safe-commands'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: jest.fn(),
}))

const safeCommand: CommandHandler<unknown, { ok: boolean }> = {
  id: 'test.scheduler.safe.route',
  async execute() {
    return { ok: true }
  },
}

const unsafeCommand: CommandHandler<unknown, { ok: boolean }> = {
  id: 'test.scheduler.unsafe.route',
  async execute() {
    return { ok: true }
  },
}

describe('GET /api/scheduler/targets', () => {
  beforeEach(() => {
    clearSchedulerSafeCommandsForTests()
    unregisterCommand(safeCommand.id)
    unregisterCommand(unsafeCommand.id)
    registerCommand(safeCommand)
    registerCommand(unsafeCommand)
    registerSchedulerSafeCommands([
      {
        commandId: safeCommand.id,
        requiredFeatures: ['scheduler.jobs.manage'],
      },
    ])
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(getModules as jest.Mock).mockReturnValue([
      { workers: [{ queue: 'z-queue' }] },
      { workers: [{ queue: 'a-queue' }] },
    ])
  })

  afterEach(() => {
    unregisterCommand(safeCommand.id)
    unregisterCommand(unsafeCommand.id)
  })

  it('lists only scheduler-safe commands', async () => {
    const response = await GET(new NextRequest('http://localhost/api/scheduler/targets'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.queues).toEqual([
      { value: 'a-queue', label: 'a-queue' },
      { value: 'z-queue', label: 'z-queue' },
    ])
    expect(body.commands).toEqual([
      { value: safeCommand.id, label: safeCommand.id },
    ])
  })
})
