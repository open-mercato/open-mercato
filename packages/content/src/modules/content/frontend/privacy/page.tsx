import { ContentLayout } from '../components/ContentLayout'

export default function PrivacyPage() {
  return (
    <ContentLayout
      title="Privacy Policy"
      intro="Last Updated: January 1, 2026"
      breadcrumb={[
        { label: 'Home', href: '/' },
        { label: 'Privacy Policy' },
      ]}
    >
      <p>
        <strong>This Privacy Policy</strong> (this &ldquo;Policy&rdquo;) describes how <strong>CT Tornado</strong> sp. z o.o.,
        a company duly incorporated and existing under the laws of the Republic of Poland, with its principal place of business
        in Wroclaw (address: ul. Wyspa S&#322;odowa 7, 50-266 Wroclaw, Poland; registration: District Court for
        Wroc&#322;aw-Fabryczna in Wroclaw, company no.: 873910; EU VAT no.: PL8982262377; share capital: PLN 5,000.00;
        &ldquo;we&rdquo;) collects, uses, stores, and protects personal data in connection with the services provided through
        our platform (the &ldquo;<strong>Platform</strong>&rdquo; and &ldquo;<strong>Services</strong>&rdquo;, respectively),
        the browsing of our website at{' '}
        <a href="https://openmercato.com" target="_blank" rel="noreferrer">https://openmercato.com</a>{' '}
        (the &ldquo;<strong>Site</strong>&rdquo;), as well as our sales and marketing activities relating to our own Services
        (including responding to inquiries, maintaining business relationships, and sending product or company updates where
        permitted by law).
      </p>
      <p>
        This Policy applies to the Platform accessible at{' '}
        <a href="https://demo.openmercato.com" target="_blank" rel="noreferrer">https://demo.openmercato.com</a>{' '}
        and to related informational resources, including technical and feature documentation available at{' '}
        <a href="https://docs.openmercato.com" target="_blank" rel="noreferrer">https://docs.openmercato.com</a>.
      </p>
      <p>It applies to the personal data of:</p>
      <ul>
        <li>Customers (entities or individuals who enter into a direct contractual relationship with us),</li>
        <li>Customer Representatives (individuals acting on behalf of a Customer),</li>
        <li>Authorized Users (e.g., a Customer&rsquo;s employees, contractors, or other personnel who access the Services under the Customer&rsquo;s Account),</li>
        <li>Site Visitors (individuals who access or browse the Site without creating an Account),</li>
        <li>Prospects and Marketing Recipients (individuals who contact us, subscribe to updates, attend our events/webinars, download materials, or otherwise receive or may receive information about our Services).</li>
      </ul>
      <p>
        This Policy does not apply to data independently processed by Customers or third parties outside the hosted Platform
        environment&mdash;for example, data managed in their own systems, integrations, or external applications. Customers
        remain solely responsible for such external processing activities.
      </p>
      <p>
        We are committed to safeguarding your privacy in accordance with applicable data-protection laws, including the
        General Data Protection Regulation (the &ldquo;<strong>GDPR</strong>&rdquo;) and the California Consumer Privacy Act
        (the &ldquo;<strong>CCPA</strong>&rdquo;).
      </p>
      <p>
        By continuing to use our Site, Platform, and Services, you acknowledge that you have read and understood this Policy
        and agree to our collection, use, and disclosure of personal data as described herein.
      </p>
      <p>
        Capitalized terms used in this Policy, to the extent not defined herein, have the meanings assigned to them in our{' '}
        <a href="/terms">Terms of Service</a>, which govern access to and use of the Platform and Services.
      </p>

      <h2>1. Information We Collect</h2>
      <p>We collect personal data from or about you in the following ways:</p>
      <h3>Account Registration &amp; Management (Customers, Customer Representatives, Authorized Users)</h3>
      <ul>
        <li><strong>Contact and Identification Details:</strong> Name, email address, login credentials, role within the Customer&rsquo;s organization.</li>
        <li><strong>Usage Data:</strong> Login history, IP address, device information, browser type, and access logs.</li>
      </ul>
      <h3>Site Browsing (Site Visitors)</h3>
      <ul>
        <li><strong>Technical and Usage Data:</strong> IP address, cookies or similar technologies, browser information, pages viewed, and interactions on the Site, collected for analytics and security. We may also collect information about interactions with marketing content (e.g., campaign parameters) via cookies or similar technologies, subject to applicable consent requirements.</li>
      </ul>
      <h3>Communications and Support (All Categories)</h3>
      <ul>
        <li>Information shared through email inquiries, contact forms, or customer-support requests.</li>
      </ul>
      <h3>Marketing and Sales Communications (Prospects, Customers, Customer Representatives)</h3>
      <ul>
        <li><strong>Contact Details:</strong> name, business email, company name, job title, country, and related correspondence.</li>
        <li><strong>Lead Source Data:</strong> how you came into contact with us (e.g., website form, event/webinar registration, referral, business card, inbound inquiry).</li>
        <li><strong>Marketing Preferences:</strong> subscription status, communication preferences, and opt-out history.</li>
      </ul>
      <h3>Other Voluntarily Provided Data</h3>
      <ul>
        <li>Any additional information you choose to provide (e.g., job title, preferences).</li>
      </ul>

      <h2>2. Purposes of Processing</h2>
      <p>We process personal data for the following purposes:</p>
      <ul>
        <li><strong>Provision of Services</strong>&mdash;creating and managing Accounts, authenticating users, and delivering contractual obligations under demo or paid access.</li>
        <li><strong>Authorized User Access</strong>&mdash;enabling the Customer&rsquo;s designated personnel to use the Platform.</li>
        <li><strong>Platform Functionality and Improvement</strong>&mdash;ensuring the Platform and Site operate properly, performing usage analytics, optimizing experience, and improving our offerings.</li>
        <li><strong>Marketing of Our Services and Relationship Management</strong>&mdash;sending information about our Services (such as product updates, releases, events, webinars, and educational materials), managing leads and business relationships, and measuring the effectiveness of our communications, in each case where permitted by applicable law and subject to your choices (including opt-out).</li>
        <li><strong>Security and Fraud Prevention</strong>&mdash;monitoring access logs, detecting unauthorized activity, and protecting system integrity.</li>
        <li><strong>Legal Compliance</strong>&mdash;meeting obligations under applicable laws or enforcing our Terms of Service.</li>
        <li><strong>Customer-Created Modules or Entities</strong>&mdash;some Platform features allow Customers to create or upload custom modules or entities that may include personal data; in such cases, Customers act as independent data controllers responsible for compliance with applicable law.</li>
        <li><strong>Tenant Isolation and Optional Sharing</strong>&mdash;each Customer&rsquo;s data is logically isolated from others; cross-tenant visibility occurs only where the Customer deliberately enables data sharing or integration.</li>
      </ul>

      <h2>3. Legal Bases for Processing</h2>
      <p>Our processing relies on one or more of the following legal bases under the GDPR:</p>
      <ul>
        <li><strong>Contractual Necessity</strong>&mdash;processing to perform our obligations (e.g., account setup, service delivery).</li>
        <li><strong>Legitimate Interests</strong>&mdash;for operational needs such as improving the Services and ensuring security, provided those interests do not override your rights; and direct marketing of our own Services to business contacts and relationship management, provided such interests are not overridden by your rights.</li>
        <li><strong>Legal Obligation</strong>&mdash;compliance with laws and regulations (e.g., accounting or lawful requests).</li>
        <li><strong>Consent</strong>&mdash;for certain electronic marketing communications, cookies or tracking technologies that require it under law.</li>
        <li><strong>Demo Access Basis</strong>&mdash;for free-of-charge demo use, our legitimate interest in providing, maintaining, and improving the Platform serves as the legal basis for processing limited personal data needed to enable access.</li>
      </ul>

      <h2>4. Data Recipients and Transfers</h2>
      <p>
        <strong>(a) Internal Access.</strong> Personal data is accessed only by authorized personnel (e.g., support, finance,
        administration).
      </p>
      <p>
        <strong>(b) Third-Party Service Providers.</strong> We share data with trusted vendors who are contractually bound to
        protect it. These providers may include cloud-infrastructure, container-orchestration, and database-hosting services,
        analytics platforms, support tools, and payment processors, customer relationship management (CRM) systems, email
        delivery and marketing-automation providers, webinar/event-registration tools, consent-management platforms, and
        advertising or measurement partners (e.g., for campaign measurement), subject to applicable consent requirements.
      </p>
      <p>
        <strong>(c) International Transfers.</strong> Where data is transferred outside the EEA, we apply appropriate
        safeguards (e.g., Standard Contractual Clauses).
      </p>
      <p>
        <strong>(d) Processor Role and DPA.</strong> If we act as a processor (or subprocessor) on behalf of (or as
        subcontracted by) a Customer, such processing is governed by Section 13 of our{' '}
        <a href="/terms">Terms of Service</a>, which constitutes the Data Processing Addendum
        (&ldquo;<strong>DPA</strong>&rdquo;) under Article 28 GDPR.
      </p>

      <h2>5. Data Retention</h2>
      <p>
        <strong>(a) Standard Retention Periods.</strong> We retain personal data only for as long as necessary to fulfill the
        purposes above or as required by law, namely:
      </p>
      <ul>
        <li><strong>Customers and Authorized Users</strong>&mdash;for the duration of the relationship plus any statutory periods.</li>
        <li><strong>Site Visitors</strong>&mdash;for the duration of the browsing session and analytics retention periods.</li>
        <li><strong>Communications Records</strong>&mdash;for a reasonable time to address inquiries or legal requirements.</li>
        <li><strong>Marketing and Sales Records</strong>&mdash;until you opt out/withdraw consent, or for as long as we maintain an active business relationship, and thereafter for a limited period consistent with our retention practices and any applicable limitation periods.</li>
      </ul>
      <p>
        <strong>(b) Demo or Evaluation Environments.</strong> Personal data submitted to demo environments may be
        automatically deleted, anonymized, or rotated at short intervals (for example, every twenty-four (24) hours). Users
        should not rely on the persistence of any data entered for testing purposes.
      </p>
      <p>
        <strong>(c) Deletion and Anonymization.</strong> After retention expires, data is securely deleted or anonymized.
      </p>

      <h2>6. Data Security</h2>
      <p>
        We implement commercially reasonable technical and organizational measures to safeguard personal data from unauthorized
        access or destruction. These include encryption (where applicable), role-based access controls, secure storage, and
        regular security assessments.
      </p>

      <h2>7. Your Rights Under GDPR</h2>
      <p>Subject to legal exceptions, you may exercise the following rights:</p>
      <ul>
        <li><strong>Access and Rectification</strong>&mdash;see what data we hold and correct errors.</li>
        <li><strong>Erasure and Restriction</strong>&mdash;request deletion or limited processing.</li>
        <li><strong>Portability</strong>&mdash;receive data in a structured, machine-readable format.</li>
        <li><strong>Objection</strong>&mdash;object to processing based on legitimate interests. You have an absolute right to object at any time to the processing of your personal data for direct marketing purposes; if you object, we will stop processing your data for such purposes.</li>
        <li><strong>Withdrawal of Consent</strong>&mdash;withdraw any previous consent without affecting prior lawful processing.</li>
      </ul>
      <p>Authorized Users may need to coordinate such requests through their Customer organization.</p>

      <h2>8. Your Rights Under CCPA</h2>
      <p>If you are a California resident, you have the following rights:</p>
      <ul>
        <li><strong>Right to Know</strong>&mdash;request disclosure of categories and sources of personal information collected.</li>
        <li><strong>Right to Delete</strong>&mdash;ask us to delete personal information, subject to legal exceptions.</li>
        <li><strong>Right to Opt Out of Sale of Personal Information</strong>&mdash;if applicable, you may direct us not to sell your data.</li>
        <li><strong>Right to Non-Discrimination</strong>&mdash;you will not receive different pricing or service levels for exercising your rights.</li>
      </ul>
      <p>
        We do not sell personal information, and we do not share personal information for cross-context behavioral advertising.
      </p>

      <h2>9. How to Exercise Your Rights and Contact Us</h2>
      <p>For requests or questions about this Policy or our data practices, contact us at:</p>
      <ul>
        <li>CT Tornado sp. z o.o., ul. Wyspa S&#322;odowa 7, 50-266 Wroc&#322;aw, Poland.</li>
        <li>Email: <a href="mailto:info@catchthetornado.com">info@catchthetornado.com</a></li>
      </ul>
      <p>
        We will respond within a reasonable time and may request identity verification where appropriate.
      </p>
      <p>
        You may opt out of marketing communications at any time by using the unsubscribe link included in our messages (where
        available) or by contacting us at the email address above. Opting out of marketing does not affect service-related or
        administrative communications (e.g., security, billing, or contractual notices).
      </p>

      <h2>10. Updates to Privacy Policy</h2>
      <p>
        We may update this Policy from time to time to reflect changes in our practices or legal requirements. When updated,
        the &ldquo;Last Updated&rdquo; date will change, and we may notify you by email or on the Site where appropriate.
      </p>
    </ContentLayout>
  )
}
