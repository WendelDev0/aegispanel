import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Unmount between tests.
 *
 * React Testing Library only registers its own cleanup when Vitest runs with
 * `globals: true`, and this project runs with them off. Without it every
 * render in a file stacks up in the same document, so a second test sees two
 * copies of the component and `getByText` fails with "found multiple
 * elements" — a failure that has nothing to do with what is being tested.
 */
afterEach(() => {
  cleanup();
});
