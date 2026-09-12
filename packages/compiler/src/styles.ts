import { createHash } from 'node:crypto';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

export interface CompiledStyle {
  css: string;
  scopeAttribute?: string;
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
  const root = postcss.parse(css, { from: filename });
  root.walkAtRules((rule) => {
    if (rule.name === 'import' || rule.name === 'charset') {
      throw new Error(
        `${filename}: @${rule.name} belongs in a global stylesheet.`,
      );
    }
    if (/keyframes$/i.test(rule.name) && !global) {
      throw new Error(`${filename}: put @keyframes in <style global>.`);
    }
  });
  if (global) return { css: root.toString().trim() };

  const scopeAttribute = `data-workstar-${createHash('sha256')
    .update(filename)
    .digest('hex')
    .slice(0, 10)}`;
  root.walkRules((rule) => {
    rule.selector = scopeSelector(rule.selector, scopeAttribute);
  });
  return { css: root.toString().trim(), scopeAttribute };
}
