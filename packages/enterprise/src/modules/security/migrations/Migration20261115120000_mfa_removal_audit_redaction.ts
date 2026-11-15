import { Migration } from '@mikro-orm/migrations'

export class Migration20261115120000_mfa_removal_audit_redaction extends Migration {
  override up(): void {
    this.addSql(`
      do $$
      begin
        if to_regclass('action_logs') is not null then
          update "action_logs"
          set "snapshot_before" = case
                when jsonb_typeof("snapshot_before") = 'object'
                  then "snapshot_before" - 'secret' - 'providerMetadata'
                else null
              end,
              "snapshot_after" = case
                when jsonb_typeof("snapshot_after") = 'object'
                  then "snapshot_after" - 'secret' - 'providerMetadata'
                else null
              end,
              "command_payload" = case
                when jsonb_typeof("command_payload") = 'object'
                  then "command_payload" - 'undo' - '__redoInput' - 'secret' - 'providerMetadata'
                else null
              end,
              "changes_json" = case
                when jsonb_typeof("changes_json") = 'object'
                  then "changes_json" - 'secret' - 'providerMetadata'
                else null
              end,
              "undo_token" = null
          where "command_id" = 'security.mfa.method.remove'
             or (
               "resource_kind" = 'security.mfa_method'
               and "command_id" ~ '^[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]{22}==:v1$'
             );
        end if;
      end $$;
    `)
  }

  override down(): void {}
}
