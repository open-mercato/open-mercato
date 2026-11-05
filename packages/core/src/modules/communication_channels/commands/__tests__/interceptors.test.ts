import { interceptors } from '../interceptors'
import { COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID } from '../disconnect-channel'

const disconnectInterceptor = interceptors.find(
  (i) => i.targetCommand === COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID,
)

if (!disconnectInterceptor) {
  throw new Error('disconnect interceptor missing — interceptor registry regressed')
}

function makeCtxRuntime(em: { findOne: jest.Mock }) {
  return {
    commandId: COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID,
    auth: null,
    selectedOrganizationId: null,
    container: {
      resolve: ((name: string) => (name === 'em' ? { fork: () => em } : null)) as <T>(name: string) => T,
    } as never,
    metadata: undefined,
  }
}

describe('disconnect-channel beforeUndo interceptor', () => {
  const tenantId = 'tenant-1'
  const userId = 'user-1'
  const channelId = 'ch-1'

  it('allows undo when snapshot indicates the disconnected channel was NOT primary', async () => {
    const findOne = jest.fn() // should never be called for non-primary channels
    const result = await disconnectInterceptor.beforeUndo!(
      {
        input: {},
        logEntry: {
          commandPayload: {
            undo: {
              channelId,
              previousStatus: 'connected',
              previousIsActive: true,
              previousIsPrimary: false,
              previousCredentialsRef: 'cred-1',
              previousLastError: null,
            },
          },
        },
        undoToken: 't',
      } as never,
      makeCtxRuntime({ findOne }),
    )
    expect(result).toBeUndefined()
    expect(findOne).not.toHaveBeenCalled()
  })

  it('allows undo when no other channel is primary', async () => {
    const findOne = jest.fn()
    // First call: lookup the owned channel.
    findOne.mockResolvedValueOnce({ id: channelId, tenantId, userId })
    // Second call: look for another primary — none.
    findOne.mockResolvedValueOnce(null)
    const result = await disconnectInterceptor.beforeUndo!(
      {
        input: {},
        logEntry: {
          commandPayload: {
            undo: {
              channelId,
              tenantId,
              previousStatus: 'connected',
              previousIsActive: true,
              previousIsPrimary: true,
              previousCredentialsRef: 'cred-1',
              previousLastError: null,
            },
          },
        },
        undoToken: 't',
      } as never,
      makeCtxRuntime({ findOne }),
    )
    expect(result).toBeUndefined()
    expect(findOne).toHaveBeenCalledTimes(2)
  })

  it('blocks undo when a different channel is already primary for the user', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: channelId, tenantId, userId })
    findOne.mockResolvedValueOnce({ id: 'ch-other', tenantId, userId, isPrimary: true })
    const result = await disconnectInterceptor.beforeUndo!(
      {
        input: {},
        logEntry: {
          commandPayload: {
            undo: {
              channelId,
              tenantId,
              previousStatus: 'connected',
              previousIsActive: true,
              previousIsPrimary: true,
              previousCredentialsRef: 'cred-1',
              previousLastError: null,
            },
          },
        },
        undoToken: 't',
      } as never,
      makeCtxRuntime({ findOne }),
    )
    expect(result).toMatchObject({ ok: false })
    expect((result as { message: string }).message).toMatch(/primary/i)
  })

  it('allows undo when the snapshot is unreadable (defensive)', async () => {
    const findOne = jest.fn()
    const result = await disconnectInterceptor.beforeUndo!(
      {
        input: {},
        logEntry: { commandPayload: { undo: null } },
        undoToken: 't',
      } as never,
      makeCtxRuntime({ findOne }),
    )
    expect(result).toBeUndefined()
    expect(findOne).not.toHaveBeenCalled()
  })
})
