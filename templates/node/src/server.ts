import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app } from './app.js';

const assets = new Set(['/style.css', '/workstar.css']);

function incomingHeaders(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function incomingRequest(message: IncomingMessage): Request {
  const origin = `http://${message.headers.host ?? 'localhost'}`;
  const url = new URL(message.url ?? '/', origin);
  const method = message.method ?? 'GET';
  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : (Readable.toWeb(message) as unknown as ReadableStream<Uint8Array>);
  return new Request(url, {
    method,
    headers: incomingHeaders(message),
    ...(body ? { body, duplex: 'half' as const } : {}),
  });
}

async function sendResponse(
  response: Response,
  message: ServerResponse,
  headOnly = false,
): Promise<void> {
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') message.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) message.setHeader('set-cookie', cookies);
  message.writeHead(response.status);
  if (headOnly) {
    await response.body?.cancel();
    message.end();
    return;
  }
  if (!response.body) {
    message.end();
    return;
  }
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    message,
  );
}

async function handle(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  try {
    const request = incomingRequest(incoming);
    const url = new URL(request.url);
    if (
      assets.has(url.pathname) &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      const file = resolve(process.cwd(), 'public', url.pathname.slice(1));
      const css = await readFile(file);
      await sendResponse(
        new Response(css, {
          headers: { 'content-type': 'text/css; charset=utf-8' },
        }),
        outgoing,
        request.method === 'HEAD',
      );
      return;
    }
    await sendResponse(
      await app.fetch(request, {}),
      outgoing,
      request.method === 'HEAD',
    );
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) {
      outgoing.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      outgoing.end('Internal server error');
    } else {
      outgoing.destroy();
    }
  }
}

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535.');
}
createServer((request, response) => void handle(request, response)).listen(
  port,
  host,
  () => console.log(`Workstar listening on http://${host}:${port}`),
);
