import { reindexTranslatedRecord } from '../lib/reindex'

export const metadata = { event: 'translations.translation.deleted', persistent: true, id: 'translations-reindex-entity-on-delete' }

export default reindexTranslatedRecord
