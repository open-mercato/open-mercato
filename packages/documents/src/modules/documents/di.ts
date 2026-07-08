import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  Document,
  DocumentAttachment,
  DocumentComment,
  DocumentContent,
  DocumentFolder,
  DocumentShare,
  DocumentVersion,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    Document: asValue(Document),
    DocumentAttachment: asValue(DocumentAttachment),
    DocumentComment: asValue(DocumentComment),
    DocumentContent: asValue(DocumentContent),
    DocumentFolder: asValue(DocumentFolder),
    DocumentShare: asValue(DocumentShare),
    DocumentVersion: asValue(DocumentVersion),
  })
  // Permission and content services are intentionally deferred to the API packet.
}

export default { register }
