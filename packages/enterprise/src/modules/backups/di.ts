import path from 'node:path'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ErasureManifestService, resolveErasureManifestDirectory } from './lib/erasureManifest'

export function register(container: AppContainer) {
  const backupDirectory = path.resolve(process.env.OM_BACKUP_DIRECTORY ?? path.join('.mercato', 'backups'))
  container.register({
    erasureManifestService: asValue(new ErasureManifestService(
      resolveErasureManifestDirectory(backupDirectory),
    )),
  })
}
