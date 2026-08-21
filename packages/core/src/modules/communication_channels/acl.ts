export const features = [
  { id: 'communication_channels.view', title: 'View communication channels', module: 'communication_channels' },
  { id: 'communication_channels.manage', title: 'Manage communication channels', module: 'communication_channels' },
  { id: 'communication_channels.react', title: 'React to channel messages', module: 'communication_channels' },
  { id: 'communication_channels.assign', title: 'Assign channel conversations', module: 'communication_channels' },
  /**
   * Per-user channel ownership (added by the email integration spec).
   *
   * Gates the "Connect my mailbox" flow on the per-user profile page. Split from
   * `communication_channels.manage` so policy can disable new linking while
   * preserving existing accounts (e.g. during a security incident response).
   * Default-granted to all roles in `setup.ts`.
   */
  { id: 'communication_channels.connect_user_channel', title: 'Connect own communication channel', module: 'communication_channels' },
  /**
   * Connect a tenant-wide channel (`CommunicationChannel.user_id IS NULL`) that
   * serves every user in the tenant — used for push providers (FCM/APNs/Expo)
   * whose service account / signing key is shared tenant infrastructure. Gates
   * `POST /channels/connect/tenant-credentials`. Admin/superadmin only: unlike
   * `connect_user_channel` (everyone links their own mailbox), connecting shared
   * push credentials is an administrative action.
   */
  { id: 'communication_channels.connect_tenant_channel', title: 'Connect tenant-wide communication channel', module: 'communication_channels' },
  /**
   * Reserved for a future v2 team-oversight capability. NOT consulted in v1:
   * personal mailboxes (`CommunicationChannel.user_id` set) follow the strict
   * owner-only privacy model, so this feature grants NO cross-user channel view.
   * The admin channels list (`GET /api/communication_channels/channels`) returns
   * `user_id IS NULL` rows only; personal mailboxes surface exclusively on the
   * owner's profile page and are never exposed to admins/superadmins in v1.
   * Granted to `superadmin` + `admin` only so the inert grant is in place ahead
   * of the audited v2 oversight feature that will re-activate it.
   */
  { id: 'communication_channels.admin', title: 'Administer all communication channels (tenant-wide)', module: 'communication_channels' },
  /**
   * Trigger the "Import history" job for a channel — fetch older messages
   * the channel never saw at bootstrap (Spec B § Phase B6). Separate from
   * `manage` so policy can gate bulk historical imports during quiet hours
   * or cost-controlled rollouts while leaving normal channel CRUD open.
   */
  { id: 'communication_channels.channel.import_history', title: 'Import channel history', module: 'communication_channels' },
  /**
   * Manage provider push delivery (Spec C — Gmail Pub/Sub push
   * subscriptions). Gates the "Re-register push" operator button and any
   * future push-status manipulation. Granted to admin + superadmin only —
   * regular users don't need to think about whether mail arrives via
   * push or polling, the system handles it.
   */
  { id: 'communication_channels.channel.push.manage', title: 'Manage push delivery', module: 'communication_channels' },
] as const

export default features
