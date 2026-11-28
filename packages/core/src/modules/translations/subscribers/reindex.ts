import { reindexTranslatedRecord } from '../lib/reindex'

export const metadata = { event: 'translations.translation.updated', persistent: true, id: 'translations-reindex-entity' }

export default reindexTranslatedRecord
