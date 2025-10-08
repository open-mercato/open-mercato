'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Shield, Users, Briefcase, Info } from 'lucide-react'

interface RoleTileProps {
  icon: React.ReactNode
  title: string
  description: string
  features: string[]
  loginUrl: string
  variant?: 'default' | 'secondary' | 'outline'
}

function RoleTile({ icon, title, description, features, loginUrl, variant = 'default' }: RoleTileProps) {
  return (
    <div className="rounded-lg border bg-card p-6 flex flex-col gap-4 transition-all hover:shadow-md">
      <div className="flex items-start gap-4">
        <div className="rounded-lg bg-primary/10 p-3 text-primary">
          {icon}
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
      
      <div className="flex-1">
        <div className="text-xs font-medium text-muted-foreground mb-2">Available Features:</div>
        <ul className="space-y-1.5">
          {features.map((feature, idx) => (
            <li key={idx} className="text-sm flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <Button 
        asChild 
        variant={variant}
        className="w-full"
      >
        <a href={loginUrl}>Login as {title}</a>
      </Button>
    </div>
  )
}

interface StartPageContentProps {
  showStartPage: boolean
}

export function StartPageContent({ showStartPage: initialShowStartPage }: StartPageContentProps) {
  const [showStartPage, setShowStartPage] = useState(initialShowStartPage)

  const handleCheckboxChange = (checked: boolean) => {
    setShowStartPage(checked)
    // Set cookie to remember preference
    document.cookie = `show_start_page=${checked}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`
  }

  return (
    <>
      <section className="rounded-lg border bg-gradient-to-br from-background to-muted/20 p-8 text-center">
        <h2 className="text-2xl font-semibold mb-3">Welcome to Your Open Mercato Installation</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          This is a customizable start page for your fresh Open Mercato installation. 
          Choose your role below to get started and explore the features available to you.
        </p>
      </section>

      <section className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 p-4">
        <div className="flex items-start gap-3">
          <Info className="size-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">Default Password</h3>
            <p className="text-sm text-blue-800 dark:text-blue-200">
              The default password for all demo accounts is <code className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 font-mono text-xs">secret</code>. 
              To change passwords, use the CLI command: <code className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 font-mono text-xs">yarn mercato auth set-password --email &lt;email&gt; --password &lt;newPassword&gt;</code>
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Choose Your Role</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <RoleTile
            icon={<Shield className="size-6" />}
            title="Super Admin"
            description="Full system access with complete control"
            features={[
              'Manage organization structure',
              'Create and manage roles',
              'Manage all users across organizations',
              'System-wide configuration',
              'Access to all modules and features'
            ]}
            loginUrl="/login?role=superadmin"
          />
          
          <RoleTile
            icon={<Users className="size-6" />}
            title="Admin"
            description="Organization-level administration"
            features={[
              'Admin specific organization(s)',
              'Manage users within organization',
              'Configure organization settings',
              'Access to admin modules',
              'Report and analytics access'
            ]}
            loginUrl="/login?role=admin"
            variant="secondary"
          />
          
          <RoleTile
            icon={<Briefcase className="size-6" />}
            title="Employee"
            description="Work on your daily tasks"
            features={[
              'Work on assigned tasks',
              'Access organization resources',
              'Collaborate with team members',
              'View personal dashboard',
              'Submit reports and updates'
            ]}
            loginUrl="/login?role=employee"
            variant="outline"
          />
        </div>
      </section>

      <section className="rounded-lg border p-4 flex items-center justify-center gap-3">
        <Checkbox
          id="show-start-page"
          checked={showStartPage}
          onCheckedChange={handleCheckboxChange}
        />
        <label
          htmlFor="show-start-page"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
        >
          Display this start page next time
        </label>
      </section>
    </>
  )
}

