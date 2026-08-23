import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  Document,
  DocumentAttachment,
  DocumentComment,
  DocumentContent,
  DocumentFolder,
  DocumentEntityLink,
  DocumentFavorite,
  DocumentShare,
  DocumentTemplate,
  DocumentVersion,
  DocumentWatcher,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    Document: asValue(Document),
    DocumentAttachment: asValue(DocumentAttachment),
    DocumentComment: asValue(DocumentComment),
    DocumentContent: asValue(DocumentContent),
    DocumentFolder: asValue(DocumentFolder),
    DocumentEntityLink: asValue(DocumentEntityLink),
    DocumentFavorite: asValue(DocumentFavorite),
    DocumentShare: asValue(DocumentShare),
    DocumentTemplate: asValue(DocumentTemplate),
    DocumentVersion: asValue(DocumentVersion),
    DocumentWatcher: asValue(DocumentWatcher),
  })
}

export default { register }
