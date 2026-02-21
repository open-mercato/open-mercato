import { Migration } from '@mikro-orm/migrations';

export class Migration20260218191730 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_pipelines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "is_default" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_pipelines_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_pipelines_org_tenant_idx" on "customer_pipelines" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_pipeline_stages" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "pipeline_id" uuid not null, "name" text not null, "position" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_pipeline_stages_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_pipeline_stages_pipeline_position_idx" on "customer_pipeline_stages" ("pipeline_id", "position");`);
    this.addSql(`create index "customer_pipeline_stages_org_tenant_idx" on "customer_pipeline_stages" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "customer_deals" add column "pipeline_id" uuid null, add column "pipeline_stage_id" uuid null;`);

    // Data migration: backfill existing deals from legacy pipeline_stage (text) → pipeline_id + pipeline_stage_id
    this.addSql(`
      DO $$
      DECLARE
        r             RECORD;
        v_pipeline_id UUID;
        v_stage_id    UUID;
        v_pos         INT;
        stage_values  TEXT[] := ARRAY[
          'opportunity','marketing_qualified_lead','sales_qualified_lead',
          'offering','negotiations','win','loose','stalled'
        ];
        stage_labels  TEXT[] := ARRAY[
          'Opportunity','Marketing Qualified Lead','Sales Qualified Lead',
          'Offering','Negotiations','Win','Loose','Stalled'
        ];
      BEGIN
        FOR r IN (
          SELECT DISTINCT organization_id, tenant_id FROM customer_deals
          WHERE pipeline_stage IS NOT NULL AND pipeline_stage <> '' AND pipeline_id IS NULL
        ) LOOP
          SELECT id INTO v_pipeline_id FROM customer_pipelines
          WHERE organization_id = r.organization_id AND tenant_id = r.tenant_id AND is_default = true LIMIT 1;

          IF v_pipeline_id IS NULL THEN
            INSERT INTO customer_pipelines (id, organization_id, tenant_id, name, is_default, created_at, updated_at)
            VALUES (gen_random_uuid(), r.organization_id, r.tenant_id, 'Default Pipeline', true, now(), now())
            RETURNING id INTO v_pipeline_id;
          END IF;

          IF NOT EXISTS (SELECT 1 FROM customer_pipeline_stages WHERE pipeline_id = v_pipeline_id) THEN
            FOR v_pos IN 1..array_length(stage_labels, 1) LOOP
              INSERT INTO customer_pipeline_stages (id, organization_id, tenant_id, pipeline_id, name, position, created_at, updated_at)
              VALUES (gen_random_uuid(), r.organization_id, r.tenant_id, v_pipeline_id, stage_labels[v_pos], v_pos - 1, now(), now());
            END LOOP;
          END IF;

          FOR v_pos IN 1..array_length(stage_values, 1) LOOP
            SELECT id INTO v_stage_id FROM customer_pipeline_stages
            WHERE pipeline_id = v_pipeline_id AND name = stage_labels[v_pos] LIMIT 1;
            IF v_stage_id IS NOT NULL THEN
              UPDATE customer_deals
              SET pipeline_id = v_pipeline_id, pipeline_stage_id = v_stage_id
              WHERE organization_id = r.organization_id AND tenant_id = r.tenant_id
                AND pipeline_id IS NULL
                AND pipeline_stage IN (stage_values[v_pos], stage_labels[v_pos]);
            END IF;
          END LOOP;

          -- deals with unknown stage value: assign to pipeline, stage stays NULL
          UPDATE customer_deals SET pipeline_id = v_pipeline_id
          WHERE organization_id = r.organization_id AND tenant_id = r.tenant_id AND pipeline_id IS NULL;
        END LOOP;
      END $$;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_deals" drop column "pipeline_id", drop column "pipeline_stage_id";`);
    this.addSql(`drop table if exists "customer_pipeline_stages";`);
    this.addSql(`drop table if exists "customer_pipelines";`);
  }

}
