export class ComponentCompileError extends Error {
  constructor(
    readonly description: string,
    readonly filename: string,
    readonly position?: { readonly line: number; readonly column: number },
  ) {
    super(
      `${filename}${position ? `:${position.line}:${position.column}` : ''}: ${description}`,
    );
    this.name = 'ComponentCompileError';
  }
}

export function fail(filename: string, message: string): never {
  throw new ComponentCompileError(message, filename);
}
