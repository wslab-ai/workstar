import type { ComponentType } from './vnode.js';

const recordedFrames = Symbol('workstar.react.component-frames');
const originalMessage = Symbol('workstar.react.original-message');

function namedComponent(type: ComponentType): string {
  const candidate = type as ComponentType & {
    readonly displayName?: string;
    readonly name?: string;
  };
  return candidate.displayName || candidate.name || 'Anonymous';
}

export function componentFrame(type: ComponentType, path: string): string {
  return `    at ${namedComponent(type)} (${path})`;
}

/** Add actionable component context once while an error bubbles through owners. */
export function describeComponentError(
  thrown: unknown,
  type: ComponentType,
  path: string,
): unknown {
  if (!(thrown instanceof Error)) return thrown;
  const error = thrown as Error & {
    [recordedFrames]?: Set<string>;
    [originalMessage]?: string;
  };
  const frames = error[recordedFrames] ?? new Set<string>();
  const frame = componentFrame(type, path);
  if (frames.has(frame)) return error;
  frames.add(frame);
  if (!error[recordedFrames]) {
    Object.defineProperty(error, recordedFrames, { value: frames });
    Object.defineProperty(error, originalMessage, { value: error.message });
  }
  error.message = `${error[originalMessage]}\nWorkstar component stack:\n${[
    ...frames,
  ].join('\n')}`;
  return error;
}

export function unsupportedElementMessage(value: unknown): string {
  const description =
    typeof value === 'symbol'
      ? (value.description ?? String(value))
      : Object.prototype.toString.call(value);
  return (
    `Unsupported React element type (${description}). ` +
    'Check that the component export exists and that its React API is supported by Workstar.'
  );
}
