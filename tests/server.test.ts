import { describe, expect, it } from 'vitest';
import { attr, html, on, signal } from '../src/index.js';
import { renderToString } from '../src/server.js';

describe('server rendering', () => {
  it('renders without a DOM and escapes untrusted text and attributes', () => {
    const content = html`<a
      ${attr('href', '/safe?x="&y=<')}
      ${attr('aria-label', 'A "quoted" label')}
      ${on('click', () => {})}
      >${'<script>alert(1)</script>'}</a
    >`;

    expect(renderToString(content)).toContain(
      'href="/safe?x=&quot;&amp;y=&lt;"',
    );
    expect(renderToString(content)).toContain('A &quot;quoted&quot; label');
    expect(renderToString(content)).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(renderToString(content)).not.toContain('onclick=');
  });

  it('renders nested templates, arrays, and signal values with markers', () => {
    const title = signal('Ready');
    const content = html`<section>
      <h1>${title}</h1>
      ${[html`<p>${'One'}</p>`, html`<p>${'Two'}</p>`]}
    </section>`;
    const output = renderToString(content);

    expect(output).toContain('<h1><!--workstar-slot-0-->Ready');
    expect(output).toContain('<!--workstar-array-0--><p>');
    expect(output).toContain('<!--workstar-array-1--><p>');
  });

  it('rejects unsafe URLs and invalid interpolation contexts', () => {
    expect(() =>
      renderToString(html`<a ${attr('href', 'javascript:alert(1)')}>x</a>`),
    ).toThrow('Unsafe URL');
    expect(() => renderToString(html`<a href="${'value'}">x</a>`)).toThrow(
      'Dynamic attributes',
    );
    expect(() => renderToString(html`<p>${attr('title', 'x')}</p>`)).toThrow(
      'Directives must be placed',
    );
    expect(() => renderToString(html`<textarea>${'text'}</textarea>`)).toThrow(
      'Child expressions',
    );
    expect(() =>
      renderToString(
        html`<script>
          ${'text'};
        </script>`,
      ),
    ).toThrow('Child expressions');
  });
});
