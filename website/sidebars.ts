import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// Explicit sidebar for the YAMLAI docs.
// Order follows the reader's path: learn → build → look up → meta.
// Sidebar labels are friendly nouns; each page's title stays the precise
// filename pattern (e.g. `agent/<id>.yaml`).
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'getting-started',
    'examples',
    {
      type: 'category',
      label: 'YAML Reference',
      collapsed: false,
      items: [
        {type: 'doc', id: 'reference/config', label: 'config.yaml'},
        {
          type: 'category',
          label: 'Agents',
          collapsed: false,
          items: [
            {type: 'doc', id: 'reference/agent', label: 'Agent'},
            {type: 'doc', id: 'reference/model', label: 'Model'},
            {type: 'doc', id: 'reference/prompt', label: 'Prompt'},
            {type: 'doc', id: 'reference/tools', label: 'Tools'},
            {type: 'doc', id: 'reference/memory', label: 'Memory'},
          ],
        },
        {
          type: 'category',
          label: 'Workflows',
          collapsed: false,
          items: [
            {type: 'doc', id: 'reference/workflow', label: 'Workflow'},
            {type: 'doc', id: 'reference/step', label: 'Step'},
            {type: 'doc', id: 'reference/condition', label: 'Condition'},
          ],
        },
      ],
    },
    'cli',
    'features',
  ],
};

export default sidebars;
