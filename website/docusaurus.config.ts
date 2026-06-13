import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'YAMLAI',
  tagline: 'Write YAML, get a runnable Mastra TypeScript agent project',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Production url + base path for GitHub Pages project site:
  // https://addorimprove.github.io/yamlai/
  url: 'https://addorimprove.github.io',
  baseUrl: '/yamlai/',

  // GitHub pages deployment config.
  organizationName: 'addorimprove', // GitHub org/user that owns the repo
  projectName: 'yamlai', // repo name
  trailingSlash: false,

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/addorimprove/yamlai/tree/main/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'YAMLAI',
      logo: {
        alt: 'YAMLAI Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/features',
          label: 'Features',
          position: 'left',
        },
        {
          href: 'https://github.com/addorimprove/yamlai',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started'},
            {label: 'YAML Reference', to: '/docs/reference/config'},
            {label: 'CLI Reference', to: '/docs/cli'},
            {label: 'Examples', to: '/docs/examples'},
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/addorimprove/yamlai',
            },
            {
              label: 'npm',
              href: 'https://www.npmjs.com/package/@addorimprove/yamlai',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} YAMLAI. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'yaml', 'typescript', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
