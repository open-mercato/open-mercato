import { Migration } from '@mikro-orm/migrations'

export class Migration20261119120000_attachments extends Migration {
  override up(): void {
    this.addSql(`
      update attachment_partitions as partition
      set access_resolver_requirements = coalesce(partition.access_resolver_requirements, '[]'::jsonb)
        || '[{"resolverId":"sync_excel.upload-attachments","targetEntity":"sync_excel:upload"}]'::jsonb,
        updated_at = now()
      where (partition.access_resolver_requirements is null or jsonb_typeof(partition.access_resolver_requirements) = 'array')
        and not coalesce(partition.access_resolver_requirements, '[]'::jsonb)
          @> '[{"resolverId":"sync_excel.upload-attachments","targetEntity":"sync_excel:upload"}]'::jsonb
        and exists (
          select 1 from attachments as attachment
          where attachment.partition_code = partition.code
            and btrim(attachment.entity_id) = 'sync_excel:upload'
        );
    `)
  }
}
