const controlNames = new Set(['Each', 'If', 'Else', 'Use']);
export const controlAttribute = 'data-workstar-compiler-control';

export interface NormalizedControls {
  source: string;
  count: number;
  originalOffset: (normalizedOffset: number) => number;
}

export class ControlSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = 'ControlSyntaxError';
  }
}

interface Replacement {
  generatedStart: number;
  generatedEnd: number;
  authoredStart: number;
  authoredEnd: number;
}

function tagEnd(source: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  throw new ControlSyntaxError('Unclosed HTML tag.', start);
}

/** Adapt authoring controls to HTML parser insertion modes, including select and table. */
export function normalizeControls(source: string): NormalizedControls {
  if (source.includes(controlAttribute)) {
    throw new ControlSyntaxError(
      `${controlAttribute} is reserved for the compiler.`,
      source.indexOf(controlAttribute),
    );
  }
  const scriptEnd = /<\/script\s*>/i.exec(source);
  const start = scriptEnd ? scriptEnd.index + scriptEnd[0].length : 0;
  let result = source.slice(0, start);
  let cursor = start;
  let count = 0;
  const stack: Array<{ name: string; offset: number }> = [];
  const replacements: Replacement[] = [];

  const appendReplacement = (
    authoredStart: number,
    authoredEnd: number,
    replacement: string,
  ): void => {
    const generatedStart = result.length;
    result += replacement;
    replacements.push({
      generatedStart,
      generatedEnd: result.length,
      authoredStart,
      authoredEnd,
    });
  };

  while (cursor < source.length) {
    const opening = source.indexOf('<', cursor);
    if (opening < 0) break;
    result += source.slice(cursor, opening);
    if (source.startsWith('<!--', opening)) {
      const end = source.indexOf('-->', opening + 4);
      if (end < 0)
        throw new ControlSyntaxError('Unclosed HTML comment.', opening);
      result += source.slice(opening, end + 3);
      cursor = end + 3;
      continue;
    }
    const end = tagEnd(source, opening);
    const tag = source.slice(opening, end + 1);
    const match = /^<\s*(\/?)\s*([A-Za-z][\w:-]*)(?=[\s/>])/.exec(tag);
    const name = match?.[2];
    if (!name || !controlNames.has(name)) {
      result += tag;
      cursor = end + 1;
      if (/^<textarea(?=[\s>])/i.test(tag)) {
        const closing = /<\/textarea\s*>/gi;
        closing.lastIndex = cursor;
        const close = closing.exec(source);
        if (close) {
          result += source.slice(cursor, close.index + close[0].length);
          cursor = close.index + close[0].length;
        }
      }
      continue;
    }
    const closing = match[1] === '/';
    const selfClosing = /\/\s*>$/.test(tag);
    if (closing) {
      if (stack.pop()?.name !== name) {
        throw new ControlSyntaxError(
          `Mismatched </${name}> control element.`,
          opening,
        );
      }
      appendReplacement(opening, end + 1, '</template>');
    } else {
      if (selfClosing && name !== 'Use') {
        throw new ControlSyntaxError(
          `<${name}> cannot be self-closing.`,
          opening,
        );
      }
      const authoredAttributes = tag.slice(match[0].length, -1);
      const attributes = selfClosing
        ? authoredAttributes.replace(/\/\s*$/, '')
        : authoredAttributes;
      appendReplacement(
        opening,
        end + 1,
        `<template ${controlAttribute}="${name}"${attributes}>${selfClosing ? '</template>' : ''}`,
      );
      if (!selfClosing) stack.push({ name, offset: opening });
      count++;
    }
    cursor = end + 1;
  }
  result += source.slice(cursor);
  if (stack.length > 0) {
    const unclosed = stack.at(-1)!;
    throw new ControlSyntaxError(
      `Unclosed <${unclosed.name}> control element.`,
      unclosed.offset,
    );
  }
  return {
    source: result,
    count,
    originalOffset(normalizedOffset) {
      let difference = 0;
      for (const replacement of replacements) {
        if (normalizedOffset < replacement.generatedStart) break;
        if (normalizedOffset < replacement.generatedEnd) {
          return replacement.authoredStart;
        }
        difference +=
          replacement.generatedEnd -
          replacement.generatedStart -
          (replacement.authoredEnd - replacement.authoredStart);
      }
      return normalizedOffset - difference;
    },
  };
}
