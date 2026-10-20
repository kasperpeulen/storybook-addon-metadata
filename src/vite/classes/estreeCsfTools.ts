import * as csfTools from 'storybook/internal/csf-tools';

import type { CsfFile as InstalledCsfFile } from 'storybook/internal/csf-tools';

// EstreeParser uses the ESTree csf-tools of Storybook 11 and is only loaded
// there. These are its imports from them: typed as on Storybook 11, and `any`
// on Storybook 10, which does not export them, so EstreeParser type-checks on
// both.

/** Whether the installed csf-tools are the ESTree ones of Storybook 11. */
type IsEstree = typeof csfTools extends { parseModule: unknown } ? true : false;

/** The csf-tools helpers EstreeParser uses. The intersection only lets `Pick` compile on 10. */
type Helpers = IsEstree extends true
  ? Pick<
      typeof csfTools & Record<'staticKey' | 'textOf' | 'unwrapExpression', unknown>,
      'staticKey' | 'textOf' | 'unwrapExpression'
    >
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;

/** The parsed story file, with `objects()` and `componentImport`. */
type CsfFile = IsEstree extends true
  ? InstalledCsfFile
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;

/** The editor `CsfFile#objects()` returns for the meta and each story. */
type CsfObject = IsEstree extends true
  ? CsfFile extends { objects(...args: never[]): ReadonlyArray<infer O> }
    ? O
    : never
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;

/** A value read with `CsfObject#getValue`. */
type CsfValue = IsEstree extends true
  ? CsfObject extends { getValue(path: never): infer V }
    ? V
    : never
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;

/** An ESTree node of the story file. */
type ESTreeNode = IsEstree extends true
  ? Helpers['textOf'] extends (node: infer N) => string
    ? N
    : never
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;

const { staticKey, textOf, unwrapExpression } = csfTools as unknown as Helpers;

export { staticKey, textOf, unwrapExpression };
export type { CsfFile, CsfObject, CsfValue, ESTreeNode };
