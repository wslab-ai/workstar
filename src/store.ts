import { signal, type Writable } from './reactivity.js';

type StoreValue = string | number | boolean | bigint | null | undefined;

function isStoreValue(value: unknown): value is StoreValue {
  return (
    value === null ||
    value === undefined ||
    ['string', 'number', 'boolean', 'bigint'].includes(typeof value)
  );
}

/** A shallow reactive record with independent tracking for each field. */
export function store<T extends Record<string, StoreValue>>(initial: T): T {
  if (
    initial === null ||
    typeof initial !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(initial))
  ) {
    throw new TypeError('A store needs a plain record.');
  }
  const target: Record<string, StoreValue> = {};
  const fields = new Map<string, Writable<StoreValue>>();
  for (const key of Reflect.ownKeys(initial)) {
    if (typeof key !== 'string')
      throw new TypeError('Store keys must be strings.');
    const descriptor = Object.getOwnPropertyDescriptor(initial, key);
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !isStoreValue(descriptor.value)
    ) {
      throw new TypeError(`Store field ${key} must be a primitive value.`);
    }
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: descriptor.enumerable === true,
      writable: true,
      value: descriptor.value,
    });
    fields.set(key, signal(descriptor.value));
  }
  return new Proxy(target, {
    get(record, key, receiver) {
      return typeof key === 'string' && fields.has(key)
        ? fields.get(key)!.value
        : Reflect.get(record, key, receiver);
    },
    set(record, key, value) {
      if (typeof key !== 'string' || !fields.has(key) || !isStoreValue(value))
        return false;
      Reflect.set(record, key, value);
      fields.get(key)!.value = value;
      return true;
    },
    deleteProperty() {
      return false;
    },
    defineProperty() {
      return false;
    },
  }) as T;
}
