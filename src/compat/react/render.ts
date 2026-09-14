import { signal } from '../../reactivity.js';
import { mount } from '../../template.js';
import {
  disposeComponent,
  runComponent,
  type ComponentInstance,
} from './hooks.js';
import { captureFocus, restoreFocus } from './focus.js';
import { renderIntrinsic } from './intrinsic.js';
import {
  Fragment,
  StrictMode,
  Suspense,
  isElement,
  providerContext,
  type Component,
  type Context,
  type Element as ReactElement,
} from './vnode.js';

interface MountedComponent extends ComponentInstance {
  readonly type: Component;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

function childPath(parent: string, child: ReactElement, index: number): string {
  return `${parent}/${child.key === null ? index : `key:${String(child.key)}`}`;
}

/** Render React-shaped source through Workstar templates and signals. */
export class ReactRoot {
  readonly #host: Element;
  readonly #revision = signal(0);
  readonly #instances = new Map<string, MountedComponent>();
  readonly #seen = new Set<string>();
  readonly #pendingEffects: Array<() => void> = [];
  #disposeMount: (() => void) | undefined;
  #effectFlushQueued = false;
  #content: unknown;
  #closed = false;

  constructor(host: Element) {
    this.#host = host;
  }

  render(content: unknown): void {
    if (this.#closed)
      throw new Error('Cannot render an unmounted Workstar root.');
    this.#content = content;
    if (this.#disposeMount) {
      this.#revision.value++;
      return;
    }
    this.#disposeMount = mount(this.#host, () => this.#render());
  }

  unmount(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#disposeMount?.();
    for (const instance of this.#instances.values()) disposeComponent(instance);
    this.#instances.clear();
    this.#pendingEffects.length = 0;
  }

  #render(): unknown {
    void this.#revision.value;
    const focus = captureFocus(this.#host);
    this.#seen.clear();
    const output = this.#expand(this.#content, 'root', new Map());
    for (const [path, instance] of this.#instances) {
      if (this.#seen.has(path)) continue;
      disposeComponent(instance);
      this.#instances.delete(path);
    }
    this.#queueEffectFlush();
    if (focus) queueMicrotask(() => restoreFocus(this.#host, focus));
    return output;
  }

  #queueEffectFlush(): void {
    if (this.#effectFlushQueued || this.#pendingEffects.length === 0) return;
    this.#effectFlushQueued = true;
    queueMicrotask(() => {
      this.#effectFlushQueued = false;
      for (const run of this.#pendingEffects.splice(0)) run();
    });
  }

  #component(
    type: Component,
    props: Readonly<Record<string, unknown>>,
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
  ): unknown {
    const previous = this.#instances.get(path);
    if (previous && previous.type !== type) {
      disposeComponent(previous);
      this.#instances.delete(path);
    }
    const instance = this.#instances.get(path) ?? {
      path,
      type,
      hooks: [],
      context,
      scheduleEffect: (run: () => void) => this.#pendingEffects.push(run),
      active: true,
      cursor: 0,
      hookCount: undefined,
    };
    instance.context = context;
    this.#instances.set(path, instance);
    this.#seen.add(path);
    const result = runComponent(instance, () =>
      type(props as Record<string, unknown>),
    );
    return this.#expand(result, `${path}/render`, context);
  }

  #element(
    node: ReactElement,
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
  ): unknown {
    const { type, props } = node;
    if (type === Fragment || type === StrictMode)
      return this.#expand(props.children, `${path}/children`, context);
    if (type === Suspense) {
      try {
        return this.#expand(props.children, `${path}/children`, context);
      } catch (error) {
        if (!isPromiseLike(error)) throw error;
        for (const seenPath of this.#seen) {
          if (seenPath.startsWith(`${path}/children`))
            this.#seen.delete(seenPath);
        }
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
      return this.#component(type as Component, props, path, context);
    if (typeof type !== 'string')
      throw new TypeError('Unsupported React element type.');
    const children = this.#expand(props.children, `${path}/children`, context);
    return renderIntrinsic(type, props, children);
  }

  #expand(
    value: unknown,
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
  ): unknown {
    if (value === null || value === undefined || typeof value === 'boolean')
      return null;
    if (Array.isArray(value))
      return value.map((child, index) =>
        this.#expand(
          child,
          isElement(child) ? childPath(path, child, index) : `${path}/${index}`,
          context,
        ),
      );
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
