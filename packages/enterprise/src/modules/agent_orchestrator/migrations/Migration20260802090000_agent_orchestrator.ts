import { Migration } from '@mikro-orm/migrations'

/**
 * `agent_settings.tags` — operator-authored labels for an agent definition,
 * scoped per (tenant, organization) like the icon override next to it. Agents
 * themselves are code/file-defined and carry no per-tenant state, so this is the
 * only place a tenant's own taxonomy can live; keying by agent id (not an FK)
 * keeps tags for agents that are not in the live registry.
 */
export class Migration20260802090000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_settings" add "tags" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "agent_settings" drop column "tags";`);
  }

}
