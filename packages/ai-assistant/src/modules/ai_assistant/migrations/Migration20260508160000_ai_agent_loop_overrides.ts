import { Migration } from '@mikro-orm/migrations';

export class Migration20260508160000_ai_agent_loop_overrides extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "ai_agent_runtime_overrides" add column "loop_disabled" boolean null;`);
    this.addSql(`alter table "ai_agent_runtime_overrides" add column "loop_max_steps" int null;`);
    this.addSql(`alter table "ai_agent_runtime_overrides" add column "loop_max_tool_calls" int null;`);
    this.addSql(`alter table "ai_agent_runtime_overrides" add column "loop_max_wall_clock_ms" int null;`);
    this.addSql(`alter table "ai_agent_runtime_overrides" add column "loop_max_tokens" int null;`);
    this.addSql(`alter table "ai_agent_runtime_overrides" add column "loop_stop_when_json" jsonb null;`);
    this.addSql(`alter table "ai_agent_runtime_overrides" add column "loop_active_tools_json" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "ai_agent_runtime_overrides" drop column "loop_disabled";`);
    this.addSql(`alter table "ai_agent_runtime_overrides" drop column "loop_max_steps";`);
    this.addSql(`alter table "ai_agent_runtime_overrides" drop column "loop_max_tool_calls";`);
    this.addSql(`alter table "ai_agent_runtime_overrides" drop column "loop_max_wall_clock_ms";`);
    this.addSql(`alter table "ai_agent_runtime_overrides" drop column "loop_max_tokens";`);
    this.addSql(`alter table "ai_agent_runtime_overrides" drop column "loop_stop_when_json";`);
    this.addSql(`alter table "ai_agent_runtime_overrides" drop column "loop_active_tools_json";`);
  }

}
