import { Migration } from '@mikro-orm/migrations';

export class Migration20260522120000_ai_assistant extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "ai_chat_conversation_participants" add column "deleted_at" timestamptz null;`)
    this.addSql(`create index "ai_chat_conv_participants_active_conv_user_idx" on "ai_chat_conversation_participants" ("tenant_id", "organization_id", "conversation_id", "user_id") where "deleted_at" is null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "ai_chat_conv_participants_active_conv_user_idx";`)
    this.addSql(`alter table "ai_chat_conversation_participants" drop column if exists "deleted_at";`)
  }

}
