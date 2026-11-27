import { Migration } from '@mikro-orm/migrations'
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill'

export class Migration20261107120000_mfa_secret_encryption extends Migration {
  override up(): void {
    this.addSql('alter table "user_mfa_methods" add column "secret_hash" text null;')
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'security:user_mfa_method',
      fields: [{ field: 'secret', hashField: 'secret_hash' }, { field: 'provider_metadata' }],
    }))
    this.addSql(`do $$
begin
  if to_regclass('encryption_maps') is null then
    return;
  end if;

  with patched_maps as (
    select maps."id", jsonb_agg(
      case
        when rule->>'field' = 'secret' and nullif(rule->>'hashField', '') is null
          then rule || '{"hashField":"secret_hash"}'::jsonb
        else rule
      end order by position
    ) as "fields_json"
    from "encryption_maps" as maps
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(maps."fields_json") = 'array' then maps."fields_json" else '[]'::jsonb end
    ) with ordinality as rules(rule, position)
    where maps."entity_id" = 'security:user_mfa_method'
      and maps."is_active" = true
      and maps."deleted_at" is null
    group by maps."id"
    having bool_or(rule->>'field' = 'secret' and nullif(rule->>'hashField', '') is null)
  )
  update "encryption_maps" as maps
  set "fields_json" = patched_maps."fields_json", "updated_at" = now()
  from patched_maps
  where maps."id" = patched_maps."id";
end
$$;`)
  }
}
