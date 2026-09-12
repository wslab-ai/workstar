declare module '*.workstar' {
  import type { Template } from 'workstar';

  export function render(props: Record<string, unknown>): Template;
}
