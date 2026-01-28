import { Migration } from '@mikro-orm/migrations'

export class Migration20260123000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        
        recipient_user_id UUID NOT NULL,
        
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        icon TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        
        status TEXT NOT NULL DEFAULT 'unread',
        
        action_data JSONB,
        action_result JSONB,
        action_taken TEXT,
        
        source_module TEXT,
        source_entity_type TEXT,
        source_entity_id UUID,
        link_href TEXT,
        
        group_key TEXT,
        
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        read_at TIMESTAMPTZ,
        actioned_at TIMESTAMPTZ,
        dismissed_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        
        tenant_id UUID NOT NULL,
        organization_id UUID
      );
    `)

    this.addSql(`
      CREATE INDEX notifications_recipient_status_idx 
        ON notifications(recipient_user_id, status, created_at DESC);
    `)

    this.addSql(`
      CREATE INDEX notifications_source_idx 
        ON notifications(source_entity_type, source_entity_id) 
        WHERE source_entity_id IS NOT NULL;
    `)

    this.addSql(`
      CREATE INDEX notifications_tenant_idx 
        ON notifications(tenant_id, organization_id);
    `)

    this.addSql(`
      CREATE INDEX notifications_expires_idx 
        ON notifications(expires_at) 
        WHERE expires_at IS NOT NULL AND status NOT IN ('actioned', 'dismissed');
    `)

    this.addSql(`
      CREATE INDEX notifications_group_idx 
        ON notifications(group_key, recipient_user_id) 
        WHERE group_key IS NOT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS notifications CASCADE;')
  }
}
