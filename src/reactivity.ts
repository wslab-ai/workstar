export interface Readable<T> {
  readonly value: T;
}

export interface Writable<T> extends Readable<T> {
  value: T;
  update(change: (current: T) => T): void;
}

interface Observer {
  readonly dependencies: Set<Dependency>;
  onDependencyChange(): void;
}

class Dependency {
  readonly observers = new Set<Observer>();

  onNoObservers(): void {}
}

let activeObserver: Observer | undefined;

function track(dependency: Dependency): void {
  if (!activeObserver || activeObserver.dependencies.has(dependency)) return;
  dependency.observers.add(activeObserver);
  activeObserver.dependencies.add(dependency);
}

/** Evaluate a compatibility component without subscribing its parent render. */
export function withoutTracking<T>(evaluate: () => T): T {
  const previous = activeObserver;
  activeObserver = undefined;
  try {
    return evaluate();
  } finally {
    activeObserver = previous;
  }
}

function untrack(observer: Observer): void {
  for (const dependency of observer.dependencies) {
    dependency.observers.delete(observer);
    if (dependency.observers.size === 0) dependency.onNoObservers();
  }
  observer.dependencies.clear();
}

function notify(dependency: Dependency): void {
  for (const observer of [...dependency.observers])
    observer.onDependencyChange();
}

class Signal<T> extends Dependency implements Writable<T> {
  #current: T;

  constructor(initial: T) {
    super();
    this.#current = initial;
  }

  get value(): T {
    track(this);
    return this.#current;
  }

  set value(next: T) {
    if (Object.is(this.#current, next)) return;
    this.#current = next;
    notify(this);
  }

  update(change: (current: T) => T): void {
    this.value = change(this.#current);
  }
}

class Memo<T> extends Dependency implements Readable<T>, Observer {
  readonly dependencies = new Set<Dependency>();
  #dirty = true;
  #evaluating = false;
  #current!: T;

  constructor(private readonly derive: () => T) {
    super();
  }

  get value(): T {
    track(this);
    if (this.#dirty) this.#evaluate();
    if (this.observers.size === 0) {
      untrack(this);
      this.#dirty = true;
    }
    return this.#current;
  }

  override onNoObservers(): void {
    untrack(this);
    this.#dirty = true;
  }

  onDependencyChange(): void {
    if (this.#dirty) return;
    this.#dirty = true;
    notify(this);
  }

  #evaluate(): void {
    if (this.#evaluating) throw new Error('Circular computed dependency');
    this.#evaluating = true;
    this.#dirty = false;
    untrack(this);
    const previous = activeObserver;
    activeObserver = this;
    try {
      this.#current = this.derive();
    } catch (error) {
      this.#dirty = true;
      throw error;
    } finally {
      activeObserver = previous;
      this.#evaluating = false;
    }
  }
}

const pendingEffects = new Set<Effect>();
let flushScheduled = false;

function schedule(effect: Effect): void {
  if (!effect.active) return;
  pendingEffects.add(effect);
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

function flush(): void {
  flushScheduled = false;
  let iterations = 0;
  while (pendingEffects.size > 0) {
    if (++iterations > 1000) {
      pendingEffects.clear();
      throw new Error('Reactive update loop exceeded 1000 iterations');
    }
    const next = pendingEffects.values().next().value;
    if (!next) break;
    pendingEffects.delete(next);
    next.run();
  }
}

/** Flush queued signal effects before returning from compatibility flushSync. */
export function flushReactiveUpdates(): void {
  flush();
}

class Effect implements Observer {
  readonly dependencies = new Set<Dependency>();
  active = true;
  #cleanup: (() => void) | undefined;

  constructor(private readonly callback: () => void | (() => void)) {}

  run(): void {
    if (!this.active) return;
    this.#cleanup?.();
    this.#cleanup = undefined;
    untrack(this);
    const previous = activeObserver;
    activeObserver = this;
    try {
      const cleanup = this.callback();
      if (typeof cleanup === 'function') this.#cleanup = cleanup;
    } finally {
      activeObserver = previous;
    }
  }

  onDependencyChange(): void {
    schedule(this);
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    pendingEffects.delete(this);
    untrack(this);
    this.#cleanup?.();
    this.#cleanup = undefined;
  }
}

export function signal<T>(initial: T): Writable<T> {
  return new Signal(initial);
}

export function computed<T>(derive: () => T): Readable<T> {
  return new Memo(derive);
}

export function effect(callback: () => void | (() => void)): () => void {
  const observer = new Effect(callback);
  try {
    observer.run();
  } catch (error) {
    observer.dispose();
    throw error;
  }
  return () => observer.dispose();
}

export function tick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

export function isReadable(value: unknown): value is Readable<unknown> {
  return value instanceof Signal || value instanceof Memo;
}
