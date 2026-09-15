import { signal, type Writable } from '../../reactivity.js';
import type { Context } from './vnode.js';

type StateSlot = {
  readonly kind: 'state';
  readonly state: Writable<unknown>;
  readonly set: (next: unknown) => void;
  committed: unknown;
  pending: boolean;
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
  readonly phase: 'layout' | 'passive';
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
  readonly scheduleLayoutEffect: (run: () => void) => void;
  readonly invalidate: () => void;
  readonly server: boolean;
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
    for (const hook of instance.hooks) {
      if (hook.kind === 'state') hook.committed = hook.state.value;
    }
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
  const state = slot('state', (instance) => {
    const value =
      typeof initial === 'function' ? (initial as () => T)() : initial;
    const source = signal<unknown>(value);
    const stateSlot: StateSlot = {
      kind: 'state',
      state: source,
      committed: value,
      pending: false,
      set(next: unknown) {
        const previous = source.value;
        source.value =
          typeof next === 'function'
            ? (next as (current: unknown) => unknown)(source.value)
            : next;
        if (Object.is(previous, source.value) || stateSlot.pending) return;
        stateSlot.pending = true;
        queueMicrotask(() => {
          stateSlot.pending = false;
          if (instance.active && !Object.is(stateSlot.committed, source.value))
            instance.invalidate();
        });
      },
    };
    return stateSlot;
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

export function useImperativeHandle<T>(
  ref: ((value: T | null) => void) | { current: T | null } | null | undefined,
  create: () => T,
  deps?: readonly unknown[],
): void {
  useLayoutEffect(() => {
    if (!ref) return;
    const value = create();
    if (typeof ref === 'function') ref(value);
    else ref.current = value;
    return () => {
      if (typeof ref === 'function') ref(null);
      else ref.current = null;
    };
  }, deps);
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

function useScheduledEffect(
  phase: EffectSlot['phase'],
  callback: () => void | (() => void),
  deps?: readonly unknown[],
): void {
  const instance = current();
  const existing = instance.hooks[instance.cursor];
  const effect = slot('effect', () => ({
    kind: 'effect',
    phase,
    deps: undefined,
    cleanup: undefined,
    revision: 0,
  }));
  if (effect.phase !== phase)
    throw new Error('Component effect hook type changed between renders.');
  if (existing && sameDeps(effect.deps, deps)) return;
  effect.deps = deps;
  const revision = ++effect.revision;
  if (instance.server) return;
  const schedule =
    phase === 'layout'
      ? instance.scheduleLayoutEffect
      : instance.scheduleEffect;
  schedule(() => {
    if (!instance.active || effect.revision !== revision) return;
    effect.cleanup?.();
    const cleanup = callback();
    effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
}

export function useEffect(
  callback: () => void | (() => void),
  deps?: readonly unknown[],
): void {
  useScheduledEffect('passive', callback, deps);
}

export function useLayoutEffect(
  callback: () => void | (() => void),
  deps?: readonly unknown[],
): void {
  useScheduledEffect('layout', callback, deps);
}

export function useReducer<State, Action>(
  reducer: (state: State, action: Action) => State,
  initialState: State,
  initialize?: (state: State) => State,
): [State, (action: Action) => void] {
  const [state, setState] = useState(() =>
    initialize ? initialize(initialState) : initialState,
  );
  const reducerRef = useRef(reducer);
  reducerRef.current = reducer;
  const dispatch = useCallback(
    (action: Action) =>
      setState((previous) => reducerRef.current(previous, action)),
    [],
  );
  return [state, dispatch];
}

export function useSyncExternalStore<Snapshot>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  _getServerSnapshot?: () => Snapshot,
): Snapshot {
  const instance = current();
  const readSnapshot =
    instance.server && _getServerSnapshot ? _getServerSnapshot : getSnapshot;
  const [snapshot, setSnapshot] = useState(readSnapshot);
  useEffect(() => {
    const check = () =>
      setSnapshot((previous) => {
        const next = getSnapshot();
        return Object.is(previous, next) ? previous : next;
      });
    const unsubscribe = subscribe(check);
    check();
    return unsubscribe;
  }, [subscribe, getSnapshot]);
  return snapshot;
}

export function useDebugValue(_value: unknown): void {}
