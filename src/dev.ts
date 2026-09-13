import { tick } from './reactivity.js';

export interface HotContext {
  state<T>(key: string, create: () => T): T;
  child(key: string | number): HotContext;
}

class Context implements HotContext {
  readonly #state = new Map<string, unknown>();
  readonly #children = new Map<string | number, Context>();

  state<T>(key: string, create: () => T): T {
    if (!this.#state.has(key)) this.#state.set(key, create());
    return this.#state.get(key) as T;
  }

  child(key: string | number): HotContext {
    let context = this.#children.get(key);
    if (!context) {
      context = new Context();
      this.#children.set(key, context);
    }
    return context;
  }
}

/** A stable, per-root identity for reactive state during development edits. */
export function createHotContext(): HotContext {
  return new Context();
}

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type IdentifiedControl = {
  readonly element: FormControl;
  readonly key: string;
};

interface ControlSnapshot {
  readonly value: string;
  readonly checked?: boolean;
  readonly selected?: readonly string[];
  readonly selection?: readonly [
    number,
    number,
    'forward' | 'backward' | 'none',
  ];
}

function identifyControls(host: Element): IdentifiedControl[] {
  const occurrences = new Map<string, number>();
  return Array.from(
    host.querySelectorAll<FormControl>('input, textarea, select'),
    (element, index) => {
      if (element.id) return { element, key: `id:${element.id}` };
      if (!element.name) return { element, key: `index:${index}` };
      const name = `name:${element.tagName}:${element.name}`;
      const ordinal = occurrences.get(name) ?? 0;
      occurrences.set(name, ordinal + 1);
      return { element, key: `${name}:${ordinal}` };
    },
  );
}

function capture(control: FormControl): ControlSnapshot {
  if (control instanceof HTMLInputElement) {
    return {
      value: control.value,
      checked: control.checked,
      ...(control.selectionStart !== null && control.selectionEnd !== null
        ? {
            selection: [
              control.selectionStart,
              control.selectionEnd,
              control.selectionDirection ?? 'none',
            ] as const,
          }
        : {}),
    };
  }
  if (control instanceof HTMLSelectElement && control.multiple) {
    return {
      value: control.value,
      selected: Array.from(control.selectedOptions, (option) => option.value),
    };
  }
  return { value: control.value };
}

function restore(control: FormControl, state: ControlSnapshot): void {
  if (control instanceof HTMLInputElement && control.type === 'file') return;
  if (control instanceof HTMLSelectElement && state.selected) {
    const selected = new Set(state.selected);
    for (const option of control.options)
      option.selected = selected.has(option.value);
  } else {
    control.value = state.value;
  }
  if (control instanceof HTMLInputElement && state.checked !== undefined) {
    control.checked = state.checked;
  }
  if (state.selection && 'setSelectionRange' in control) {
    control.setSelectionRange(...state.selection);
  }
}

/** Preserve an unfinished native form while a development view is replaced. */
export async function preserveFormState(
  host: Element,
  update: () => void | Promise<void>,
): Promise<void> {
  const oldControls = identifyControls(host);
  const active = host.contains(document.activeElement)
    ? document.activeElement
    : null;
  const activeKey = oldControls.find(({ element }) => element === active)?.key;
  const snapshots = new Map(
    oldControls
      .filter(
        ({ element }) =>
          !(element instanceof HTMLInputElement && element.type === 'file'),
      )
      .map(({ element, key }) => [key, capture(element)] as const),
  );
  await update();
  await tick();
  identifyControls(host).forEach(({ element, key }) => {
    const state = snapshots.get(key);
    if (state) restore(element, state);
    if (key === activeKey) element.focus();
  });
}
