/** @jest-environment node */

import {
  refreshIntegrationDetailPanels,
  refreshIntegrationRunActivityPanels,
} from '../detail-page-refresh'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = () => res()
  })
  return { promise, resolve }
}

describe('integration detail concurrent refresh helpers', () => {
  it('starts detail and credential loads concurrently', async () => {
    const detail = deferred()
    const loadDetail = jest.fn((_options?: { showLoading?: boolean }) => detail.promise)
    const loadCredentials = jest.fn(() => Promise.resolve())

    const pending = refreshIntegrationDetailPanels({ loadDetail, loadCredentials })

    // Both independent loads must already be in flight before detail resolves.
    // A serial implementation only invokes loadCredentials after loadDetail
    // settles, so this assertion fails for the serialized bug.
    expect(loadDetail).toHaveBeenCalledTimes(1)
    expect(loadDetail).toHaveBeenCalledWith({ showLoading: false })
    expect(loadCredentials).toHaveBeenCalledTimes(1)

    detail.resolve()
    await pending
  })

  it('starts logs and detail reloads concurrently for run activity refresh', async () => {
    const logs = deferred()
    const loadLogs = jest.fn(() => logs.promise)
    const loadDetail = jest.fn((_options?: { showLoading?: boolean }) => Promise.resolve())

    const pending = refreshIntegrationRunActivityPanels({ loadLogs, loadDetail })

    // loadLogs is held pending; a serial implementation would not start
    // loadDetail until loadLogs resolves, so loadDetail would be uncalled here.
    expect(loadLogs).toHaveBeenCalledTimes(1)
    expect(loadDetail).toHaveBeenCalledTimes(1)
    expect(loadDetail).toHaveBeenCalledWith({ showLoading: false })

    logs.resolve()
    await pending
  })
})
