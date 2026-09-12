import { createRouter, type RouteDefinition } from 'workstar-router';
import { renderDocument, type PageDocument } from './document.js';

export { FormBodyError, readFormDataWithinLimit } from './form.js';
export type { HeadEntry, PageDocument } from './document.js';
export { renderDocument } from './document.js';

export interface RequestContext<Env> {
  readonly request: Request;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly env: Env;
}

export interface AppRoute<
  Env,
  Name extends string = string,
> extends RouteDefinition<Name> {
  readonly page?: (
    context: RequestContext<Env>,
  ) => PageDocument | Response | Promise<PageDocument | Response>;
  readonly action?: (
    context: RequestContext<Env>,
  ) => Response | Promise<Response>;
}

export interface AppOptions<Env, Name extends string> {
  readonly routes: readonly AppRoute<Env, Name>[];
  readonly notFound?: (
    context: Omit<RequestContext<Env>, 'params'>,
  ) => PageDocument | Response | Promise<PageDocument | Response>;
  readonly onError?: (
    error: unknown,
    context: Omit<RequestContext<Env>, 'params'>,
  ) => Response | Promise<Response>;
}

function allowHeader<Env>(route: AppRoute<Env>): string {
  return [route.page ? 'GET, HEAD' : '', route.action ? 'POST' : '']
    .filter(Boolean)
    .join(', ');
}

function asResponse(value: PageDocument | Response): Response {
  return value instanceof Response ? value : renderDocument(value);
}

function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function redirect(location: string, status = 303): Response {
  if (![301, 302, 303, 307, 308].includes(status)) {
    throw new RangeError('Redirect status must be an HTTP redirect status.');
  }
  return new Response(null, { status, headers: { location } });
}

export function createApp<Env, const Name extends string = string>(
  options: AppOptions<Env, Name>,
) {
  const router = createRouter(
    options.routes.map(({ name, path, validate }) => ({
      name,
      path,
      ...(validate ? { validate } : {}),
    })),
  );
  const routes = new Map(options.routes.map((route) => [route.name, route]));

  return {
    router,
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const context = { request, url, env };
      try {
        const match = router.match(url.pathname);
        if (!match) {
          const missing = await options.notFound?.(context);
          const result = missing
            ? asResponse(
                missing instanceof Response
                  ? missing
                  : { ...missing, status: missing.status ?? 404 },
              )
            : new Response('Not found', { status: 404 });
          return request.method === 'HEAD' ? withoutBody(result) : result;
        }
        const route = routes.get(match.name);
        if (!route) throw new Error(`Missing route handler ${match.name}.`);
        const routeContext = { ...context, params: match.params };
        if (
          (request.method === 'GET' || request.method === 'HEAD') &&
          route.page
        ) {
          const result = asResponse(await route.page(routeContext));
          return request.method === 'HEAD' ? withoutBody(result) : result;
        }
        if (request.method === 'POST' && route.action) {
          return route.action(routeContext);
        }
        return new Response('Method not allowed', {
          status: 405,
          headers: { allow: allowHeader(route) },
        });
      } catch (error) {
        if (options.onError) return options.onError(error, context);
        console.error(
          JSON.stringify({
            message: 'Workstar request failed',
            path: url.pathname,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return new Response('Internal server error', { status: 500 });
      }
    },
  };
}
