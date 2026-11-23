/**
 * Example data for the NDA review demo. All parties and people are fictional.
 * The rule codes match the sample agreements, so a review run produces findings.
 */

export const DEMO_PLAYBOOK = {
  code: 'nda-standard',
  name: 'Standard NDA review',
  description: 'House positions for mutual and one-way non-disclosure agreements.',
  instructions:
    'Review the agreement clause by clause against the rules below. Quote the exact passage for every finding and propose replacement wording where a rule defines preferred wording.',
} as const

export type DemoReviewRule = {
  code: string
  title: string
  topic: string
  position: string
  preferredWording: string | null
  severity: 'blocking' | 'warning' | 'info'
}

export const DEMO_REVIEW_RULES: DemoReviewRule[] = [
  {
    code: 'NDA-2.1',
    title: 'Definition of Confidential Information',
    topic: 'Definitions',
    position: 'Cover information marked as confidential or reasonably understood to be confidential, in any form.',
    preferredWording:
      'that is marked as confidential or would reasonably be understood to be confidential given its nature and the circumstances of disclosure',
    severity: 'warning',
  },
  {
    code: 'NDA-3.1',
    title: 'Confidentiality term',
    topic: 'Obligations',
    position: 'Obligations cannot run forever. Five years from each disclosure; trade secrets for as long as they stay secret.',
    preferredWording: 'for five (5) years from the date of each disclosure',
    severity: 'blocking',
  },
  {
    code: 'NDA-3.2',
    title: 'Return or destruction',
    topic: 'Return of information',
    position: 'Recipient returns or destroys within 30 days and may keep archival copies required by law.',
    preferredWording:
      'return or destroy all Confidential Information within thirty (30) days, save for copies retained under applicable law or automatic backup',
    severity: 'warning',
  },
  {
    code: 'NDA-3.3',
    title: 'Residuals clause',
    topic: 'Residuals',
    position: 'Reject residuals clauses that let the recipient reuse information retained in memory.',
    preferredWording: null,
    severity: 'warning',
  },
  {
    code: 'NDA-4.1',
    title: 'Governing law',
    topic: 'Governing law',
    position: 'Governed by the laws of England and Wales with exclusive jurisdiction of its courts.',
    preferredWording:
      'This Agreement is governed by the laws of England and Wales, and the courts of England have exclusive jurisdiction.',
    severity: 'blocking',
  },
  {
    code: 'NDA-4.2',
    title: 'Assignment',
    topic: 'Assignment',
    position: 'Neither party may assign without prior written consent, except to an affiliate or a successor of the business.',
    preferredWording: null,
    severity: 'warning',
  },
  {
    code: 'NDA-5.1',
    title: 'No non-solicitation in an NDA',
    topic: 'Non-solicitation',
    position: 'An NDA must not restrict hiring. Non-solicitation belongs in a commercial agreement, if anywhere.',
    preferredWording: null,
    severity: 'blocking',
  },
  {
    code: 'NDA-5.2',
    title: 'No liquidated damages',
    topic: 'Remedies',
    position: 'Remedies are injunctive relief and proven damages. No pre-agreed penalty amounts.',
    preferredWording:
      'Each party acknowledges that damages may not be an adequate remedy and the disclosing party may seek injunctive relief.',
    severity: 'blocking',
  },
  {
    code: 'NDA-6.1',
    title: 'Mutuality',
    topic: 'Parties',
    position: 'Prefer mutual obligations when both parties will exchange information.',
    preferredWording: null,
    severity: 'info',
  },
  {
    code: 'NDA-6.2',
    title: 'Permitted disclosures',
    topic: 'Exceptions',
    position: 'Allow disclosure to advisers and affiliates under equivalent confidentiality obligations.',
    preferredWording: null,
    severity: 'info',
  },
  {
    code: 'NDA-6.3',
    title: 'Compelled disclosure',
    topic: 'Exceptions',
    position: 'Allow disclosure required by law or regulator, with prompt notice where lawful.',
    preferredWording: null,
    severity: 'info',
  },
  {
    code: 'NDA-6.4',
    title: 'No licence',
    topic: 'Ownership',
    position: 'Disclosure grants no licence or ownership rights.',
    preferredWording: null,
    severity: 'info',
  },
]

