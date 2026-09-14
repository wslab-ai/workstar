import { normalizeAttributeValue } from './attribute-value.js';
import {
  arrayPrefix,
  directivePrefix,
  isDirective,
  isRepeat,
  isTemplate,
  repeatItems,
  repeatPrefix,
  resolve,
  resolveTextareaValue,
  slotPrefix,
  spreadAttributes,
  type Template,
} from './template-model.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

interface HtmlContext {
  inTag: boolean;
  quote: '"' | "'" | null;
  inComment: boolean;
  rawTextElement: string | null;
  tagText: string;
}

function scanStaticMarkup(context: HtmlContext, markup: string): void {
  for (let index = 0; index < markup.length; index++) {
    if (context.inComment) {
      if (markup.startsWith('-->', index)) {
        context.inComment = false;
        index += 2;
      }
      continue;
    }
    if (
      !context.inTag &&
      context.rawTextElement === null &&
      markup.startsWith('<!--', index)
    ) {
      context.inComment = true;
      index += 3;
      continue;
    }
    const character = markup[index];
    if (!context.inTag) {
      if (character !== '<') continue;
      if (
        context.rawTextElement !== null &&
        !markup
          .slice(index)
          .toLowerCase()
          .startsWith(`</${context.rawTextElement}`)
      ) {
        continue;
      }
      context.inTag = true;
      context.tagText = '<';
    } else if (context.quote !== null) {
      context.tagText += character;
      if (character === context.quote) context.quote = null;
    } else if (character === '"' || character === "'") {
      context.tagText += character;
      context.quote = character;
    } else if (character === '>') {
      const match = /^<\s*(\/?)\s*([a-z][a-z0-9:-]*)/i.exec(context.tagText);
      if (match) {
        const name = match[2]?.toLowerCase();
        if (match[1] === '/' && name === context.rawTextElement) {
          context.rawTextElement = null;
        } else if (
          match[1] !== '/' &&
          name &&
          /^(script|style|textarea|title|noscript)$/.test(name) &&
          !context.tagText.trimEnd().endsWith('/')
        ) {
          context.rawTextElement = name;
        }
      }
      context.inTag = false;
      context.tagText = '';
    } else {
      context.tagText += character;
    }
  }
}

function renderTemplate(template: Template): string {
  const context: HtmlContext = {
    inTag: false,
    quote: null,
    inComment: false,
    rawTextElement: null,
    tagText: '',
  };
  let output = '';
  let pendingTextareaValue: string | null = null;
  const appendStatic = (markup: string) => {
    if (pendingTextareaValue !== null) {
      if (!markup.startsWith('>')) {
        throw new Error('Textarea value directive must end the opening tag.');
      }
      output += `>${pendingTextareaValue}${markup.slice(1)}`;
      pendingTextareaValue = null;
    } else {
      output += markup;
    }
    scanStaticMarkup(context, markup);
  };
  for (const [index, value] of template.values.entries()) {
    const before = template.strings[index] ?? '';
    appendStatic(before);
    if (isDirective(value)) {
      if (
        !context.inTag ||
        context.quote !== null ||
        /^<\s*\//.test(context.tagText)
      ) {
        throw new Error(
          'Directives must be placed inside an opening HTML tag.',
        );
      }
      if (value.kind === 'attribute') {
        const attribute = normalizeAttributeValue(
          value.name,
          resolve(value.source),
        );
        if (attribute !== null) {
          output += ` ${value.name}="${escapeHtml(attribute)}"`;
        }
      } else if (value.kind === 'attributes') {
        for (const [name, attribute] of spreadAttributes(value.source)) {
          output += ` ${name}="${escapeHtml(attribute)}"`;
        }
      } else if (value.kind === 'textarea') {
        if (!/^<\s*textarea\b/i.test(context.tagText)) {
          throw new Error(
            'Textarea value directive requires a textarea element.',
          );
        }
        pendingTextareaValue = escapeHtml(resolveTextareaValue(value.source));
      }
      output += ` ${directivePrefix}${index}=""`;
    } else {
      if (
        context.inTag ||
        context.inComment ||
        context.rawTextElement !== null
      ) {
        throw new Error(
          'Dynamic attributes require attr(). Child expressions belong in element content.',
        );
      }
      output += `<!--${slotPrefix}${index}-->${renderValue(resolve(value))}<!--/${slotPrefix}${index}-->`;
    }
  }
  appendStatic(template.strings[template.strings.length - 1] ?? '');
  return output;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (isRepeat(value)) {
    return repeatItems(value)
      .map(
        ({ item }, index) =>
          `<!--${repeatPrefix}${index}-->${renderValue(value.view({ value: item }))}<!--/${repeatPrefix}${index}-->`,
      )
      .join('');
  }
  if (isTemplate(value)) return renderTemplate(value);
  if (Array.isArray(value)) {
    return value
      .map(
        (child, index) =>
          `<!--${arrayPrefix}${index}-->${renderValue(resolve(child))}<!--/${arrayPrefix}${index}-->`,
      )
      .join('');
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return escapeHtml(String(value));
  }
  throw new TypeError(
    'Unsupported server template value. Use text, html, or an array.',
  );
}

export function renderToString(content: unknown): string {
  return `<!--workstar-root-->${renderValue(resolve(content))}<!--/workstar-root-->`;
}
