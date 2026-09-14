import { describe, expect, it, vi } from 'vitest';
import { computed, effect, signal, store, tick } from '../src/index.js';

describe('reactivity', () => {
  it('updates effects once after multiple synchronous writes', async () => {
    const count = signal(0);
    const observed = vi.fn(() => count.value);
    const dispose = effect(observed);

    count.value = 1;
    count.value = 2;
    await tick();

    expect(observed).toHaveBeenCalledTimes(2);
    expect(observed).toHaveLastReturnedWith(2);
    dispose();
  });

  it('tracks changing dependencies and stops after disposal', async () => {
    const selected = signal(true);
    const first = signal('first');
    const second = signal('second');
    const observed = vi.fn(() => (selected.value ? first.value : second.value));
    const dispose = effect(observed);

    selected.value = false;
    await tick();
    first.value = 'ignored';
    await tick();
    expect(observed).toHaveBeenCalledTimes(2);

    second.value = 'updated';
    await tick();
    expect(observed).toHaveLastReturnedWith('updated');
    dispose();
    second.value = 'after disposal';
    await tick();
    expect(observed).toHaveBeenCalledTimes(3);
  });

  it('computes lazily and invalidates through a chain', async () => {
    const count = signal(2);
    const double = computed(() => count.value * 2);
    const label = computed(() => `Value: ${double.value}`);
    const observed = vi.fn(() => label.value);
    const dispose = effect(observed);

    expect(observed).toHaveLastReturnedWith('Value: 4');
    count.update((current) => current + 1);
    await tick();
    expect(observed).toHaveLastReturnedWith('Value: 6');
    dispose();
  });

  it('does not retain an unobserved computed dependency', () => {
    const source = signal(1);
    const derive = vi.fn(() => source.value * 2);
    const doubled = computed(derive);

    expect(doubled.value).toBe(2);
    expect(doubled.value).toBe(2);
    expect(derive).toHaveBeenCalledTimes(2);
    source.value = 2;
    expect(doubled.value).toBe(4);
  });

  it('runs effect cleanup before rerun and on disposal', async () => {
    const source = signal(0);
    const cleanup = vi.fn();
    const dispose = effect(() => {
      source.value;
      return cleanup;
    });

    source.value = 1;
    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
    dispose();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('tracks shallow store fields independently', async () => {
    const state = store({ count: 0, label: 'Ready' });
    const observed = vi.fn(() => state.count);
    const dispose = effect(observed);

    state.label = 'Updated';
    await tick();
    expect(observed).toHaveBeenCalledTimes(1);

    state.count++;
    await tick();
    expect(observed).toHaveBeenCalledTimes(2);
    expect(observed).toHaveLastReturnedWith(1);
    expect(Object.getOwnPropertyDescriptor(state, 'count')?.value).toBe(1);
    dispose();
  });

  it('rejects nested state and shape changes in a shallow store', () => {
    expect(() => store({ nested: { value: 1 } } as never)).toThrow(
      'primitive value',
    );
    const state = store({ count: 0 });
    expect(Reflect.set(state, 'other', 1)).toBe(false);
    expect(Reflect.deleteProperty(state, 'count')).toBe(false);
  });
});
