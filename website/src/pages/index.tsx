import {useState, type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

import styles from './index.module.css';

const INSTALL_CMD = 'npx @addorimprove/yamlai ./my-project';

function CommandPill() {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(INSTALL_CMD).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {},
    );
  };

  return (
    <div className={styles.pill}>
      <span className={styles.pillPrompt}>$</span>
      <code className={styles.pillCmd}>{INSTALL_CMD}</code>
      <button
        type="button"
        className={styles.pillCopy}
        onClick={copy}
        aria-label="Copy command to clipboard">
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

/* ---- code window panes (the YAML → TypeScript transformation) ---- */

function YamlPane() {
  return (
    <pre className={styles.code} aria-label="Example agent YAML">
      <code>
        <span className={styles.cmt}># agent/support-agent.yaml</span>
        {'\n'}
        <span className={styles.key}>name</span>
        <span className={styles.pun}>: </span>Support Agent{'\n'}
        <span className={styles.key}>instructions</span>
        <span className={styles.pun}>: </span>support-prompt{'\n'}
        <span className={styles.key}>model</span>
        <span className={styles.pun}>: </span>gpt-5-mini{'\n'}
        <span className={styles.key}>tools</span>
        <span className={styles.pun}>:</span>
        {'\n'}
        <span className={styles.pun}>{'  - '}</span>echo-tool{'\n'}
      </code>
    </pre>
  );
}

function TsPane() {
  return (
    <pre className={styles.code} aria-label="Generated TypeScript agent">
      <code>
        <span className={styles.cmt}>// src/mastra/agents/support-agent.ts</span>
        {'\n'}
        <span className={styles.kw}>export const</span>{' '}
        <span className={styles.fn}>supportAgent</span>
        <span className={styles.pun}> = </span>
        <span className={styles.kw}>new</span>{' '}
        <span className={styles.fn}>Agent</span>
        <span className={styles.pun}>{'({'}</span>
        {'\n'}
        {'  '}id<span className={styles.pun}>: </span>
        <span className={styles.str}>'support-agent'</span>
        <span className={styles.pun}>,</span>
        {'\n'}
        {'  '}instructions<span className={styles.pun}>: </span>
        <span className={styles.str}>{'`You are a helpful…`'}</span>
        <span className={styles.pun}>,</span>
        {'\n'}
        {'  '}model<span className={styles.pun}>: </span>
        <span className={styles.str}>'openai/gpt-5-mini'</span>
        <span className={styles.pun}>,</span>
        {'\n'}
        {'  '}tools<span className={styles.pun}>: {'{ '}</span>echoTool
        <span className={styles.pun}>{' }'}</span>
        <span className={styles.pun}>,</span>
        {'\n'}
        <span className={styles.pun}>{'});'}</span>
      </code>
    </pre>
  );
}

function Showcase() {
  return (
    <div className={styles.showcase}>
      <figure className={`${styles.window} ${styles.reveal}`} style={{['--d' as never]: '.25s'}}>
        <figcaption className={styles.windowBar}>
          <span className={styles.dots} aria-hidden="true">
            <i /> <i /> <i />
          </span>
          <span className={styles.windowTag}>YAML</span>
        </figcaption>
        <YamlPane />
      </figure>

      <div className={`${styles.arrow} ${styles.reveal}`} style={{['--d' as never]: '.4s'}} aria-hidden="true">
        <span className={styles.arrowGlyph}>→</span>
        <span className={styles.arrowLabel}>generate</span>
      </div>

      <figure className={`${styles.window} ${styles.windowOut} ${styles.reveal}`} style={{['--d' as never]: '.55s'}}>
        <figcaption className={styles.windowBar}>
          <span className={styles.dots} aria-hidden="true">
            <i /> <i /> <i />
          </span>
          <span className={styles.windowTag}>TypeScript</span>
        </figcaption>
        <TsPane />
      </figure>
    </div>
  );
}

const STEPS = [
  {
    n: '01',
    title: 'Write YAML',
    body: 'Describe agents, models, prompts, and tools in a handful of small files.',
  },
  {
    n: '02',
    title: 'Generate',
    body: 'One command resolves and inlines everything into a real Mastra project.',
  },
  {
    n: '03',
    title: 'Run & own it',
    body: 'Plain TypeScript with zero YAMLAI dependency. Edit it, ship it, keep it.',
  },
];

function Steps() {
  return (
    <ol className={styles.steps}>
      {STEPS.map((s, i) => (
        <li
          key={s.n}
          className={`${styles.step} ${styles.reveal}`}
          style={{['--d' as never]: `${0.15 * i + 0.7}s`}}>
          <span className={styles.stepNum}>{s.n}</span>
          <h3 className={styles.stepTitle}>{s.title}</h3>
          <p className={styles.stepBody}>{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Write YAML, get a runnable Mastra TypeScript agent project.">
      <main className={styles.page}>
        <div className={styles.grain} aria-hidden="true" />
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <span className={`${styles.eyebrow} ${styles.reveal}`} style={{['--d' as never]: '0s'}}>
              YAML → Mastra codegen
            </span>
            <h1 className={`${styles.title} ${styles.reveal}`} style={{['--d' as never]: '.08s'}}>
              Turn YAML into a
              <br />
              runnable <span className={styles.mark}>Mastra</span> agent app.
            </h1>
            <p className={`${styles.subtitle} ${styles.reveal}`} style={{['--d' as never]: '.16s'}}>
              YAMLAI generates a real{' '}
              <a href="https://mastra.ai" className={styles.inlineLink}>Mastra</a>{' '}
              TypeScript project from a few small YAML files. The YAML is input only —
              the generated code is yours, with no dependency on YAMLAI.
            </p>

            <div className={`${styles.actions} ${styles.reveal}`} style={{['--d' as never]: '.24s'}}>
              <Link className={styles.btnPrimary} to="/docs/getting-started">
                Get Started <span aria-hidden="true">→</span>
              </Link>
              <Link className={styles.btnGhost} to="/docs/examples">
                See an example
              </Link>
            </div>

            <div className={`${styles.reveal}`} style={{['--d' as never]: '.32s'}}>
              <CommandPill />
            </div>
          </div>

          <Showcase />
        </section>

        <section className={styles.how}>
          <h2 className={styles.howHeading}>How it works</h2>
          <Steps />
          <Link className={styles.featuresLink} to="/docs/features">
            See what's supported and what's coming <span aria-hidden="true">↗</span>
          </Link>
        </section>
      </main>
    </Layout>
  );
}
