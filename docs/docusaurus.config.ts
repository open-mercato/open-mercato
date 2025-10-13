import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';

const config: Config = {
  title: 'Open Mercato Docs',
  tagline: 'Extensible commerce platform with modular architecture',
  favicon: 'img/open-mercato-homepage.jpg',
  url: 'https://docs.open-mercato.dev',
  baseUrl: '/',
  organizationName: 'open-mercato',
  projectName: 'documentation',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],
  plugins: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        indexDocs: true,
        indexBlog: false,
      },
    ],
  ],
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.ts'),
          routeBasePath: '/',
          editUrl: 'https://github.com/open-mercato/open-mercato/tree/main/docs',
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],
  themeConfig: {
    image: 'img/open-mercato-homepage.jpg',
    navbar: {
      title: 'Open Mercato',
      logo: {
        alt: 'Open Mercato Logo',
        src: 'img/open-mercato-homepage.jpg',
      },
      items: [
        {
          type: 'doc',
          docId: 'introduction/overview',
          label: 'Introduction',
          position: 'left',
        },
        {
          href: 'https://github.com/open-mercato/open-mercato',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} Open Mercato. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  },
};

export default config;
