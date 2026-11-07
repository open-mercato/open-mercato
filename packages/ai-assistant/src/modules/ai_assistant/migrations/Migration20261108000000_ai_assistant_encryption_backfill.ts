import { Migration } from '@mikro-orm/migrations'
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill'

export class Migration20261108000000_ai_assistant_encryption_backfill extends Migration {
  override up(): void {
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'ai_assistant:ai_chat_message',
      fields: [
        { field: 'content' },
        { field: 'ui_parts' },
        { field: 'files_metadata' },
        { field: 'metadata' },
      ],
    }))
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'ai_assistant:ai_chat_conversation',
      fields: [{ field: 'title' }],
    }))
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'ai_assistant:ai_pending_action',
      fields: [
        { field: 'normalized_input' },
        { field: 'field_diff' },
        { field: 'records' },
      ],
    }))
  }

  override down(): void {}
}
