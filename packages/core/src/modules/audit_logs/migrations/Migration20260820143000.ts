import { Migration } from '@mikro-orm/migrations'

export class Migration20260820143000 extends Migration {
  override up(): void {
    this.addSql(`
      create or replace function om_audit_redact_sensitive(input_value jsonb)
      returns jsonb
      language plpgsql
      immutable
      strict
      as $$
      declare
        output_value jsonb;
      begin
        if jsonb_typeof(input_value) = 'object' then
          select coalesce(
            jsonb_object_agg(
              entry.key,
              case
                when lower(regexp_replace(entry.key, '[^a-zA-Z0-9]', '', 'g')) not like '%hash'
                  and lower(regexp_replace(entry.key, '[^a-zA-Z0-9]', '', 'g')) ~ '(passwords?|passphrases?|secrets?|tokens?|apikeys?|privatekeys?|recoverycodes?|credentials?|authorization|authorizationheader|authheader|cookies?|otps?|otpcodes?|otpseed)$'
                then to_jsonb('[REDACTED]'::text)
                else om_audit_redact_sensitive(entry.value)
              end
            ),
            '{}'::jsonb
          )
          into output_value
          from jsonb_each(input_value) as entry;
          return output_value;
        end if;

        if jsonb_typeof(input_value) = 'array' then
          select coalesce(
            jsonb_agg(om_audit_redact_sensitive(entry.value) order by entry.ordinality),
            '[]'::jsonb
          )
          into output_value
          from jsonb_array_elements(input_value) with ordinality as entry(value, ordinality);
          return output_value;
        end if;

        return input_value;
      end;
      $$;
    `)

    this.addSql(`
      with sanitized as (
        select
          id,
          om_audit_redact_sensitive(command_payload) as command_payload_safe,
          om_audit_redact_sensitive(snapshot_before) as snapshot_before_safe,
          om_audit_redact_sensitive(snapshot_after) as snapshot_after_safe,
          om_audit_redact_sensitive(changes_json) as changes_json_safe,
          om_audit_redact_sensitive(context_json) as context_json_safe,
          command_payload,
          snapshot_before,
          snapshot_after,
          changes_json,
          context_json
        from action_logs
        where deleted_at is null
      ),
      affected as (
        select *
        from sanitized
        where command_payload is distinct from command_payload_safe
           or snapshot_before is distinct from snapshot_before_safe
           or snapshot_after is distinct from snapshot_after_safe
           or changes_json is distinct from changes_json_safe
           or context_json is distinct from context_json_safe
      )
      update action_logs as action_log
      set
        undo_token = null,
        command_payload = case
          when jsonb_typeof(affected.command_payload_safe) = 'object'
            then (affected.command_payload_safe - '__redoInput')
              || jsonb_build_object('__redoUnavailable', 'sensitive-data-redacted')
          else jsonb_build_object('__redoUnavailable', 'sensitive-data-redacted')
        end,
        snapshot_before = affected.snapshot_before_safe,
        snapshot_after = affected.snapshot_after_safe,
        changes_json = affected.changes_json_safe,
        context_json = affected.context_json_safe,
        updated_at = now()
      from affected
      where action_log.id = affected.id;
    `)

    this.addSql('drop function if exists om_audit_redact_sensitive(jsonb);')
  }

  override down(): void {}
}
