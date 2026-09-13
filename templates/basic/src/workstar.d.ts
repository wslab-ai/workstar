declare module '*.workstar' {
  import type { Template } from 'workstar';
  import type { HotContext } from 'workstar/dev';

  export function render(
    props: Record<string, unknown>,
    context?: HotContext,
  ): Template;
}