/** HTML produced by the Documents Markdown import, stored pre-rendered. */
export type DemoDocument = {
  key: string
  title: string
  html: string
}

export const DEMO_GUIDANCE_DOCUMENTS: DemoDocument[] = [
  {
    key: 'wiki-confidentiality-term',
    title: 'Wiki: Why we cap confidentiality at five years',
    html: [
      "<h1>Wiki: Why we cap confidentiality at five years</h1>",
      "<p>Applies to rule <strong>NDA-3.1</strong>.</p>",
      "<p>Perpetual obligations are unenforceable in several jurisdictions and create tracking cost with no end date.</p>",
      "<p><strong>House position:</strong> five years from each disclosure. Trade secrets stay protected for as long as they remain secret.</p>",
      "<p><strong>Warning (lawyer decides):</strong> a fixed term longer than five years, for example ten years after the last disclosure.</p>",
      "<p><strong>Red line:</strong> obligations &quot;in perpetuity&quot; or with no end date.</p>",
    ].join(''),
  },
  {
    key: 'wiki-non-solicitation',
    title: 'Wiki: Non-solicitation does not belong in NDAs',
    html: [
      "<h1>Wiki: Non-solicitation does not belong in NDAs</h1>",
      "<p>Applies to rule <strong>NDA-5.1</strong>.</p>",
      "<p>An NDA protects information. Restrictions on hiring need a commercial reason and approval from the people team, so they belong in a commercial agreement, if anywhere.</p>",
      "<p><strong>House position:</strong> strike non-solicitation and no-hire clauses from NDAs.</p>",
      "<p><strong>Narrow exception (warning, not a red line):</strong> a mutual clause limited to people directly involved in the project, lasting no more than six months, that excludes general job advertisements. The reviewing lawyer decides.</p>",
    ].join(''),
  },
  {
    key: 'wiki-remedies',
    title: 'Wiki: Remedies and liquidated damages',
    html: [
      "<h1>Wiki: Remedies and liquidated damages</h1>",
      "<p>Applies to rule <strong>NDA-5.2</strong>.</p>",
      "<p>We accept injunctive relief and damages proven in court. We do not accept pre-agreed penalty amounts in an NDA. They are often out of proportion to the actual loss and are hard to insure.</p>",
      "<p><strong>House position:</strong> &quot;Each party acknowledges that damages may not be an adequate remedy and the disclosing party may seek injunctive relief.&quot;</p>",
      "<p><strong>Red lines:</strong> liquidated damages, fixed penalties per breach, indemnities for &quot;any loss&quot; arising from a breach.</p>",
    ].join(''),
  },
  {
    key: 'wiki-governing-law',
    title: 'Wiki: Governing law fallback positions',
    html: [
      "<h1>Wiki: Governing law fallback positions</h1>",
      "<p>Applies to rule <strong>NDA-4.1</strong>.</p>",
      "<p><strong>Preferred:</strong> the laws of England and Wales, with exclusive jurisdiction of the English courts.</p>",
      "<p><strong>Acceptable without escalation:</strong> the law of the defendant&#x27;s home country, or Ireland or the Netherlands.</p>",
      "<p><strong>Warning (lawyer decides):</strong> another EU member state, for example Germany.</p>",
      "<p><strong>Red line:</strong> any US state law (Delaware, New York, California and others) on counterparty paper. Escalate to the legal director if the counterparty refuses to move.</p>",
    ].join(''),
  },
]

