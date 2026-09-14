import { convertReactComponent } from './react-compat.js';
import { convertVueComponent } from './vue-compat.js';
import { reject } from './compat-rules.js';

export { convertReactComponent } from './react-compat.js';
export { convertVueComponent } from './vue-compat.js';

export function convertForeignComponent(
  source: string,
  filename: string,
  options: {
    resolveReactImport?: (specifier: string) => string | undefined;
  } = {},
): string {
  if (filename.endsWith('.tsx'))
    return convertReactComponent(source, filename, options);
  if (filename.endsWith('.vue')) return convertVueComponent(source, filename);
  return reject(filename, 'file extension');
}
