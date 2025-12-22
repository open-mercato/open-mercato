import { ContentLayout } from '../components/ContentLayout'

export default function PrivacyPage() {
  return (
    <ContentLayout
      title="Privacy Policy"
      intro="Last updated: January 1, 2025"
      breadcrumb={[
        { label: 'Home', href: '/' },
        { label: 'Privacy Policy' },
      ]}
    >
      <p>
        This Privacy Policy explains how data is handled within the Open Mercato demo environment (the &ldquo;Service&rdquo;).
        Because the Service is intended solely for evaluation, information may be deleted without notice.
      </p>

      <h2>1. Data Collected</h2>
      <ul>
        <li>Account details you create manually (e.g., email addresses, names).</li>
        <li>Operational data you enter into demo modules (e.g., customer or catalog information).</li>
        <li>Technical metadata such as timestamps and basic logging for diagnostics.</li>
      </ul>

      <h2>2. Cookies</h2>
      <p>
        We use essential cookies to remember interface preferences (for example, dismissing demo notices). These cookies
        do not track users across services and expire automatically after a period of time.
      </p>

      <h2>3. Data Retention</h2>
      <p>
        Demo data is periodically rotated to maintain a clean environment. No guarantees are made regarding data
        retention or backup. Treat all information entered into the Service as temporary.
      </p>

      <h2>4. Third-Party Services</h2>
      <p>
        The Service may integrate with third-party infrastructure (email delivery, telemetry, or file storage) solely for
        demonstration. These integrations inherit their own privacy policies.
      </p>

      <h2>5. Your Responsibilities</h2>
      <p>
        Do not submit personal, sensitive, or production data. If you inadvertently upload such information, delete it
        immediately or contact us for assistance.
      </p>

      <h2>6. Contact</h2>
      <p>
        For privacy-related questions, email{' '}
        <a href="mailto:info@catchthetornado.com">info@catchthetornado.com</a>.
      </p>
    </ContentLayout>
  )
}
