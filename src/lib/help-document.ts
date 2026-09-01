import { renderMarkdown } from './markdown'

/**
 * Wraps rendered documentation in a self-contained HTML page. The extension's
 * page policy allows no external resources, so the sheet is inlined and the
 * page carries no script at all.
 */

const FALLBACK_TITLE = 'EchoRead Edge help'

const HELP_STYLES = `
  :root {
    color-scheme: light dark;
    --help-text: #1e293b;
    --help-muted: #64748b;
    --help-surface: #ffffff;
    --help-page: #f1f5f9;
    --help-border: #e2e8f0;
    --help-code: #f8fafc;
    --help-link: #2563eb;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --help-text: #e2e8f0;
      --help-muted: #94a3b8;
      --help-surface: #111827;
      --help-page: #0b1120;
      --help-border: #1f2937;
      --help-code: #0f172a;
      --help-link: #93c5fd;
    }
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 40px 20px 96px;
    color: var(--help-text);
    background: var(--help-page);
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px;
    line-height: 1.65;
  }

  /*
   * The reading column follows the window instead of sitting at a fixed pixel
   * width, which left it a narrow strip on a wide screen. The upper bound keeps
   * a line of prose from growing past what is comfortable to read.
   */
  main {
    width: min(100%, clamp(720px, 74vw, 1280px));
    padding: 44px 52px;
    margin: 0 auto;
    border: 1px solid var(--help-border);
    border-radius: 16px;
    background: var(--help-surface);
    box-shadow: 0 1px 3px rgb(15 23 42 / 6%);
  }

  h1, h2, h3, h4 {
    margin: 2em 0 0.6em;
    color: var(--help-text);
    line-height: 1.3;
    scroll-margin-top: 24px;
  }

  h1 { margin-top: 0; font-size: 28px; }

  /* The page opens on its first heading, which has nothing to divide it from. */
  main > :first-child {
    margin-top: 0;
    padding-top: 0;
    border-top: 0;
  }
  h2 { font-size: 21px; padding-top: 0.5em; border-top: 1px solid var(--help-border); }
  h3 { font-size: 17px; }
  h4 { font-size: 15px; color: var(--help-muted); }

  p, ul, ol, table, pre { margin: 0 0 1.1em; }

  ul, ol { padding-left: 1.4em; }
  li { margin-bottom: 0.4em; }

  a { color: var(--help-link); }

  code {
    padding: 1px 5px;
    border: 1px solid var(--help-border);
    border-radius: 5px;
    background: var(--help-code);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    font-size: 0.87em;
    overflow-wrap: anywhere;
  }

  pre {
    padding: 14px 16px;
    border: 1px solid var(--help-border);
    border-radius: 10px;
    background: var(--help-code);
    overflow-x: auto;
  }

  pre code {
    padding: 0;
    border: 0;
    background: none;
    font-size: 0.85em;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92em;
  }

  th, td {
    padding: 8px 10px;
    border: 1px solid var(--help-border);
    text-align: left;
    vertical-align: top;
  }

  th { background: var(--help-code); font-weight: 600; }
`

/** Renders a Markdown document as a complete, dependency-free help page. */
export function renderHelpDocument(markdown: string): string {
  const body = renderMarkdown(markdown)

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${documentTitle(markdown)}</title>`,
    `<style>${HELP_STYLES}</style>`,
    '</head>',
    '<body>',
    `<main>${body}</main>`,
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

/** Names the page after its own top heading so the browser tab reads well. */
function documentTitle(markdown: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim()

  return escapeText(heading === undefined || heading === '' ? FALLBACK_TITLE : heading)
}

/** Escapes a heading before it is placed in the title element. */
function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
