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
   * Admin-only — view all per-user channels across the tenant, including those
   * owned by other users. Used by the admin channels list page to surface owner
   * information. Granted to `superadmin` + `admin` only.
   */
  { id: 'communication_channels.admin', title: 'Administer all communication channels (tenant-wide)', module: 'communication_channels' },
] as const

export default features
