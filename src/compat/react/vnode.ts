import { signal, type Writable } from '../../reactivity.js';

const elementBrand = Symbol('workstar.react.element');
const providerBrand = Symbol('workstar.react.provider');
const memoBrand = Symbol('workstar.react.memo');

export type FunctionComponent = (props: never) => unknown;
export type ComponentType = FunctionComponent | ComponentClass;
export type ElementType = string | ComponentType | symbol;

export interface ComponentClass {
  new (props: Record<string, unknown>): Component;
  readonly displayName?: string;
  readonly getDerivedStateFromError?: (
    error: unknown,
  ) => Record<string, unknown> | null;
}

type StateUpdate<State> =
  | Partial<State>
  | null
  | ((
      state: Readonly<State>,
      props: Readonly<Record<string, unknown>>,
    ) => Partial<State> | null);

export interface ClassUpdater {
  readonly invalidate: (callback?: () => void) => void;
}

const classUpdaters = new WeakMap<object, ClassUpdater>();

/** Minimal React-compatible class base, including error-boundary state updates. */
export class Component<
  Props extends Record<string, unknown> = Record<string, unknown>,
  State extends Record<string, unknown> = Record<string, unknown>,
> {
  props: Readonly<Props>;
  state: Readonly<State>;

  constructor(props: Props) {
    this.props = props;
    this.state = {} as State;
  }

  setState(update: StateUpdate<State>, callback?: () => void): void {
    const patch =
      typeof update === 'function' ? update(this.state, this.props) : update;
    if (patch === null) return;
    this.state = { ...this.state, ...patch };
    classUpdaters.get(this)?.invalidate(callback);
  }

  forceUpdate(callback?: () => void): void {
    classUpdaters.get(this)?.invalidate(callback);
  }

  componentDidMount?(): void;
  componentDidUpdate?(
    previousProps: Readonly<Props>,
    previousState: Readonly<State>,
  ): void;
  componentWillUnmount?(): void;
  componentDidCatch?(
    error: unknown,
    info: { readonly componentStack: string },
  ): void;

  render(): unknown {
    return null;
  }
}

export interface Element {
  readonly [elementBrand]: true;
  readonly type: ElementType;
  readonly props: Readonly<Record<string, unknown>>;
  readonly key: string | number | null;
}

export interface Context<T> {
  readonly defaultValue: T;
  readonly Provider: FunctionComponent;
}

interface ProviderComponent extends FunctionComponent {
  readonly [providerBrand]: Context<unknown>;
}

export const Fragment = Symbol('workstar.react.fragment');
export const StrictMode = Symbol('workstar.react.strict-mode');
export const Suspense = Symbol('workstar.react.suspense');
export const Portal = Symbol('workstar.react.portal');

export function jsx(
  type: ElementType,
  props: Record<string, unknown> | null,
  key?: string | number,
): Element {
  return {
    [elementBrand]: true,
    type,
    props: props ?? {},
    key: key ?? null,
  };
}

export const jsxs = jsx;

export function createElement(
  type: ElementType,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): Element {
  const normalized = { ...props };
  if (children.length === 1) normalized.children = children[0];
  else if (children.length > 1) normalized.children = children;
  const key = normalized.key;
  return jsx(
    type,
    normalized,
    typeof key === 'string' || typeof key === 'number' ? key : undefined,
  );
}

export function isElement(value: unknown): value is Element {
  return typeof value === 'object' && value !== null && elementBrand in value;
}

function childArray(children: unknown): unknown[] {
  if (Array.isArray(children)) return children.flatMap(childArray);
  return children === null ||
    children === undefined ||
    typeof children === 'boolean'
    ? []
    : [children];
}

function allChildren(children: unknown): unknown[] {
  return Array.isArray(children) ? children.flatMap(allChildren) : [children];
}

