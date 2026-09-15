import { describe, expect, it } from 'vitest';
import { validateReactRuntimeSource } from '../src/runtime-diagnostics.js';

describe('React runtime diagnostics', () => {
  it('accepts implemented named and namespace APIs', () => {
    expect(() =>
      validateReactRuntimeSource(
        'import React, { useState } from "react"; export const View = () => React.createElement("p", null, useState(1)[0]);',
        '/project/src/View.tsx',
      ),
    ).not.toThrow();
  });

  it('reports unsupported APIs with a source position and supported list', () => {
    expect(() =>
      validateReactRuntimeSource(
        'import * as React from "react";\nexport const View = () => React.useTransition();',
        '/project/src/View.tsx',
      ),
    ).toThrow(
      '/project/src/View.tsx:2:33: react export useTransition is not implemented by the Workstar runtime',
    );
  });

  it('checks APIs accessed through the React default import', () => {
    expect(() =>
      validateReactRuntimeSource(
        'import React from "react";\nexport const View = () => React.startTransition(() => {});',
        '/project/src/View.jsx',
      ),
    ).toThrow(
      '/project/src/View.jsx:2:33: react export startTransition is not implemented by the Workstar runtime',
    );
  });
});
