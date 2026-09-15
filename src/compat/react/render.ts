import { signal, withoutTracking, type Writable } from '../../reactivity.js';
import { repeat, type Repeat } from '../../template-model.js';
import { hydrate, mount } from '../../template.js';
import {
  disposeComponent,
  runComponent,
  type ComponentInstance,
} from './hooks.js';
import { captureFocus, restoreFocus } from './focus.js';
import {
  componentFrame,
  describeComponentError,
  unsupportedElementMessage,
} from './diagnostics.js';
import { createIntrinsicView, type IntrinsicView } from './intrinsic.js';
import {
  childPath,
  isPromiseLike,
  sameContext,
  sameProps,
} from './reconcile.js';
import {
  Fragment,
  Portal,
  StrictMode,
  Suspense,
  attachClassUpdater,
  isElement,
  isClassComponent,
  memoComparator,
  providerContext,
  type Component as ClassComponent,
  type ComponentType,
  type Context,
  type Element as ReactElement,
  type FunctionComponent,
} from './vnode.js';

interface MountedComponent extends ComponentInstance {
  readonly type: ComponentType;
  props: Readonly<Record<string, unknown>>;
  result: unknown;
  expanded: unknown;
  rendered: boolean;
  classComponent?: ClassComponent;
  classState?: Readonly<Record<string, unknown>>;
  classCallbacks?: Array<() => void>;
}

interface ArrayItem {
  readonly key: string;
  readonly path: string;
  readonly output: unknown;
}

interface ArrayView {
  readonly source: Writable<readonly ArrayItem[]>;
  readonly block: Repeat<ArrayItem>;
  readonly pathIndex: Map<string, number>;
  children: readonly unknown[];
  items: readonly ArrayItem[];
}

interface PortalView {
  readonly container: Element | DocumentFragment;
  readonly host: HTMLElement;
  readonly root: ReactRoot;
}

type ClassLifecycle =
  | { readonly kind: 'mount' }
  | {
      readonly kind: 'update';
      readonly props: Readonly<Record<string, unknown>>;
      readonly state: Readonly<Record<string, unknown>>;
    };

const rootsWithPendingLayoutEffects = new Set<ReactRoot>();
let layoutEffectFlushQueued = false;

