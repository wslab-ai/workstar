import { signal, withoutTracking, type Writable } from '../../reactivity.js';
import { repeat, type Repeat } from '../../template-model.js';
import { mount } from '../../template.js';
import {
  disposeComponent,
  runComponent,
  type ComponentInstance,
} from './hooks.js';
import { captureFocus, restoreFocus } from './focus.js';
import { createIntrinsicView, type IntrinsicView } from './intrinsic.js';
import {
  Fragment,
  Portal,
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
  props: Readonly<Record<string, unknown>>;
  result: unknown;
  rendered: boolean;
}

interface ArrayItem {
  readonly key: string;
  readonly output: unknown;
}

interface ArrayView {
  readonly source: Writable<readonly ArrayItem[]>;
  readonly block: Repeat<ArrayItem>;
  items: readonly ArrayItem[];
}

interface PortalView {
  readonly container: Element | DocumentFragment;
  readonly host: HTMLElement;
  readonly root: ReactRoot;
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

function sameProps(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(previous);
  return (
    keys.length === Object.keys(next).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(next, key) &&
        Object.is(previous[key], next[key]),
    )
  );
}

function sameContext(
  previous: ReadonlyMap<Context<unknown>, unknown>,
  next: ReadonlyMap<Context<unknown>, unknown>,
): boolean {
  return (
    previous.size === next.size &&
    [...previous].every(
      ([key, value]) => next.has(key) && Object.is(value, next.get(key)),
    )
  );
}

/** Render React-shaped source through Workstar templates and signals. */
export class ReactRoot {
  readonly #host: Element;
  readonly #revision = signal(0);
  readonly #instances = new Map<string, MountedComponent>();
  readonly #dirty = new Set<string>();
  readonly #seen = new Set<string>();
  readonly #intrinsics = new Map<string, IntrinsicView>();
  readonly #arrays = new Map<string, ArrayView>();
  readonly #portals = new Map<string, PortalView>();
  readonly #seenIntrinsics = new Set<string>();
  readonly #seenArrays = new Set<string>();
  readonly #seenPortals = new Set<string>();
  readonly #pendingEffects: Array<() => void> = [];
  #disposeMount: (() => void) | undefined;
  #effectFlushQueued = false;
  #content: unknown;
  #context: ReadonlyMap<Context<unknown>, unknown> = new Map();
  #closed = false;

  constructor(host: Element) {
    this.#host = host;
  }

