import type { ScriptStatement } from './component-script.js';

export interface SourceOrigin {
  readonly generatedOffset: number;
  readonly authoredOffset: number;
}

/** Records provenance while assembling the generated TypeScript module. */
export class ComponentCode {
  private readonly parts: string[] = [];
  private length = 0;
  readonly origins: SourceOrigin[] = [];

  append(code: string, authoredOffset?: number, exact = false): void {
    if (authoredOffset !== undefined) {
      this.origins.push({
        generatedOffset: this.length,
        authoredOffset,
      });
      if (exact) {
        for (const match of code.matchAll(/\n([^\n]*)/g)) {
          const line = match[1] ?? '';
          const firstToken = /\S/.exec(line)?.index;
          if (firstToken === undefined) continue;
          const offset = match.index + 1 + firstToken;
          this.origins.push({
            generatedOffset: this.length + offset,
            authoredOffset: authoredOffset + offset,
          });
        }
      }
    }
    this.parts.push(code);
    this.length += code.length;
  }

  appendStatements(
    statements: readonly ScriptStatement[],
    sourceOffset: (offset: number) => number,
  ): void {
    statements.forEach((statement, index) => {
      if (index > 0) this.append('\n');
      this.append(
        statement.code,
        statement.sourceOffset === undefined
          ? undefined
          : sourceOffset(statement.sourceOffset),
        statement.exact,
      );
    });
  }

  toString(): string {
    return this.parts.join('');
  }
}
