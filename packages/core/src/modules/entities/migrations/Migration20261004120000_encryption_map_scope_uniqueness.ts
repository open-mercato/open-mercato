import { Migration } from '@mikro-orm/migrations'

export const ENCRYPTION_MAP_SCOPE_UNIQUE_INDEX = 'encryption_maps_entity_scope_live_unique'

export class Migration20261004120000_encryption_map_scope_uniqueness extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      with live_maps as (
        select
          map.*,
          count(*) over (
            partition by map."entity_id", map."tenant_id", map."organization_id"
          ) as duplicate_count,
          bool_or(map."is_active") over (
            partition by map."entity_id", map."tenant_id", map."organization_id"
          ) as any_active,
          row_number() over (
            partition by map."entity_id", map."tenant_id", map."organization_id"
            order by map."created_at" asc, map."id" asc
          ) as canonical_rank
        from "encryption_maps" map
        where map."deleted_at" is null
      ),
      field_occurrences as (
        select
          live."entity_id",
          live."tenant_id",
          live."organization_id",
          live."created_at",
          live."id" as row_id,
          field.ordinality,
          btrim(field.value ->> 'field') as field_name,
          nullif(field.value ->> 'hashField', '') as hash_field
        from live_maps live
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(live."fields_json") = 'array' then live."fields_json"
            else '[]'::jsonb
          end
        ) with ordinality as field(value, ordinality)
        where live.duplicate_count > 1
          and (not live.any_active or live."is_active")
          and jsonb_typeof(field.value) = 'object'
          and btrim(coalesce(field.value ->> 'field', '')) <> ''
      ),
      field_choices as (
        select
          occurrence."entity_id",
          occurrence."tenant_id",
          occurrence."organization_id",
          occurrence.field_name,
          (array_agg(
            occurrence.hash_field
            order by
              (occurrence.hash_field is null) asc,
              occurrence."created_at" asc,
              occurrence.row_id asc,
              occurrence.ordinality asc
          ))[1] as hash_field
        from field_occurrences occurrence
        group by
          occurrence."entity_id",
          occurrence."tenant_id",
          occurrence."organization_id",
          occurrence.field_name
      ),
      field_sets as (
        select
          choice."entity_id",
          choice."tenant_id",
          choice."organization_id",
          jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object('field', choice.field_name, 'hashField', choice.hash_field))
            order by choice.field_name asc
          ) as fields_json
        from field_choices choice
        group by choice."entity_id", choice."tenant_id", choice."organization_id"
      )
      update "encryption_maps" canonical
      set
        "fields_json" = coalesce(fields.fields_json, '[]'::jsonb),
        "is_active" = live.any_active,
        "updated_at" = now()
      from live_maps live
      left join field_sets fields
        on fields."entity_id" = live."entity_id"
        and fields."tenant_id" is not distinct from live."tenant_id"
        and fields."organization_id" is not distinct from live."organization_id"
      where canonical."id" = live."id"
        and live.duplicate_count > 1
        and live.canonical_rank = 1;
    `)

    this.addSql(`
      with live_maps as (
        select
          map."id",
          count(*) over (
            partition by map."entity_id", map."tenant_id", map."organization_id"
          ) as duplicate_count,
          row_number() over (
            partition by map."entity_id", map."tenant_id", map."organization_id"
            order by map."created_at" asc, map."id" asc
          ) as canonical_rank
        from "encryption_maps" map
        where map."deleted_at" is null
      )
      update "encryption_maps" duplicate
      set
        "is_active" = false,
        "deleted_at" = now(),
        "updated_at" = now()
      from live_maps live
      where duplicate."id" = live."id"
        and live.duplicate_count > 1
        and live.canonical_rank > 1;
    `)

    this.addSql(`
      create unique index "${ENCRYPTION_MAP_SCOPE_UNIQUE_INDEX}"
      on "encryption_maps" ("entity_id", "tenant_id", "organization_id")
      nulls not distinct
      where "deleted_at" is null;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "${ENCRYPTION_MAP_SCOPE_UNIQUE_INDEX}";`)
  }
}
