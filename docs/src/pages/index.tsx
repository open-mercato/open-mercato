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
    to: '/customization/build-first-app',
  },
];

const screenshots = [
  {
    src: '/screenshots/open-mercato-homepage.png',
    alt: 'Open Mercato dashboard overview',
  },
  {
    src: '/screenshots/open-mercato-users-management.png',
    alt: 'Users management list',
  },
  {
    src: '/screenshots/open-mercato-define-custom-fields.png',
    alt: 'Custom fields configuration',
  },
  {
    src: '/screenshots/open-mercato-custom-entity-records.png',
    alt: 'Custom entity records table',
  },
];

const gettingStartedLinks = [
  {
    title: 'Install Locally',
    description: 'Spin up the platform in minutes with the guided setup.',
    to: '/installation/setup',
  },
  {
    title: 'Explore Core Use Cases',
    description: 'See how teams ship CRMs, ERPs, and commerce backends on Open Mercato.',
    to: '/introduction/use-cases',
  },
  {
    title: 'User Guide',
    description: 'Learn the admin workflows from login to managing data entities.',
    to: '/user-guide/overview',
  },
];

function HomepageHeader() {
  return (
    <header className="hero hero--primary">
      <div className="container">
        <h1 className="hero__title">Welcome to Open Mercato</h1>
        <p className="hero__subtitle">
          Open Mercato is a new‑era, AI‑supportive ERP foundation framework.
        </p>
        <p>
          It’s modular, extensible, and designed for teams that want strong defaults with room to customize everything.
        </p>
        <div>
          <Link className="button button--lg button--secondary" to="/introduction/use-cases">
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

function ScreenshotGallery() {
  return (
    <section className="margin-vert--xl">
      <div className="container">
        <h2>Product Screenshots</h2>
        <p>Preview core admin experiences. Click any tile to open the full-size capture.</p>
        <div className="screenshot-grid">
          {screenshots.map((shot) => (
            <a key={shot.src} href={shot.src} target="_blank" rel="noopener noreferrer" className="screenshot-link">
              <img src={shot.src} alt={shot.alt} loading="lazy" className="screenshot-thumb" />
              <span>{shot.alt}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function GettingStarted() {
  return (
    <section className="margin-vert--xl">
      <div className="container">
        <h2>Getting Started</h2>
        <p>Start with setup, understand the platform capabilities, then dive into user-facing workflows.</p>
        <div className="feature-grid">
          {gettingStartedLinks.map((link) => (
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
        <ScreenshotGallery />
        <GettingStarted />
        <FeatureHighlights />
      </main>
    </Layout>
  );
}