export const DEMO_AGREEMENTS: DemoDocument[] = [
  {
    key: 'nda-red-lines',
    title: 'LG-2001 · Mutual NDA · Harbor Lane Analytics',
    html: [
      "<h1>Mutual Non-Disclosure Agreement</h1>",
      "<p>LG-2001 · V1 DRAFT · Counterparty paper</p>",
      "<p><em>between the Company and Harbor Lane Analytics Inc.</em></p>",
      "<h2>1. Parties</h2>",
      "<p>This Mutual Non-Disclosure Agreement (the &quot;Agreement&quot;) is made on 3 November 2026 between Harbor Lane Analytics Inc., a Delaware corporation (&quot;Harbor Lane&quot;), and the Company (each a &quot;Party&quot;), to evaluate a joint customer analytics offering (the &quot;Purpose&quot;).</p>",
      "<h2>2. Confidentiality</h2>",
      "<h3>2.1 Definition</h3>",
      "<p>&quot;Confidential Information&quot; means all information disclosed by either Party that is marked as confidential at the time of disclosure.</p>",
      "<h3>2.2 Obligations</h3>",
      "<p>The receiving Party shall hold Confidential Information in strict confidence and use it only for the Purpose. These obligations survive in perpetuity.</p>",
      "<h3>2.3 Return of information</h3>",
      "<p>On request, the receiving Party shall destroy all Confidential Information within 10 days.</p>",
      "<h3>2.4 Residuals</h3>",
      "<p>Nothing in this Agreement restricts either Party from using general knowledge, skills and experience retained in the unaided memory of its personnel.</p>",
      "<h2>3. Commercial terms</h2>",
      "<h3>3.1 Non-solicitation</h3>",
      "<p>For eighteen months after the date of this Agreement, neither Party shall solicit or hire any employee of the other Party.</p>",
      "<h3>3.2 Remedies</h3>",
      "<p>Any breach of this Agreement entitles the disclosing Party to liquidated damages of USD 500,000 per breach.</p>",
      "<h2>4. General</h2>",
      "<h3>4.1 Assignment</h3>",
      "<p>Harbor Lane may assign this Agreement to any third party without consent.</p>",
      "<h3>4.2 Governing law</h3>",
      "<p>This Agreement is governed by the laws of the State of Delaware.</p>",
      "<h3>4.3 Term</h3>",
      "<p>This Agreement remains in force until terminated by Harbor Lane.</p>",
    ].join(''),
  },
  {
    key: 'nda-clean',
    title: 'LG-2002 · Mutual NDA · Brightwater Logistics',
    html: [
      "<h1>Mutual Non-Disclosure Agreement</h1>",
      "<p>LG-2002 · V1 DRAFT · Our paper</p>",
      "<p><em>between the Company and Brightwater Logistics Ltd</em></p>",
      "<h2>1. Parties</h2>",
      "<p>This Mutual Non-Disclosure Agreement (the &quot;Agreement&quot;) is made on 4 November 2026 between Brightwater Logistics Ltd, a company registered in England and Wales (&quot;Brightwater&quot;), and the Company (each a &quot;Party&quot;), to evaluate a warehouse capacity partnership (the &quot;Purpose&quot;).</p>",
      "<h2>2. Confidentiality</h2>",
      "<h3>2.1 Definition</h3>",
      "<p>&quot;Confidential Information&quot; means all information disclosed by either Party, in any form, that is marked as confidential or would reasonably be understood to be confidential given its nature and the circumstances of disclosure.</p>",
      "<h3>2.2 Obligations</h3>",
      "<p>The receiving Party shall hold Confidential Information in confidence and use it only for the Purpose, for five (5) years from the date of each disclosure. Trade secrets remain protected for as long as they remain trade secrets under applicable law.</p>",
      "<h3>2.3 Return of information</h3>",
      "<p>On written request, the receiving Party shall return or destroy all Confidential Information within thirty (30) days and confirm this in writing, save for copies retained under applicable law or in automatic backup systems.</p>",
      "<h3>2.4 Permitted disclosures</h3>",
      "<p>The receiving Party may disclose Confidential Information to its affiliates, employees and professional advisers who need to know it for the Purpose and are bound by obligations of confidentiality no less protective than this Agreement.</p>",
      "<h3>2.5 Compelled disclosure</h3>",
      "<p>The receiving Party may disclose Confidential Information to the extent required by law or by a competent regulator, provided it gives the disclosing Party prompt notice where lawful.</p>",
      "<h2>3. Ownership</h2>",
      "<p>No licence or other right in Confidential Information is granted by this Agreement, other than to use it for the Purpose.</p>",
      "<h2>4. Remedies</h2>",
      "<p>Each Party acknowledges that damages may not be an adequate remedy for breach of this Agreement and that the disclosing Party may seek injunctive relief.</p>",
      "<h2>5. General</h2>",
      "<h3>5.1 Assignment</h3>",
      "<p>Neither Party may assign this Agreement without the prior written consent of the other, except to an affiliate or a successor to its business.</p>",
      "<h3>5.2 Governing law</h3>",
      "<p>This Agreement is governed by the laws of England and Wales, and the courts of England have exclusive jurisdiction.</p>",
    ].join(''),
  },
  {
    key: 'nda-mixed-warnings',
    title: 'LG-2003 · One-way NDA · Quillfeather Software',
    html: [
      "<h1>One-Way Non-Disclosure Agreement</h1>",
      "<p>LG-2003 · V2 DRAFT · Counterparty paper</p>",
      "<p><em>from Quillfeather Software GmbH to the Company</em></p>",
      "<h2>1. Parties</h2>",
      "<p>This One-Way Non-Disclosure Agreement (the &quot;Agreement&quot;) is made on 5 November 2026 between Quillfeather Software GmbH (&quot;Discloser&quot;) and the Company (&quot;Recipient&quot;), so that the Recipient can evaluate the Discloser&#x27;s document automation platform (the &quot;Purpose&quot;).</p>",
      "<h2>2. Confidentiality</h2>",
      "<h3>2.1 Definition</h3>",
      "<p>&quot;Confidential Information&quot; means information disclosed by the Discloser in writing and marked &quot;Confidential&quot;.</p>",
      "<h3>2.2 Obligations</h3>",
      "<p>The Recipient shall keep Confidential Information confidential and use it only for the Purpose for three (3) years from the date of disclosure.</p>",
      "<h3>2.3 Permitted disclosures</h3>",
      "<p>The Recipient may disclose Confidential Information only to its employees who need to know it for the Purpose.</p>",
      "<h3>2.4 Return of information</h3>",
      "<p>Upon the Discloser&#x27;s request, the Recipient shall return all Confidential Information within fourteen (14) days. Destruction is not an acceptable alternative.</p>",
      "<h2>3. Ownership</h2>",
      "<p>All Confidential Information remains the property of the Discloser.</p>",
      "<h2>4. Remedies</h2>",
      "<p>The Discloser may seek injunctive relief in addition to any other remedy available at law.</p>",
      "<h2>5. General</h2>",
      "<h3>5.1 Assignment</h3>",
      "<p>Neither Party may assign this Agreement without the prior written consent of the other.</p>",
      "<h3>5.2 Governing law</h3>",
      "<p>This Agreement is governed by the laws of Germany, and the courts of Munich have exclusive jurisdiction.</p>",
      "<h3>5.3 Audit</h3>",
      "<p>The Discloser may audit the Recipient&#x27;s premises and systems on 48 hours&#x27; notice to verify compliance with this Agreement.</p>",
    ].join(''),
  },
  {
    key: 'nda-edge-cases',
    title: 'LG-2004 · Short-form NDA · Pinecrest Health Partners',
    html: [
      "<h1>Short-Form Mutual NDA</h1>",
      "<p>LG-2004 · V1 DRAFT · Counterparty paper</p>",
      "<p><em>between the Company and Pinecrest Health Partners LLC</em></p>",
      "<h2>1. Purpose</h2>",
      "<p>The Parties wish to discuss a possible data-sharing pilot for appointment scheduling (the &quot;Purpose&quot;).</p>",
      "<h2>2. Confidential Information</h2>",
      "<p>Confidential Information means any information either Party shares about the Purpose, whether oral, written or electronic, including any information the receiving Party learns by observing the disclosing Party&#x27;s systems.</p>",
      "<h2>3. Duties</h2>",
      "<p>Each Party will protect the other&#x27;s Confidential Information with at least reasonable care and will not use it except for the Purpose. These duties last for ten (10) years after the last disclosure.</p>",
      "<h2>4. Exceptions</h2>",
      "<p>These duties do not apply to information that is public, already known to the receiving Party, independently developed, or received from a third party without restriction.</p>",
      "<h2>5. Personal data</h2>",
      "<p>The Parties may exchange patient personal data under this Agreement.</p>",
      "<h2>6. No obligation</h2>",
      "<p>Nothing in this Agreement obliges either Party to enter into any further agreement.</p>",
      "<h2>7. Return or destruction</h2>",
      "<p>Each Party will return or destroy the other&#x27;s Confidential Information within thirty (30) days of a written request.</p>",
      "<h2>8. Governing law</h2>",
      "<p>This Agreement is governed by the laws of the State of New York.</p>",
      "<h2>9. Non-solicitation</h2>",
      "<p>Neither Party will knowingly solicit the other&#x27;s employees directly involved in the Purpose for six months. General job advertisements are not solicitation.</p>",
    ].join(''),
  },
]
