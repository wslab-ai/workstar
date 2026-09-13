export interface ComponentImport {
  path: string;
  start: number;
  end: number;
}

// Keep navigation deliberately narrow: only static, relative component imports in
// a component script become links. Other imports belong to TypeScript tooling.
export function findComponentImports(source: string): ComponentImport[] {
  const imports: ComponentImport[] = [];
  const scripts = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

  for (const script of source.matchAll(scripts)) {
    const body = script[1];
    const bodyStart = script.index + script[0].indexOf(body);
    const staticImport =
      /^[ \t]*import[ \t]+(?:type[ \t]+)?(?:[^\r\n;]*?[ \t]+from[ \t]+)?(['"])(\.{1,2}\/[^'"\r\n]+\.workstar)\1/gm;

    for (const match of body.matchAll(staticImport)) {
      const path = match[2];
      const start = bodyStart + match.index + match[0].lastIndexOf(path);
      imports.push({ path, start, end: start + path.length });
    }
  }

  return imports;
}
