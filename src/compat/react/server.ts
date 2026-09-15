import { renderToString as renderTemplateToString } from '../../server.js';
import { repeat } from '../../template-model.js';
import {
  disposeComponent,
  runComponent,
  type ComponentInstance,
} from './hooks.js';
import { createIntrinsicView } from './intrinsic.js';
import { childPath, isPromiseLike } from './reconcile.js';
import {
  componentFrame,
  describeComponentError,
  unsupportedElementMessage,
} from './diagnostics.js';
import {
  Fragment,
  Portal,
  StrictMode,
  Suspense,
  attachClassUpdater,
  isClassComponent,
  isElement,
  providerContext,
  type Component as ClassComponent,
  type ComponentType,
  type Context,
  type Element as ReactElement,
} from './vnode.js';

interface ServerArrayItem {
  readonly key: string;
  readonly output: unknown;
}

class ReactServerRenderer {
  readonly #instances: ComponentInstance[] = [];

  render(content: unknown): string {
    try {
      return renderTemplateToString(this.#expand(content, 'root', new Map()));
    } finally {
      for (const instance of this.#instances.reverse())
        disposeComponent(instance);
    }
  }

  #component(
    type: ComponentType,
    props: Readonly<Record<string, unknown>>,
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
  ): unknown {
    if (isClassComponent(type)) {
      const component = new type(props as Record<string, unknown>);
      attachClassUpdater(component, undefined);
      let result: unknown;
      try {
        result = component.render();
      } catch (error) {
        throw describeComponentError(error, type, path);
      }
      try {
        return this.#expand(result, `${path}/render`, context);
      } catch (error) {
        const boundary =
          type.getDerivedStateFromError || component.componentDidCatch;
        if (!boundary || isPromiseLike(error))
          throw describeComponentError(error, type, path);
        const derived = type.getDerivedStateFromError?.(error);
        if (derived) component.state = { ...component.state, ...derived };
        component.componentDidCatch?.(error, {
          componentStack: componentFrame(type, path),
        });
        return this.#expand(component.render(), `${path}/render`, context);
      }
    }
    const instance: ComponentInstance = {
      path,
      hooks: [],
      context,
      scheduleEffect: () => {},
      scheduleLayoutEffect: () => {},
      invalidate: () => {},
      server: true,
      active: true,
      cursor: 0,
      hookCount: undefined,
    };
    this.#instances.push(instance);
    try {
      return this.#expand(
        runComponent(instance, () =>
          (type as (value: Record<string, unknown>) => unknown)(props),
        ),
        `${path}/render`,
        context,
      );
    } catch (error) {
      throw describeComponentError(error, type, path);
    }
  }

  #element(
    node: ReactElement,
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
  ): unknown {
    const { type, props } = node;
    if (type === Portal)
      throw new TypeError('Portals cannot be rendered on the server.');
    if (type === Fragment || type === StrictMode)
      return this.#expand(props.children, `${path}/children`, context);
    if (type === Suspense) {
      try {
        return this.#expand(props.children, `${path}/children`, context);
      } catch (error) {
        if (!isPromiseLike(error)) throw error;
        return this.#expand(props.fallback, `${path}/fallback`, context);
      }
    }
    const provider = providerContext(type);
    if (provider) {
      const next = new Map(context);
      next.set(provider, props.value);
      return this.#expand(props.children, `${path}/provider`, next);
    }
    if (typeof type === 'function')
      return this.#component(type, props, path, context);
    if (typeof type !== 'string')
      throw new TypeError(unsupportedElementMessage(type));
    const children = this.#expand(props.children, `${path}/children`, context);
    return createIntrinsicView(type, props, children).template;
  }

  #array(
    children: readonly unknown[],
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
  ) {
    const items = children.map((child, index): ServerArrayItem => ({
      key:
        isElement(child) && child.key !== null
          ? `key:${String(child.key)}`
          : `index:${index}`,
      output: this.#expand(
        child,
        isElement(child) ? childPath(path, child, index) : `${path}/${index}`,
        context,
      ),
    }));
    return repeat(
      items,
      (item) => item.key,
      (item) => () => item.value.output,
    );
  }

  #expand(
    value: unknown,
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
  ): unknown {
    if (value === null || value === undefined || typeof value === 'boolean')
      return null;
    if (Array.isArray(value)) return this.#array(value, path, context);
    if (isElement(value)) return this.#element(value, path, context);
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint'
    )
      return value;
    throw new TypeError('Unsupported React compatibility child.');
  }
}

/** Render TSX compatibility elements with markers accepted by hydrateRoot. */
export function renderToString(content: unknown): string {
  return new ReactServerRenderer().render(content);
}

/** Render non-hydratable HTML for documents that will stay static. */
export function renderToStaticMarkup(content: unknown): string {
  return renderToString(content)
    .replace(
      /<!--\/?(?:workstar-(?:root|slot-\d+|repeat-\d+|array-\d+))-->/g,
      '',
    )
    .replace(/ data-workstar-directive-\d+=""/g, '');
}
