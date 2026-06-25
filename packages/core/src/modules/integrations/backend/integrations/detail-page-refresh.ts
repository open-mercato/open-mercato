type ShowLoadingOption = { showLoading?: boolean }
type IntegrationDetailLoader = (options?: ShowLoadingOption) => Promise<void>
type IntegrationPanelLoader = () => Promise<void>

/**
 * Refresh the integration detail and credential panels concurrently.
 *
 * Detail and credentials are served by independent endpoints with no data
 * dependency between them, so the two requests start together instead of
 * waiting for the detail load to resolve before credentials begins.
 */
export async function refreshIntegrationDetailPanels(loaders: {
  loadDetail: IntegrationDetailLoader
  loadCredentials: IntegrationPanelLoader
}): Promise<void> {
  await Promise.all([
    loaders.loadDetail({ showLoading: false }),
    loaders.loadCredentials(),
  ])
}

/**
 * Refresh the run-activity panels (logs and detail) concurrently.
 *
 * loadLogs and loadDetail hit independent endpoints and neither consumes the
 * other's result, so the two reloads start together.
 */
export async function refreshIntegrationRunActivityPanels(loaders: {
  loadLogs: IntegrationPanelLoader
  loadDetail: IntegrationDetailLoader
}): Promise<void> {
  await Promise.all([
    loaders.loadLogs(),
    loaders.loadDetail({ showLoading: false }),
  ])
}
