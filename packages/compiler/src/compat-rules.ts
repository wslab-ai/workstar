export const pathExpression = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

export function reject(filename: string, reason: string): never {
  throw new Error(filename + ': unsupported compatibility syntax: ' + reason);
}
