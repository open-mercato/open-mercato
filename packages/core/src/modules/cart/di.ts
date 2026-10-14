import type { AppContainer } from '@open-mercato/shared/lib/di/container'

// No services registered yet — cartService and its supporting services land in
// later Phase 4 steps as the entities, commands and API routes are built.
export function register(_container: AppContainer): void {}

export default { register }
