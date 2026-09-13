import { createHash } from 'node:crypto';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

export interface CompiledStyle {
  css: string;
  scopeAttribute?: string;
}

export class StyleCompileError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
    this.name = 'StyleCompileError';
  }
}

function scopeSelector(selector: string, attribute: string): string {
  const scopeNode = selectorParser().astSync(`:where([${attribute}])`).first
    ?.first;
  if (!scopeNode) throw new Error('Could not create a style scope.');

  return selectorParser((selectors) => {
    selectors.each((part) => {
      if (part.toString().includes(':global(')) {
        throw new Error('Use <style global> for global selectors.');
      }
      let compound: typeof part.nodes = [];
      const addScope = () => {
        if (compound.length === 0) return;
        const pseudoElement = compound.find(
          (node) => node.type === 'pseudo' && node.value.startsWith('::'),
        );
        if (pseudoElement) part.insertBefore(pseudoElement, scopeNode.clone());
        else part.insertAfter(compound.at(-1)!, scopeNode.clone());
        compound = [];
      };
      for (const node of [...part.nodes]) {
        if (node.type === 'combinator') addScope();
        else compound.push(node);
      }
      addScope();
    });
  }).processSync(selector);
}

/** Compile CSS at build time; styles never depend on client hydration. */
export function compileStyle(
  css: string,
  filename: string,
  global = false,
): CompiledStyle {
  try {
    const root = postcss.parse(css, { from: filename });
    root.walkAtRules((rule) => {
      if (rule.name === 'import' || rule.name === 'charset') {
        throw rule.error(`@${rule.name} belongs in a global stylesheet.`);
      }
      if (/keyframes$/i.test(rule.name) && !global) {
        throw rule.error('Put @keyframes in <style global>.');
      }
    });
    if (global) return { css: root.toString().trim() };

    const scopeAttribute = `data-workstar-${createHash('sha256')
      .update(filename)
      .digest('hex')
      .slice(0, 10)}`;
    root.walkRules((rule) => {
      try {
        rule.selector = scopeSelector(rule.selector, scopeAttribute);
      } catch (error) {
        throw rule.error(
          error instanceof Error ? error.message : String(error),
        );
      }
    });
    return { css: root.toString().trim(), scopeAttribute };
  } catch (error) {
    if (error instanceof postcss.CssSyntaxError) {
      throw new StyleCompileError(
        error.reason,
        error.line ?? 1,
        error.column ?? 1,
      );
    }
    throw error;
  }
}
