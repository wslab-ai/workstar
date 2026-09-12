import { describe, expect, it } from 'vitest';
import { html } from 'workstar';
import { createApp, redirect, renderDocument } from '../src/index.js';

interface TestEnv {
  readonly greeting: string;
}

const app = createApp<TestEnv>({
  routes: [
    {
      name: 'home',
      path: '/',
      page: ({ env }) => ({
        lang: 'en',
        title: 'Home',
        content: html`<main><h1>${env.greeting}</h1></main>`,
      }),
    },
    {
      name: 'article',
      path: '/:locale?/articles/:slug',
      validate: { locale: (value) => ['en', 'de'].includes(value) },
      page: ({ params }) => ({
        lang: params.locale ?? 'en',
        title: params.slug ?? '',
        content: html`<article>${params.slug}</article>`,
      }),
    },
    {
      name: 'contact',
      path: '/contact',
      page: () => ({
        lang: 'en',
        title: 'Contact',
        content: html`<form></form>`,
      }),
      action: async ({ request }) => {
        const data = await request.formData();
        return redirect(
          `/thanks?name=${encodeURIComponent(String(data.get('name')))}`,
        );
      },
    },
  ],
  notFound: () => ({
    lang: 'en',
    title: 'Not found',
    content: html`<h1>Not found</h1>`,
  }),
});

const env = { greeting: '<Welcome>' };

describe('Fetch-native application', () => {
  it('renders a server page without JavaScript', async () => {
    const response = await app.fetch(new Request('https://example.test/'), env);
    const page = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(page).toContain('<title>Home</title>');
    expect(page).toContain('&lt;Welcome&gt;');
    expect(page).not.toContain('<script');
  });

  it('uses the shared router for locale and article paths', async () => {
    expect(app.router.href('article', { locale: 'de', slug: 'new' })).toBe(
      '/de/articles/new',
    );
    const response = await app.fetch(
      new Request('https://example.test/de/articles/new'),
      env,
    );
    expect(await response.text()).toContain('<html lang="de">');
    expect(
      (
        await app.fetch(
          new Request('https://example.test/fr/articles/new'),
          env,
        )
      ).status,
    ).toBe(404);
  });

  it('returns correct HEAD, 404, and 405 responses', async () => {
    const head = await app.fetch(
      new Request('https://example.test/', { method: 'HEAD' }),
      env,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(
      (await app.fetch(new Request('https://example.test/missing'), env))
        .status,
    ).toBe(404);
    const method = await app.fetch(
      new Request('https://example.test/', { method: 'POST' }),
      env,
    );
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET, HEAD');
  });

  it('dispatches a no-JavaScript form action', async () => {
    const request = new Request('https://example.test/contact', {
      method: 'POST',
      body: new URLSearchParams({ name: 'Ada Lovelace' }),
    });
    const response = await app.fetch(request, env);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      '/thanks?name=Ada%20Lovelace',
    );
  });
});

describe('document boundaries', () => {
  it('escapes metadata and supports canonical, hreflang, and JSON-LD', async () => {
    const response = renderDocument({
      lang: 'zh-Hans',
      title: 'A < B',
      description: 'A "description"',
      content: html`<main>Content</main>`,
      head: [
        {
          kind: 'link',
          rel: 'canonical',
          href: 'https://example.test/a?x=1&y=2',
        },
        { kind: 'link', rel: 'alternate', hreflang: 'en', href: '/en' },
        {
          kind: 'json-ld',
          value: { name: '</script><script>alert(1)</script>' },
        },
      ],
      stylesheets: ['/assets/app.css'],
    });
    const page = await response.text();
    expect(page).toContain('<title>A &lt; B</title>');
    expect(page).toContain('content="A &quot;description&quot;"');
    expect(page).toContain('href="https://example.test/a?x=1&amp;y=2"');
    expect(page).toContain('hreflang="en"');
    expect(page).toContain('\\u003c/script>');
    expect(page).not.toContain('</script><script>alert');
  });

  it('rejects executable link protocols and invalid language tags', () => {
    expect(() =>
      renderDocument({
        lang: 'en',
        title: 'Unsafe',
        content: '',
        head: [{ kind: 'link', rel: 'canonical', href: 'javascript:alert(1)' }],
      }),
    ).toThrow(/HTTP/);
    expect(() =>
      renderDocument({ lang: 'en" onclick="x', title: '', content: '' }),
    ).toThrow(/BCP 47/);
  });
});
