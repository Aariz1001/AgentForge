import { describe, it, expect } from 'vitest';
import { shell } from './cli/src/tools/index';

describe('shell tool output', () => {
  it('stores full output on success', async () => {
    const result = await shell('echo hello', { showOutput: false });
    expect(result.success).toBe(true);
    expect(result.data.fullOutput).toContain('hello');
  });
});
