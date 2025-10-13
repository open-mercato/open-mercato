import React from 'react';
import Layout from '@theme/Layout';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';

const features = [
  {
    title: 'Create API Routes',
    description:
      'Build REST endpoints with typed handlers, feature guards, and generated metadata powered by module di routes.',
    to: '/framework/api/overview',
  },
  {
    title: 'Integrate Workflows',
    description:
      'Subscribe to domain events, publish your own, and orchestrate async jobs without coupling modules together.',
    to: '/framework/events/overview',
  },
  {
    title: 'Design Data Models',
    description:
      'Compose MikroORM entities, extension links, and custom fields that stay tenant-aware and upgrade-safe.',
    to: '/framework/database/entities',
  },
  {
    title: 'Customize Admin UX',
    description:
      'Ship new pages, grids, forms, and dashboard widgets with MDX-driven docs and reusable UI primitives.',
    to: '/customization/modules/quickstart',
  },
];

const quickLinks = [
  {
    title: 'Build Your First Module',
    description: 'Scaffold backend + admin surfaces, exports features, and wire DI services in minutes.',
    to: '/customization/modules/quickstart',
  },
  {
    title: 'Add Custom Entities',
    description: 'Extend your data model with EAV entities and share them across modules safely.',
    to: '/framework/custom-entities/overview',
  },
  {
    title: 'Deploy to Vercel',
    description: 'Bundle the docs site or your product backend for instant previews and production hosting.',
    to: '/installation/deploy-vercel',
  },
];

function HomepageHeader() {
  return (
    <header className="hero hero--primary">
      <div className="container">
        <h1 className="hero__title">Build Extensible Commerce Experiences</h1>
        <p className="hero__subtitle">
          Open Mercato blends a modular backend, customizable admin UI, and typed workflows so your product team can
          ship fast without losing control.
        </p>
        <div>
          <Link className="button button--lg button--secondary" to="/introduction/overview">
            Get Started
          </Link>
          <Link className="button button--lg button--outline button--white margin-left--sm" to="/architecture/system-overview">
            Explore Architecture
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeatureHighlights() {
  return (
    <section className="margin-top--xl">
      <div className="container">
        <h2>Guides to Customization</h2>
        <div className="feature-grid">
          {features.map((feature) => (
            <Link key={feature.title} className="feature-card" to={feature.to}>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function QuickStarts() {
  return (
    <section className="margin-vert--xl">
      <div className="container">
        <h2>Choose Your Adventure</h2>
        <div className="feature-grid">
          {quickLinks.map((link) => (
            <Link key={link.title} className="feature-card" to={link.to}>
              <h3>{link.title}</h3>
              <p>{link.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  return (
    <Layout>
      <Head>
        <meta
          name="description"
          content="Documentation for the Open Mercato framework covering modules, APIs, data extensibility, and admin customization."
        />
      </Head>
      <HomepageHeader />
      <main>
        <FeatureHighlights />
        <QuickStarts />
      </main>
    </Layout>
  );
}