/** @internal Flush layout effects after reactive DOM bindings commit. */
export function flushReactLayoutEffects(): void {
  layoutEffectFlushQueued = false;
  const roots = [...rootsWithPendingLayoutEffects];
  rootsWithPendingLayoutEffects.clear();
  for (const root of roots) root.flushLayoutEffects();
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
  readonly #pendingLayoutEffects: Array<() => void> = [];
  readonly #pendingEffects: Array<() => void> = [];
  #disposeMount: (() => void) | undefined;
  #effectFlushQueued = false;
  #content: unknown;
  #context: ReadonlyMap<Context<unknown>, unknown> = new Map();
  #rootRenderRequested = false;
  #fullPass = false;
  readonly #hydrateInitial: boolean;
  #closed = false;

  constructor(host: Element, hydrateInitial = false) {
    this.#host = host;
    this.#hydrateInitial = hydrateInitial;
  }

  render(
    content: unknown,
    context: ReadonlyMap<Context<unknown>, unknown> = new Map(),
  ): void {
    if (this.#closed)
      throw new Error('Cannot render an unmounted Workstar root.');
    this.#content = content;
    this.#context = context;
    this.#rootRenderRequested = true;
    if (this.#disposeMount) {
      this.#revision.update((revision) => revision + 1);
      return;
    }
    this.#disposeMount = this.#hydrateInitial
      ? hydrate(this.#host, () => this.#render())
      : mount(this.#host, () => this.#render());
    this.flushLayoutEffects();
    this.#queueEffectFlush();
  }

  unmount(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#disposeMount?.();
    for (const instance of this.#instances.values())
      this.#disposeInstance(instance);
    this.#instances.clear();
    this.#dirty.clear();
    this.#intrinsics.clear();
    this.#arrays.clear();
    for (const portal of this.#portals.values()) {
      portal.root.unmount();
      portal.host.remove();
    }
    this.#portals.clear();
    this.#pendingLayoutEffects.length = 0;
    this.#pendingEffects.length = 0;
    rootsWithPendingLayoutEffects.delete(this);
  }

  #render(): unknown {
    void this.#revision.value;
    const ownerRendered = this.#rootRenderRequested;
    this.#rootRenderRequested = false;
    this.#fullPass = ownerRendered;
    const dirtyRoots = [...this.#dirty];
    const focus = captureFocus(this.#host);
    this.#seen.clear();
    this.#seenIntrinsics.clear();
    this.#seenArrays.clear();
    this.#seenPortals.clear();
    const output = this.#expand(
      this.#content,
      'root',
      this.#context,
      ownerRendered,
    );
    const isCleanupCandidate = (path: string) =>
      ownerRendered ||
      dirtyRoots.some(
        (root) =>
          path === `${root}/render` || path.startsWith(`${root}/render/`),
      );
    for (const [path, instance] of this.#instances) {
      if (this.#seen.has(path) || !isCleanupCandidate(path)) continue;
      this.#disposeInstance(instance);
      this.#instances.delete(path);
      this.#dirty.delete(path);
    }
    for (const path of this.#intrinsics.keys()) {
      if (isCleanupCandidate(path) && !this.#seenIntrinsics.has(path))
        this.#intrinsics.delete(path);
    }
    for (const path of this.#arrays.keys()) {
      if (isCleanupCandidate(path) && !this.#seenArrays.has(path))
        this.#arrays.delete(path);
    }
    for (const [path, portal] of this.#portals) {
      if (this.#seenPortals.has(path) || !isCleanupCandidate(path)) continue;
      portal.root.unmount();
      portal.host.remove();
      this.#portals.delete(path);
    }
    if (this.#disposeMount) this.#queueCommitEffects();
    if (focus)
      queueMicrotask(() => {
        if (!this.#host.contains(this.#host.ownerDocument.activeElement))
          restoreFocus(this.#host, focus);
      });
    return output;
  }

  #hasDirtyDescendant(path: string): boolean {
    for (const dirty of this.#dirty) {
      if (dirty === path || dirty.startsWith(`${path}/`)) return true;
    }
    return false;
  }

  #forgetSubtree(path: string): void {
    for (const seenPath of this.#seen) {
      if (seenPath === path || seenPath.startsWith(`${path}/`))
        this.#seen.delete(seenPath);
    }
    for (const seenPath of this.#seenIntrinsics) {
      if (seenPath === path || seenPath.startsWith(`${path}/`))
        this.#seenIntrinsics.delete(seenPath);
    }
    for (const seenPath of this.#seenArrays) {
      if (seenPath === path || seenPath.startsWith(`${path}/`))
        this.#seenArrays.delete(seenPath);
    }
    for (const seenPath of this.#seenPortals) {
      if (seenPath === path || seenPath.startsWith(`${path}/`))
        this.#seenPortals.delete(seenPath);
    }
  }

  #disposeInstance(instance: MountedComponent): void {
    instance.classComponent?.componentWillUnmount?.();
    if (instance.classComponent)
      attachClassUpdater(instance.classComponent, undefined);
    disposeComponent(instance);
  }

  /** @internal */
  flushLayoutEffects(): void {
    for (const run of this.#pendingLayoutEffects.splice(0)) run();
  }

  #queueCommitEffects(): void {
    if (this.#pendingLayoutEffects.length > 0) {
      rootsWithPendingLayoutEffects.add(this);
      if (!layoutEffectFlushQueued) {
        layoutEffectFlushQueued = true;
        queueMicrotask(flushReactLayoutEffects);
      }
    }
    this.#queueEffectFlush();
  }

  #scheduleClassLifecycle(
    instance: MountedComponent,
    lifecycle: ClassLifecycle | undefined,
  ): void {
    if (lifecycle?.kind === 'mount')
      this.#pendingLayoutEffects.push(() =>
        instance.classComponent?.componentDidMount?.(),
      );
    else if (lifecycle?.kind === 'update')
      this.#pendingLayoutEffects.push(() =>
        instance.classComponent?.componentDidUpdate?.(
          lifecycle.props,
          lifecycle.state,
        ),
      );
    for (const callback of instance.classCallbacks?.splice(0) ?? [])
      this.#pendingLayoutEffects.push(callback);
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
    type: ComponentType,
    props: Readonly<Record<string, unknown>>,
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
    ownerRendered: boolean,
  ): unknown {
    const previous = this.#instances.get(path);
    if (previous && previous.type !== type) {
      this.#disposeInstance(previous);
      this.#instances.delete(path);
    }
    const instance = this.#instances.get(path) ?? {
      path,
      type,
      props,
      result: undefined,
      expanded: undefined,
      rendered: false,
      hooks: [],
      context,
      scheduleEffect: (run: () => void) => this.#pendingEffects.push(run),
      scheduleLayoutEffect: (run: () => void) =>
        this.#pendingLayoutEffects.push(run),
      server: false,
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
    const propsEqual = sameProps(instance.props, props);
    const contextEqual = sameContext(instance.context, context);
    const compare = memoComparator(type);
    const memoPropsEqual =
      compare === null
        ? propsEqual
        : typeof compare === 'function'
          ? compare(instance.props, props)
          : false;
    const shouldRender =
      !instance.rendered ||
      this.#dirty.has(path) ||
      !contextEqual ||
      (compare === undefined ? ownerRendered || !propsEqual : !memoPropsEqual);
    let lifecycle: ClassLifecycle | undefined;
    if (shouldRender) {
      this.#dirty.delete(path);
      const previousProps = instance.props;
      instance.props = props;
      instance.context = context;
      try {
        if (isClassComponent(type)) {
          let component = instance.classComponent;
          if (!component) {
            component = new type(props as Record<string, unknown>);
            instance.classComponent = component;
            instance.classCallbacks = [];
            attachClassUpdater(component, {
              invalidate: (callback) => {
                if (callback) instance.classCallbacks?.push(callback);
                instance.invalidate();
              },
            });
            lifecycle = { kind: 'mount' };
          } else {
            lifecycle = {
              kind: 'update',
              props: previousProps,
              state: instance.classState ?? component.state,
            };
            component.props = props;
          }
          instance.result = withoutTracking(() => component.render());
          instance.classState = component.state;
        } else {
          instance.result = withoutTracking(() =>
            runComponent(instance, () =>
              (type as (value: Record<string, unknown>) => unknown)(props),
            ),
          );
        }
      } catch (error) {
        throw describeComponentError(error, type, path);
      }
      instance.rendered = true;
    }
    if (
      !shouldRender &&
      !this.#fullPass &&
      !this.#hasDirtyDescendant(`${path}/render`)
    )
      return instance.expanded;
    try {
      const output = this.#expand(
        instance.result,
        `${path}/render`,
        context,
        shouldRender,
      );
      this.#scheduleClassLifecycle(instance, lifecycle);
      instance.expanded = output;
      return output;
    } catch (error) {
      const component = instance.classComponent;
      const classType = isClassComponent(type) ? type : undefined;
      const boundary = classType
        ? classType.getDerivedStateFromError || component?.componentDidCatch
        : undefined;
      if (!component || !boundary || isPromiseLike(error))
        throw describeComponentError(error, type, path);
      const derived = classType?.getDerivedStateFromError?.(error);
      if (derived) component.state = { ...component.state, ...derived };
      component.componentDidCatch?.(error, {
        componentStack: componentFrame(type, path),
      });
      this.#dirty.delete(path);
      this.#forgetSubtree(`${path}/render`);
      try {
        instance.result = withoutTracking(() => component.render());
        instance.classState = component.state;
        const output = this.#expand(
          instance.result,
          `${path}/render`,
          context,
          true,
        );
        this.#scheduleClassLifecycle(instance, lifecycle);
        instance.expanded = output;
        return output;
      } catch (fallbackError) {
        throw describeComponentError(fallbackError, type, path);
      }
    }
  }

  #element(
    node: ReactElement,
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
    ownerRendered: boolean,
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
      return this.#expand(
        props.children,
        `${path}/children`,
        context,
        ownerRendered,
      );
    if (type === Suspense) {
      try {
        return this.#expand(
          props.children,
          `${path}/children`,
          context,
          ownerRendered,
        );
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
        this.#forgetSubtree(`${path}/children`);
        return this.#expand(
          props.fallback,
          `${path}/fallback`,
          context,
          ownerRendered,
        );
      }
    }
    const provider = providerContext(type);
    if (provider) {
      const next = new Map(context);
      next.set(provider, props.value);
      return this.#expand(
        props.children,
        `${path}/provider`,
        next,
        ownerRendered,
      );
    }
    if (typeof type === 'function')
      return this.#component(type, props, path, context, ownerRendered);
    if (typeof type !== 'string')
      throw new TypeError(unsupportedElementMessage(type));
    const children = this.#expand(
      props.children,
      `${path}/children`,
      context,
      ownerRendered,
    );
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
    ownerRendered: boolean,
  ): Repeat<ArrayItem> {
    this.#seenArrays.add(path);
    const previous = this.#arrays.get(path);
    if (!ownerRendered && !this.#fullPass && previous?.children === children) {
      const next = [...previous.items];
      let changed = false;
      const affected = new Set<number>();
      for (const dirty of this.#dirty) {
        if (!dirty.startsWith(`${path}/`)) continue;
        const segment = dirty.slice(path.length + 1).split('/', 1)[0];
        const index = previous.pathIndex.get(`${path}/${segment}`);
        if (index === undefined || affected.has(index)) continue;
        affected.add(index);
        const current = next[index]!;
        const output = this.#expand(
          children[index],
          current.path,
          context,
          false,
        );
        if (!Object.is(output, current.output)) {
          next[index] = { ...current, output };
          changed = true;
        }
      }
      if (changed) {
        previous.items = next;
        previous.source.value = next;
      }
      return previous.block;
    }
    const items = children.map((child, index) => ({
      key:
        isElement(child) && child.key !== null
          ? `key:${String(child.key)}`
          : `index:${index}`,
      path: isElement(child)
        ? childPath(path, child, index)
        : `${path}/${index}`,
      output: this.#expand(
        child,
        isElement(child) ? childPath(path, child, index) : `${path}/${index}`,
        context,
        ownerRendered,
      ),
    }));
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
      previous.children = children;
      previous.pathIndex.clear();
      items.forEach((item, index) => previous.pathIndex.set(item.path, index));
      return previous.block;
    }
    const source = signal<readonly ArrayItem[]>(items);
    const block = repeat<ArrayItem>(
      source,
      (item) => item.key,
      (item) => () => item.value.output,
    );
    this.#arrays.set(path, {
      source,
      block,
      items,
      children,
      pathIndex: new Map(items.map((item, index) => [item.path, index])),
    });
    return block;
  }

  #expand(
    value: unknown,
    path: string,
    context: ReadonlyMap<Context<unknown>, unknown>,
    ownerRendered: boolean,
  ): unknown {
    if (value === null || value === undefined || typeof value === 'boolean')
      return null;
    if (Array.isArray(value))
      return this.#array(value, path, context, ownerRendered);
    if (isElement(value))
      return this.#element(value, path, context, ownerRendered);
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint'
    )
      return value;
    throw new TypeError('Unsupported React compatibility child.');
  }
}
