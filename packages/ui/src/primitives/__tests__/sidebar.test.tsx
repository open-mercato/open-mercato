import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarIdentity, SidebarItem, SidebarFeatureCard } from '../sidebar'

describe('Presentational sidebar', () => {
  it('keeps collapsed navigation and identity named without visible text', () => {
    const { container } = render(<Sidebar collapsed aria-label="Workspace"><SidebarHeader><SidebarIdentity label="Acme" description="Finance" leading={<svg />} /></SidebarHeader><SidebarContent><SidebarItem icon={<svg />} active>Overview</SidebarItem></SidebarContent><SidebarFooter><SidebarIdentity label="Alex" leading={<svg />} /></SidebarFooter></Sidebar>)
    expect(screen.getByRole('complementary', { name: 'Workspace' })).toHaveClass('w-20')
    expect(screen.getByRole('button', { name: 'Acme Finance' })).toHaveClass('w-16')
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveClass('size-9')
    expect(screen.getByRole('button', { name: 'Alex' })).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="sidebar-identity"]')).toHaveLength(2)
  })

  it('supports local navigation selection and native disabled behavior', () => {
    const blocked = jest.fn()
    function Example() {
      const [active, setActive] = React.useState('overview')
      return <Sidebar><SidebarItem icon={<svg />} active={active === 'overview'} onClick={() => setActive('overview')}>Overview</SidebarItem><SidebarItem icon={<svg />} active={active === 'settings'} onClick={() => setActive('settings')}>Settings</SidebarItem><SidebarItem icon={<svg />} disabled onClick={blocked}>Restricted</SidebarItem></Sidebar>
    }
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Overview' })).not.toHaveAttribute('aria-current')
    fireEvent.click(screen.getByRole('button', { name: 'Restricted' }))
    expect(blocked).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Restricted' })).toBeDisabled()
  })

  it.each(['stroke', 'gray', 'primary', 'neutral'] as const)('preserves card content for %s appearance', appearance => {
    const { container } = render(<SidebarFeatureCard appearance={appearance}><h2>Storage</h2><button type="button">Pause</button></SidebarFeatureCard>)
    expect(container.firstChild).toHaveAttribute('data-appearance', appearance)
    expect(screen.getByRole('heading', { name: 'Storage' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })
})
