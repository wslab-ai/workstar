import { describe, expect, it } from 'vitest';
import { FormBodyError, readFormDataWithinLimit } from '../src/index.js';

describe('bounded form parser', () => {
  it('reads a URL-encoded form under the limit', async () => {
    const request = new Request('https://example.test/contact', {
      method: 'POST',
      body: new URLSearchParams({ name: 'Ada' }),
    });
    const form = await readFormDataWithinLimit(request, 1024);
    expect(form.get('name')).toBe('Ada');
  });

  it('reads multipart files and preserves their names', async () => {
    const data = new FormData();
    data.set(
      'attachment',
      new File(['test archive'], 'notes.zip', { type: 'application/zip' }),
    );
    const request = new Request('https://example.test/contact', {
      method: 'POST',
      body: data,
    });
    const form = await readFormDataWithinLimit(request, 2048);
    const file = form.get('attachment');
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe('notes.zip');
    expect(await (file as File).text()).toBe('test archive');
  });

  it('rejects oversized bodies even without Content-Length', async () => {
    const request = new Request('https://example.test/contact', {
      method: 'POST',
      body: new URLSearchParams({ name: 'x'.repeat(100) }),
    });
    expect(request.headers.get('content-length')).toBeNull();
    await expect(readFormDataWithinLimit(request, 32)).rejects.toMatchObject({
      name: 'FormBodyError',
      status: 413,
    });
  });

  it('rejects unsupported and malformed forms', async () => {
    await expect(
      readFormDataWithinLimit(
        new Request('https://example.test/contact', {
          method: 'POST',
          body: '{}',
          headers: { 'content-type': 'application/json' },
        }),
        1024,
      ),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      readFormDataWithinLimit(
        new Request('https://example.test/contact', {
          method: 'POST',
          body: 'not-multipart',
          headers: { 'content-type': 'multipart/form-data; boundary=bad' },
        }),
        1024,
      ),
    ).rejects.toBeInstanceOf(FormBodyError);
  });
});
