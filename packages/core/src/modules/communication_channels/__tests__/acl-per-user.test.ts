import { features } from '../acl'
import { setup } from '../setup'

describe('communication_channels ACL — slice 3a additions', () => {
  it('exports the connect_user_channel feature', () => {
    const feat = features.find((f) => f.id === 'communication_channels.connect_user_channel')
    expect(feat).toBeDefined()
    expect(feat?.module).toBe('communication_channels')
    expect(feat?.title).toMatch(/Connect/i)
  })

  it('exports the admin feature (tenant-wide channel visibility)', () => {
    const feat = features.find((f) => f.id === 'communication_channels.admin')
    expect(feat).toBeDefined()
    expect(feat?.module).toBe('communication_channels')
  })

  it('grants connect_user_channel to all four default roles', () => {
    expect(setup.defaultRoleFeatures?.superadmin).toContain(
      'communication_channels.connect_user_channel',
    )
    expect(setup.defaultRoleFeatures?.admin).toContain(
      'communication_channels.connect_user_channel',
    )
    expect(setup.defaultRoleFeatures?.manager).toContain(
      'communication_channels.connect_user_channel',
    )
    expect(setup.defaultRoleFeatures?.employee).toContain(
      'communication_channels.connect_user_channel',
    )
  })

  it('grants the admin feature only to superadmin + admin', () => {
    expect(setup.defaultRoleFeatures?.superadmin).toContain('communication_channels.admin')
    expect(setup.defaultRoleFeatures?.admin).toContain('communication_channels.admin')
    expect(setup.defaultRoleFeatures?.manager ?? []).not.toContain('communication_channels.admin')
    expect(setup.defaultRoleFeatures?.employee ?? []).not.toContain('communication_channels.admin')
  })

  it('has exactly nine ACL features after the tenant-wide channel addition', () => {
    expect(features).toHaveLength(9)
  })

  it('exports the connect_tenant_channel feature granted only to superadmin + admin', () => {
    const feat = features.find((f) => f.id === 'communication_channels.connect_tenant_channel')
    expect(feat).toBeDefined()
    expect(feat?.module).toBe('communication_channels')
    expect(setup.defaultRoleFeatures?.superadmin).toContain(
      'communication_channels.connect_tenant_channel',
    )
    expect(setup.defaultRoleFeatures?.admin).toContain(
      'communication_channels.connect_tenant_channel',
    )
    expect(setup.defaultRoleFeatures?.manager ?? []).not.toContain(
      'communication_channels.connect_tenant_channel',
    )
    expect(setup.defaultRoleFeatures?.employee ?? []).not.toContain(
      'communication_channels.connect_tenant_channel',
    )
  })

  it('exports the channel.push.manage feature (Spec C § Phase C1)', () => {
    const feat = features.find((f) => f.id === 'communication_channels.channel.push.manage')
    expect(feat).toBeDefined()
    expect(feat?.module).toBe('communication_channels')
  })

  it('exports the channel.import_history feature (Spec B § Phase B6)', () => {
    const feat = features.find((f) => f.id === 'communication_channels.channel.import_history')
    expect(feat).toBeDefined()
    expect(feat?.module).toBe('communication_channels')
  })

  it('grants channel.import_history only to superadmin + admin', () => {
    expect(setup.defaultRoleFeatures?.superadmin).toContain(
      'communication_channels.channel.import_history',
    )
    expect(setup.defaultRoleFeatures?.admin).toContain(
      'communication_channels.channel.import_history',
    )
    expect(setup.defaultRoleFeatures?.manager ?? []).not.toContain(
      'communication_channels.channel.import_history',
    )
    expect(setup.defaultRoleFeatures?.employee ?? []).not.toContain(
      'communication_channels.channel.import_history',
    )
  })
})
