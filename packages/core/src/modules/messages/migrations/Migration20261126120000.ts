import { Migration } from '@mikro-orm/migrations';

export class Migration20261126120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column if not exists "email_delivery_route" text null;`);
    this.addSql(`update "messages" set "email_delivery_route" = 'send_as_user' where "email_delivery_route" is null and "source_entity_type" = 'communication_channels.send_as_user';`);
    this.addSql(`update "messages" set "email_delivery_route" = 'system' where "email_delivery_route" is null and "is_draft" = false and "external_email" is not null and ("send_via_email" = true or "visibility" = 'public') and "sender_channel_id" is null and "source_entity_type" is distinct from 'communication_channels.external_conversation' and exists (select 1 from "message_external_participants" "p" where "p"."message_id" = "messages"."id" and "p"."delivery_status" is not null);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "messages" drop column if exists "email_delivery_route";`);
  }

}