  render(
    content: unknown,
    context: ReadonlyMap<Context<unknown>, unknown> = new Map(),
  ): void {
    if (this.#closed)
      throw new Error('Cannot render an unmounted Workstar root.');
    this.#content = content;
    this.#context = context;
    if (this.#disposeMount) {
      this.#revision.update((revision) => revision + 1);
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
    this.#dirty.clear();
    this.#intrinsics.clear();
    this.#arrays.clear();
    for (const portal of this.#portals.values()) {
      portal.root.unmount();
      portal.host.remove();
    }
    this.#portals.clear();
    this.#pendingEffects.length = 0;
  }

  #render(): unknown {
    void this.#revision.value;
    const focus = captureFocus(this.#host);
    this.#seen.clear();
    this.#seenIntrinsics.clear();
    this.#seenArrays.clear();
    this.#seenPortals.clear();
    const output = this.#expand(this.#content, 'root', this.#context);
    for (const [path, instance] of this.#instances) {
      if (this.#seen.has(path)) continue;
      disposeComponent(instance);
      this.#instances.delete(path);
      this.#dirty.delete(path);
    }
    for (const path of this.#intrinsics.keys()) {
      if (!this.#seenIntrinsics.has(path)) this.#intrinsics.delete(path);
    }
    for (const path of this.#arrays.keys()) {
      if (!this.#seenArrays.has(path)) this.#arrays.delete(path);
    }
    for (const [path, portal] of this.#portals) {
      if (this.#seenPortals.has(path)) continue;
      portal.root.unmount();
      portal.host.remove();
      this.#portals.delete(path);
    }
    this.#queueEffectFlush();
    if (focus)
      queueMicrotask(() => {
        if (!this.#host.contains(this.#host.ownerDocument.activeElement))
          restoreFocus(this.#host, focus);
      });
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
      props,
      result: undefined,
      rendered: false,
      hooks: [],
      context,
      scheduleEffect: (run: () => void) => this.#pendingEffects.push(run),
      invalidate: () => {
        if (!instance.active) return;
        this.#dirty.add(path);
        this.#revision.update((revision) => revision + 1);
      },
      active: true,
      cursor: 0,
      hookCount: undefined,
    };
    this.#instances.set(path, instance);
    this.#seen.add(path);
    if (
      !instance.rendered ||
      this.#dirty.has(path) ||
      !sameProps(instance.props, props) ||
      !sameContext(instance.context, context)
    ) {
      this.#dirty.delete(path);
      instance.props = props;
      instance.context = context;
      instance.result = withoutTracking(() =>
        runComponent(instance, () => type(props as Record<string, unknown>)),
      );
      instance.rendered = true;
    }
    return this.#expand(instance.result, `${path}/render`, context);
  }

  #element(
    node: ReactElement,
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
  ): unknown {
    const { type, props } = node;
    if (type === Portal) {
      const container = props.container;
      if (!(
        container instanceof Element || container instanceof DocumentFragment
      ))
        throw new TypeError('A portal requires a DOM container.');
      this.#seenPortals.add(path);
      let portal = this.#portals.get(path);
      if (portal && portal.container !== container) {
        portal.root.unmount();
        portal.host.remove();
        this.#portals.delete(path);
        portal = undefined;
      }
      if (!portal) {
        const host = this.#host.ownerDocument.createElement('div');
        host.setAttribute('data-workstar-portal', '');
        container.append(host);
        portal = { container, host, root: new ReactRoot(host) };
        this.#portals.set(path, portal);
      }
      portal.root.render(props.children, context);
      return null;
    }
    if (type === Fragment || type === StrictMode)
      return this.#expand(props.children, `${path}/children`, context);
    if (type === Suspense) {
      try {
        return this.#expand(props.children, `${path}/children`, context);
      } catch (error) {
        if (!isPromiseLike(error)) throw error;
        void Promise.resolve(error).then(
          () => {
            if (!this.#closed) {
              this.#dirty.add('root');
              this.#revision.update((revision) => revision + 1);
            }
          },
          () => {
            if (!this.#closed) {
              this.#dirty.add('root');
              this.#revision.update((revision) => revision + 1);
            }
          },
        );
        for (const seenPath of this.#seen) {
          if (seenPath.startsWith(`${path}/children`))
            this.#seen.delete(seenPath);
        }
        for (const seenPath of this.#seenIntrinsics) {
          if (seenPath.startsWith(`${path}/children`))
            this.#seenIntrinsics.delete(seenPath);
        }
        for (const seenPath of this.#seenArrays) {
          if (seenPath.startsWith(`${path}/children`))
            this.#seenArrays.delete(seenPath);
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
    this.#seenIntrinsics.add(path);
    const previous = this.#intrinsics.get(path);
    if (previous?.matches(type, props)) {
      previous.update(props, children);
      return previous.template;
    }
    const next = createIntrinsicView(type, props, children);
    this.#intrinsics.set(path, next);
    return next.template;
  }

  #array(
    children: readonly unknown[],
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
  ): Repeat<ArrayItem> {
    const items = children.map((child, index) => ({
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
    this.#seenArrays.add(path);
    const previous = this.#arrays.get(path);
    if (previous) {
      if (
        previous.items.length !== items.length ||
        previous.items.some(
          (item, index) =>
            item.key !== items[index]?.key ||
            item.output !== items[index]?.output,
        )
      ) {
        previous.items = items;
        previous.source.value = items;
      }
      return previous.block;
    }
    const source = signal<readonly ArrayItem[]>(items);
    const block = repeat<ArrayItem>(
      source,
      (item) => item.key,
      (item) => () => item.value.output,
    );
    this.#arrays.set(path, { source, block, items });
    return block;
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
