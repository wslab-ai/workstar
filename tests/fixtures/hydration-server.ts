import { renderToString } from 'workstar/server';
import { createView } from './hydration-view.js';

export function render(): string {
  return renderToString(createView());
}
