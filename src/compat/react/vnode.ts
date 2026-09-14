import { signal, type Writable } from '../../reactivity.js';

const elementBrand = Symbol('workstar.react.element');
const providerBrand = Symbol('workstar.react.provider');

export type Component = (props: Record<string, unknown>) => unknown;
export type ElementType = string | ((props: never) => unknown) | symbol;

export interface Element {
  readonly [elementBrand]: true;
  readonly type: ElementType;
  readonly props: Readonly<Record<string, unknown>>;
  readonly key: string | number | null;
}

export interface Context<T> {
  readonly defaultValue: T;
  readonly Provider: Component;
}

interface ProviderComponent extends Component {
  readonly [providerBrand]: Context<unknown>;
}

export const Fragment = Symbol('workstar.react.fragment');
export const StrictMode = Symbol('workstar.react.strict-mode');
export const Suspense = Symbol('workstar.react.suspense');

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

export function lazy(loader: () => Promise<{ default: Component }>): Component {
  let pending: Promise<void> | undefined;
  let loaded: Component | undefined;
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
): Component {
  return (props) => render(props as Props, (props.ref as Ref | null) ?? null);
}
