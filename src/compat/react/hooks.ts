import { signal, type Writable } from '../../reactivity.js';
import type { Context } from './vnode.js';

type StateSlot = {
  readonly kind: 'state';
  readonly state: Writable<unknown>;
  readonly set: (next: unknown) => void;
};
type MemoSlot = {
  readonly kind: 'memo';
  value: unknown;
  deps: readonly unknown[] | undefined;
};
type RefSlot = {
  readonly kind: 'ref';
  readonly ref: { current: unknown };
};
type EffectSlot = {
  readonly kind: 'effect';
  deps: readonly unknown[] | undefined;
  cleanup: (() => void) | undefined;
  revision: number;
};
type IdSlot = { readonly kind: 'id'; readonly id: string };
type HookSlot = StateSlot | MemoSlot | RefSlot | EffectSlot | IdSlot;

export interface ComponentInstance {
  readonly path: string;
  readonly hooks: HookSlot[];
  context: ReadonlyMap<Context<unknown>, unknown>;
  readonly scheduleEffect: (run: () => void) => void;
  active: boolean;
  cursor: number;
  hookCount: number | undefined;
}

let currentInstance: ComponentInstance | undefined;

function current(): ComponentInstance {
  if (!currentInstance)
    throw new Error('React compatibility hooks require a Workstar component.');
  return currentInstance;
}

function slot<T extends HookSlot['kind']>(
  kind: T,
  create: (
    instance: ComponentInstance,
    index: number,
  ) => Extract<HookSlot, { kind: T }>,
): Extract<HookSlot, { kind: T }> {
  const instance = current();
  const index = instance.cursor++;
  const existing = instance.hooks[index];
  if (existing) {
    if (existing.kind !== kind)
      throw new Error('Component hook order changed between renders.');
    return existing as Extract<HookSlot, { kind: T }>;
  }
  if (instance.hookCount !== undefined)
    throw new Error('Component added a hook after its first render.');
  const created = create(instance, index);
  instance.hooks.push(created);
  return created;
}

function sameDeps(
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  return (
    previous !== undefined &&
    next !== undefined &&
    previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]))
  );
}

export function runComponent<T>(
  instance: ComponentInstance,
  render: () => T,
): T {
  const previous = currentInstance;
  currentInstance = instance;
  instance.cursor = 0;
  try {
    const result = render();
    if (
      instance.hookCount !== undefined &&
      instance.hookCount !== instance.cursor
    )
      throw new Error('Component hook count changed between renders.');
    instance.hookCount = instance.cursor;
    return result;
  } finally {
    currentInstance = previous;
  }
}

export function disposeComponent(instance: ComponentInstance): void {
  instance.active = false;
  for (const hook of instance.hooks) {
    if (hook.kind === 'effect') {
      hook.revision++;
      hook.cleanup?.();
      hook.cleanup = undefined;
    }
  }
}

export function useState<T>(
  initial: T | (() => T),
): [T, (next: T | ((current: T) => T)) => void] {
  const state = slot('state', () => {
    const value =
      typeof initial === 'function' ? (initial as () => T)() : initial;
    const source = signal<unknown>(value);
    return {
      kind: 'state',
      state: source,
      set(next: unknown) {
        source.value =
          typeof next === 'function'
            ? (next as (current: unknown) => unknown)(source.value)
            : next;
      },
    };
  });
  return [
    state.state.value as T,
    state.set as (next: T | ((current: T) => T)) => void,
  ];
}

export function useMemo<T>(derive: () => T, deps?: readonly unknown[]): T {
  const instance = current();
  const existing = instance.hooks[instance.cursor];
  const memo = slot('memo', () => ({
    kind: 'memo',
    value: derive(),
    deps,
  }));
  if (existing && !sameDeps(memo.deps, deps)) {
    memo.value = derive();
    memo.deps = deps;
  }
  return memo.value as T;
}

export function useCallback<T extends (...argumentsList: never[]) => unknown>(
  callback: T,
  deps?: readonly unknown[],
): T {
  return useMemo(() => callback, deps);
}

export function useRef<T>(initial: T): { current: T } {
  return slot('ref', () => ({ kind: 'ref', ref: { current: initial } }))
    .ref as {
    current: T;
  };
}

export function useId(): string {
  return slot('id', (instance, index) => ({
    kind: 'id',
    id: `workstar-${instance.path.replace(/[^a-zA-Z0-9-]/g, '-')}-${index}`,
  })).id;
}

export function useContext<T>(context: Context<T>): T {
  const instance = current();
  return instance.context.has(context as Context<unknown>)
    ? (instance.context.get(context as Context<unknown>) as T)
    : context.defaultValue;
}

export function useEffect(
  callback: () => void | (() => void),
  deps?: readonly unknown[],
): void {
  const instance = current();
  const existing = instance.hooks[instance.cursor];
  const effect = slot('effect', () => ({
    kind: 'effect',
    deps: undefined,
    cleanup: undefined,
    revision: 0,
  }));
  if (existing && sameDeps(effect.deps, deps)) return;
  effect.deps = deps;
  const revision = ++effect.revision;
  instance.scheduleEffect(() => {
    if (!instance.active || effect.revision !== revision) return;
    effect.cleanup?.();
    const cleanup = callback();
    effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
}
