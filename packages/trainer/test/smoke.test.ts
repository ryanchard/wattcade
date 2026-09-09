import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('trainer package', () => {
  it('is importable', () => {
    expect(PACKAGE_NAME).toBe('@paperboy/trainer');
  });
});
