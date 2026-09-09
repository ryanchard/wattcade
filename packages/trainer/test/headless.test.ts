import { afterEach, describe, expect, it, vi } from 'vitest';

const globals = ['navigator', 'window', 'document'] as const;

describe('the trainer package is headless', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('imports with no browser globals present', async () => {
    const saved = new Map<string, PropertyDescriptor | undefined>();
    for (const name of globals) {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Reflect.deleteProperty(globalThis, name);
    }
    try {
      vi.resetModules();
      // Every module in the package is reachable from the index, so a
      // module-scope browser global anywhere in src/ throws here.
      await expect(import('../src/index.js')).resolves.toBeDefined();
    } finally {
      for (const name of globals) {
        const d = saved.get(name);
        if (d !== undefined) Object.defineProperty(globalThis, name, d);
      }
    }
  });
});