export const Children = {
  toArray: childArray,
  map(
    children: unknown,
    transform: (child: unknown, index: number) => unknown,
  ): unknown[] | null {
    if (children === null || children === undefined) return null;
    return allChildren(children).flatMap((child, index) =>
      childArray(transform(child, index)),
    );
  },
  forEach(
    children: unknown,
    visit: (child: unknown, index: number) => void,
  ): void {
    if (children === null || children === undefined) return;
    allChildren(children).forEach(visit);
  },
  count(children: unknown): number {
    if (children === null || children === undefined) return 0;
    if (Array.isArray(children))
      return children.reduce<number>(
        (count, child) =>
          count + (Array.isArray(child) ? Children.count(child) : 1),
        0,
      );
    return 1;
  },
  only(children: unknown): Element {
    if (!isElement(children))
      throw new Error('Expected a single React element.');
    return children;
  },
};

export const isValidElement = isElement;

export function createRef<T = unknown>(): { current: T | null } {
  return { current: null };
}

export function cloneElement(
  element: Element,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
): Element {
  if (!isElement(element)) throw new TypeError('Expected a React element.');
  const nextProps = { ...element.props, ...props };
  if (children.length === 1) nextProps.children = children[0];
  else if (children.length > 1) nextProps.children = children;
  const key = props?.key;
  return jsx(
    element.type,
    nextProps,
    typeof key === 'string' || typeof key === 'number'
      ? key
      : (element.key ?? undefined),
  );
}

export function createContext<T>(defaultValue: T): Context<T> {
  const context = {} as Context<T>;
  const Provider: ProviderComponent = Object.assign(
    (_props: Record<string, unknown>): unknown => {
      throw new Error('Context providers must render inside a Workstar root.');
    },
    { [providerBrand]: context },
  );
  Object.assign(context, { defaultValue, Provider });
  return context;
}

export function providerContext(
  type: ElementType,
): Context<unknown> | undefined {
  return typeof type === 'function' && providerBrand in type
    ? (type as ProviderComponent)[providerBrand]
    : undefined;
}

export function lazy(
  loader: () => Promise<{ default: FunctionComponent }>,
): FunctionComponent {
  let pending: Promise<void> | undefined;
  let loaded: FunctionComponent | undefined;
  let failure: unknown;
  const revision: Writable<number> = signal(0);
  return (props) => {
    revision.value;
    if (failure) throw failure;
    if (loaded) return jsx(loaded, props);
    pending ??= loader().then(
      (module) => {
        loaded = module.default;
        revision.value++;
      },
      (error: unknown) => {
        failure = error;
        revision.value++;
      },
    );
    throw pending;
  };
}

export function forwardRef<Props extends Record<string, unknown>, Ref>(
  render: (props: Props, ref: Ref | null) => unknown,
): FunctionComponent {
  return ((props: Props) =>
    render(props, (props.ref as Ref | null) ?? null)) as FunctionComponent;
}

export type PropsComparator = (
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
) => boolean;

interface MemoComponent extends FunctionComponent {
  readonly [memoBrand]: PropsComparator | undefined;
}

export function memo<T extends FunctionComponent>(
  component: T,
  compare?: PropsComparator,
): T {
  const wrapped = ((props: Record<string, unknown>) =>
    jsx(component, props)) as unknown as MemoComponent;
  Object.defineProperty(wrapped, memoBrand, { value: compare });
  Object.defineProperty(wrapped, 'displayName', {
    value: `Memo(${component.name || 'Component'})`,
    configurable: true,
  });
  return wrapped as unknown as T;
}

export function memoComparator(
  component: ComponentType,
): PropsComparator | null | undefined {
  if (!(memoBrand in component)) return undefined;
  return (component as MemoComponent)[memoBrand] ?? null;
}

export function isClassComponent(
  component: ComponentType,
): component is ComponentClass {
  return (
    typeof component === 'function' && component.prototype instanceof Component
  );
}

export function attachClassUpdater(
  component: Component,
  updater: ClassUpdater | undefined,
): void {
  if (updater) classUpdaters.set(component, updater);
  else classUpdaters.delete(component);
}
