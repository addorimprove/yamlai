import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// Explicit sidebar for the YAMLAI docs.
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'YAML Reference',
      collapsed: false,
      items: [
        'reference/config',
        'reference/agent',
        'reference/model',
        'reference/prompt',
        'reference/tools',
        'reference/memory',
        'reference/workflow',
      ],
    },
    'cli',
    'examples',
    'features',
  ],
};

export default sidebars;
