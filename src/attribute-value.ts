export function assertAttributeName(name: string): void {
  if (
    !/^[a-z_:][a-z0-9_:.\-]*$/i.test(name) ||
    /^on/i.test(name) ||
    /^srcdoc$/i.test(name)
  ) {
    throw new TypeError('Invalid or unsafe attribute name.');
  }
}

export function normalizeAttributeValue(
  name: string,
  value: unknown,
): string | null {
  if (value === null || value === undefined || value === false) return null;
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    throw new TypeError(
      `Attribute ${name} must resolve to a string, number, or boolean.`,
    );
  }
  const text = value === true ? '' : String(value);
  if (/^(href|src|action|formaction|xlink:href)$/i.test(name)) {
    let protocol: string;
    try {
      protocol = new URL(text, 'https://workstar.invalid').protocol;
    } catch {
      throw new TypeError(`Invalid URL for attribute ${name}.`);
    }
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(protocol)) {
      throw new TypeError(`Unsafe URL for attribute ${name}.`);
    }
  }
  return text;
}
