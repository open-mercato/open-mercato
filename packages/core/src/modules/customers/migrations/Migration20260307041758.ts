import { Migration } from '@mikro-orm/migrations';

export class Migration20260307041758 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_deal_emails" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "deal_id" uuid not null, "thread_id" text null, "message_id" text null, "in_reply_to" text null, "direction" text not null, "from_address" text not null, "from_name" text null, "to_addresses" jsonb not null default '[]', "cc_addresses" jsonb null default '[]', "bcc_addresses" jsonb null default '[]', "subject" text not null, "body_text" text null, "body_html" text null, "sent_at" timestamptz not null, "provider" text null, "provider_message_id" text null, "provider_metadata" jsonb null, "has_attachments" boolean not null default false, "is_read" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_deal_emails_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_deal_emails_org_idx" on "customer_deal_emails" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_deal_emails_thread_idx" on "customer_deal_emails" ("thread_id");`);
    this.addSql(`create index "customer_deal_emails_deal_idx" on "customer_deal_emails" ("deal_id", "sent_at");`);
    this.addSql(`alter table "customer_deal_emails" add constraint "customer_deal_emails_message_unique" unique ("message_id");`);

    this.addSql(`create table "customer_deal_mentions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "deal_id" uuid not null, "comment_id" uuid not null, "mentioned_user_id" uuid not null, "is_read" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_deal_mentions_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_deal_mentions_deal_idx" on "customer_deal_mentions" ("deal_id");`);
    this.addSql(`create index "customer_deal_mentions_user_idx" on "customer_deal_mentions" ("mentioned_user_id", "is_read");`);
  }

}
