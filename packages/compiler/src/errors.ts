export class ComponentCompileError extends Error {
  constructor(
    message: string,
    readonly filename: string,
  ) {
    super(`${filename}: ${message}`);
    this.name = 'ComponentCompileError';
  }
}

export function fail(filename: string, message: string): never {
  throw new ComponentCompileError(message, filename);
}
