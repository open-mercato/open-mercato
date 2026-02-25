import React from 'react';
import type { JSX } from 'react';
import Layout from '@theme/Layout';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';

const customizationTutorials = [
  {
    title: 'Build your first Open Mercato app',
    description:
      'Walk through the default application shell, routing overlays, and where to plug in custom modules.',
    to: '/customization/build-first-app',
  },
  {
    title: 'Create your first module',
    description: 'Scaffold the Inventory module and surface its first admin page in the sidebar.',
    to: '/customization/create-first-module',
  },
  {
    title: 'Create the data structures',
    description: 'Model MikroORM entities, validators, and migrations for the Inventory module.',
    to: '/customization/create-inventory-data',
  },
  {
    title: 'Create the data API',
    description: 'Expose REST endpoints for the Inventory module using the CRUD factory.',
    to: '/customization/create-inventory-api',
  },
];

const frameworkHighlights = [
  {
    title: 'Dependency injection container',
    description: 'See how the Awilix container wires services per request.',
    to: '/framework/ioc/container',
  },
  {
    title: 'Module authoring & discovery',
    description: 'Understand how modules are discovered, overridden, and registered across the platform.',
    to: '/framework/modules/overview',
  },
  {
    title: 'Routes and pages',
    description: 'Configure frontend and backend routes with metadata-driven auth and navigation.',
    to: '/framework/modules/routes-and-pages',
  },
  {
    title: 'Entities and migrations',
    description: 'Structure MikroORM entities per module and keep migrations tenant-safe.',
    to: '/framework/database/entities',
  },
];

const userGuideSections = [
  {
    title: 'User guide overview',
    description: 'Tour the admin dashboard experience and learn where to find core tools.',
    to: '/user-guide/overview',
  },
  {
    title: 'Dashboard layout',
    description: 'Understand widgets, navigation, and global search on the home page.',
    to: '/user-guide/overview#what-you-see-on-the-home-page',
  },
  {
    title: 'Login & authentication',
    description: 'Review the sign-in flow, organization picker, and session persistence.',
    to: '/user-guide/login',
  },
  {
    title: 'Resetting access',
    description: 'See how admins and users handle password resets and recovery.',
    to: '/user-guide/login#resetting-access',
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
    title: 'Create a Standalone App',
    description: 'Scaffold a new project with npx create-mercato-app — the fastest way to start building.',
    to: '/customization/standalone-app',
  },
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
    title: 'Discover the architecture',
    description: 'Understand the system topology before extending modules.',
    to: '/architecture/system-overview',
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

function CustomizationTutorials() {
  return (
    <section className="margin-top--xl">
      <div className="container">
        <h2>Customization Tutorial</h2>
        <div className="feature-grid">
          {customizationTutorials.map((tutorial) => (
            <Link key={tutorial.title} className="feature-card" to={tutorial.to}>
              <h3>{tutorial.title}</h3>
              <p>{tutorial.description}</p>
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

function UserGuide() {
  return (
    <section className="margin-vert--xl">
      <div className="container">
        <h2>User Guide</h2>
        <p>Share these guides with operators who need a tour of the admin console and onboarding flows.</p>
        <div className="feature-grid">
          {userGuideSections.map((section) => (
            <Link key={section.title} className="feature-card" to={section.to}>
              <h3>{section.title}</h3>
              <p>{section.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function FrameworkHighlights() {
  return (
    <section className="margin-vert--xl">
      <div className="container">
        <h2>Framework</h2>
        <p>Deep dive into the runtime primitives that power modules, data, and routing.</p>
        <div className="feature-grid">
          {frameworkHighlights.map((highlight) => (
            <Link key={highlight.title} className="feature-card" to={highlight.to}>
              <h3>{highlight.title}</h3>
              <p>{highlight.description}</p>
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
        <UserGuide />
        <GettingStarted />
        <CustomizationTutorials />
        <FrameworkHighlights />
      </main>
    </Layout>
  );
}
