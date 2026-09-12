import { renderToString } from 'workstar/server';

export type HeadEntry =
  | { readonly kind: 'meta'; readonly name: string; readonly content: string }
  | {
      readonly kind: 'property';
      readonly property: string;
      readonly content: string;
    }
  | {
      readonly kind: 'link';
      readonly rel: string;
      readonly href: string;
      readonly hreflang?: string;
      readonly type?: string;
    }
  | { readonly kind: 'json-ld'; readonly value: unknown };

export interface PageDocument {
  readonly lang: string;
  readonly title: string;
  readonly description?: string;
  readonly content: unknown;
  readonly head?: readonly HeadEntry[];
  readonly stylesheets?: readonly string[];
  readonly scripts?: readonly string[];
  readonly status?: number;
  readonly headers?: HeadersInit;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function assertSafeUrl(value: string): string {
  const url = new URL(value, 'https://workstar.invalid');
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Document asset and link URLs must use HTTP(S).');
  }
  return escapeHtml(value);
}

function renderHead(entry: HeadEntry): string {
  switch (entry.kind) {
    case 'meta':
      return `<meta name="${escapeHtml(entry.name)}" content="${escapeHtml(entry.content)}">`;
    case 'property':
      return `<meta property="${escapeHtml(entry.property)}" content="${escapeHtml(entry.content)}">`;
    case 'link':
      return `<link rel="${escapeHtml(entry.rel)}" href="${assertSafeUrl(entry.href)}"${entry.hreflang ? ` hreflang="${escapeHtml(entry.hreflang)}"` : ''}${entry.type ? ` type="${escapeHtml(entry.type)}"` : ''}>`;
    case 'json-ld': {
      const serialized = JSON.stringify(entry.value);
      if (serialized === undefined) {
        throw new TypeError('JSON-LD value must be JSON-serializable.');
      }
      return `<script type="application/ld+json">${serialized.replace(/</g, '\\u003c')}</script>`;
    }
  }
}

export function renderDocument(page: PageDocument): Response {
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(page.lang)) {
    throw new TypeError('Document lang must be a BCP 47 language tag.');
  }
  if (page.status !== undefined && (page.status < 200 || page.status > 599)) {
    throw new RangeError('Page status must be an HTTP response status.');
  }

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(page.title)}</title>`,
    page.description
      ? `<meta name="description" content="${escapeHtml(page.description)}">`
      : '',
    ...(page.head ?? []).map(renderHead),
    ...(page.stylesheets ?? []).map(
      (href) => `<link rel="stylesheet" href="${assertSafeUrl(href)}">`,
    ),
  ].join('');
  const scripts = (page.scripts ?? [])
    .map((src) => `<script type="module" src="${assertSafeUrl(src)}"></script>`)
    .join('');
  const headers = new Headers(page.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(
    `<!doctype html><html lang="${escapeHtml(page.lang)}"><head>${head}</head><body><div id="app">${renderToString(page.content)}</div>${scripts}</body></html>`,
    { status: page.status ?? 200, headers },
  );
}
