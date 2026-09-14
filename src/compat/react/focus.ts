interface FocusSnapshot {
  readonly id: string;
  readonly path: readonly number[];
  readonly tagName: string;
  readonly name: string | null;
  readonly type: string | null;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  readonly selectionDirection: 'forward' | 'backward' | 'none' | null;
}

function editable(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  );
}

export function captureFocus(host: Element): FocusSnapshot | null {
  const active = host.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !host.contains(active)) return null;
  const path: number[] = [];
  for (let element: Element | null = active; element && element !== host;) {
    const parent: Element | null = element.parentElement;
    if (!parent) return null;
    path.unshift(
      Array.prototype.indexOf.call(parent.children, element) as number,
    );
    element = parent;
  }
  return {
    id: active.id,
    path,
    tagName: active.tagName,
    name: active.getAttribute('name'),
    type: active.getAttribute('type'),
    selectionStart: editable(active) ? active.selectionStart : null,
    selectionEnd: editable(active) ? active.selectionEnd : null,
    selectionDirection: editable(active) ? active.selectionDirection : null,
  };
}

export function restoreFocus(
  host: Element,
  snapshot: FocusSnapshot | null,
): void {
  if (!snapshot) return;
  let target: Element | undefined = snapshot.id
    ? [...host.querySelectorAll('[id]')].find(
        (element) => element.id === snapshot.id,
      )
    : undefined;
  if (!target) {
    target = host;
    for (const index of snapshot.path) {
      target = target?.children.item(index) ?? undefined;
      if (!target) return;
    }
  }
  if (
    !(target instanceof HTMLElement) ||
    target.tagName !== snapshot.tagName ||
    target.getAttribute('name') !== snapshot.name ||
    target.getAttribute('type') !== snapshot.type
  )
    return;
  target.focus({ preventScroll: true });
  if (
    editable(target) &&
    snapshot.selectionStart !== null &&
    snapshot.selectionEnd !== null
  ) {
    try {
      target.setSelectionRange(
        snapshot.selectionStart,
        snapshot.selectionEnd,
        snapshot.selectionDirection ?? 'none',
      );
    } catch {
      // Input types without selection support can still regain focus.
    }
  } else if (
    target instanceof HTMLInputElement &&
    ['email', 'number'].includes(target.type)
  ) {
    const type = target.type;
    const end = target.value.length;
    try {
      target.type = 'text';
      target.setSelectionRange(end, end);
    } finally {
      target.type = type;
    }
  }
}
