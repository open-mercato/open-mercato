import { Migration } from '@mikro-orm/migrations'

/**
 * Backs every `sales_document_sequences` registry row with a real Postgres sequence (#5604).
 *
 * The table itself is unchanged, so the ORM snapshot is untouched — the sequences are
 * catalog objects MikroORM does not model. Each sequence is named after the registry row
 * that owns it (`sales_docseq_<row id without dashes>`), which is how
 * `SalesDocumentNumberGenerator` recomputes the name in SQL without an extra column.
 *
 * `current_value` is carried over as the starting point so numbering continues where it left
 * off, and stops being authoritative from here on — see the entity's deprecation note.
 */
export class Migration20260825120000_sales_document_sequences_backing_sequences extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      declare
        registry record;
        sequence_name text;
      begin
        for registry in select id, current_value from sales_document_sequences loop
          sequence_name := 'sales_docseq_' || replace(registry.id::text, '-', '');
          execute format(
            'create sequence if not exists %I as bigint minvalue 1 start with 1 no cycle',
            sequence_name
          );
          if coalesce(registry.current_value, 0) >= 1 then
            execute format('select setval(%L, %s, true)', sequence_name, registry.current_value);
          end if;
        end loop;
      end $$;
    `)
  }

  override async down(): Promise<void> {
    // Hand authority back to `current_value` before dropping the sequences, otherwise the
    // rolled-back code resumes from a value that stopped advancing when this migration ran
    // and re-issues numbers that are already on documents.
    this.addSql(`
      do $$
      declare
        registry record;
        sequence_name text;
        last_issued bigint;
      begin
        for registry in select id from sales_document_sequences loop
          sequence_name := 'sales_docseq_' || replace(registry.id::text, '-', '');
          execute format('select pg_sequence_last_value(%L::regclass)', sequence_name) into last_issued;
          if last_issued is not null then
            update sales_document_sequences
               set current_value = greatest(coalesce(current_value, 0), last_issued),
                   updated_at = now()
             where id = registry.id;
          end if;
          execute format('drop sequence if exists %I', sequence_name);
        end loop;
      end $$;
    `)
  }
}
