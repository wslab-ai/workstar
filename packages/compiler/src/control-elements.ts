const controlNames = new Set(['Each', 'If', 'Else', 'Use']);
export const controlAttribute = 'data-workstar-compiler-control';

export interface NormalizedControls {
  source: string;
  count: number;
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
  throw new Error('Unclosed HTML tag.');
}

/** Adapt authoring controls to HTML parser insertion modes, including select and table. */
export function normalizeControls(source: string): NormalizedControls {
  if (source.includes(controlAttribute)) {
    throw new Error(`${controlAttribute} is reserved for the compiler.`);
  }
  const scriptEnd = /<\/script\s*>/i.exec(source);
  const start = scriptEnd ? scriptEnd.index + scriptEnd[0].length : 0;
  let result = source.slice(0, start);
  let cursor = start;
  let count = 0;
  const stack: string[] = [];

  while (cursor < source.length) {
    const opening = source.indexOf('<', cursor);
    if (opening < 0) break;
    result += source.slice(cursor, opening);
    if (source.startsWith('<!--', opening)) {
      const end = source.indexOf('-->', opening + 4);
      if (end < 0) throw new Error('Unclosed HTML comment.');
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
      if (stack.pop() !== name) {
        throw new Error(`Mismatched </${name}> control element.`);
      }
      result += '</template>';
    } else {
      if (selfClosing && name !== 'Use') {
        throw new Error(`<${name}> cannot be self-closing.`);
      }
      const authoredAttributes = tag.slice(match[0].length, -1);
      const attributes = selfClosing
        ? authoredAttributes.replace(/\/\s*$/, '')
        : authoredAttributes;
      result += `<template ${controlAttribute}="${name}"${attributes}>`;
      if (selfClosing) result += '</template>';
      else stack.push(name);
      count++;
    }
    cursor = end + 1;
  }
  result += source.slice(cursor);
  if (stack.length > 0) {
    throw new Error(`Unclosed <${stack.at(-1)}> control element.`);
  }
  return { source: result, count };
}
