import { Migration } from '@mikro-orm/migrations'

export const WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE = 'gateway_webhook_events_idempotency_unique'

export class Migration20261009120000_payment_gateways extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      delete from "gateway_webhook_events" duplicate
      using (
        select
          event."id",
          row_number() over (
            partition by event."idempotency_key", event."provider_key", event."organization_id", event."tenant_id"
            order by event."processed_at" asc, event."id" asc
          ) as claim_rank
        from "gateway_webhook_events" event
      ) ranked
      where duplicate."id" = ranked."id"
        and ranked.claim_rank > 1;
    `)

    this.addSql(`
      do $$
      begin
        if exists (
          select 1
          from pg_constraint
          where conname = '${WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE}'
            and conrelid = to_regclass('"gateway_webhook_events"')
            and contype = 'u'
        ) then
          return;
        end if;
        drop index if exists "${WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE}";
        alter table "gateway_webhook_events"
          add constraint "${WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE}"
          unique ("idempotency_key", "provider_key", "organization_id", "tenant_id");
      end
      $$;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "gateway_webhook_events" drop constraint if exists "${WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE}";`,
    )
    this.addSql(
      `create index if not exists "${WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE}" on "gateway_webhook_events" ("idempotency_key", "provider_key", "organization_id", "tenant_id");`,
    )
  }
}
