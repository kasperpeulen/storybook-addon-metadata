import * as csfTools from 'storybook/internal/csf-tools';

import type { CsfFile } from 'storybook/internal/csf-tools';
import type { IndexedCSFFile } from 'storybook/internal/types';

import { isEstreeCsfTools } from '../src/vite/classes/loadStoryFileParser';

/** Whether the installed csf-tools are the ESTree ones of Storybook 11. */
const isEstree = isEstreeCsfTools(csfTools);

/** The `skip` option of a suite that needs the Babel csf-tools of Storybook 10. */
const needsBabel = isEstree && 'needs the Babel csf-tools of Storybook 10';

/** The `skip` option of a suite that needs the ESTree csf-tools of Storybook 11. */
const needsEstree =
  !isEstree && 'needs the ESTree csf-tools of Storybook 11 (storybookjs/storybook#36613)';

/**
 * Parses a story file with the installed csf-tools.
 * @param code The source of the story file.
 * @returns The parsed story file.
 */
const loadStoryFile = (code: string): CsfFile & IndexedCSFFile =>
  csfTools
    .loadCsf(code, {
      fileName: 'Button.stories.tsx',
      makeTitle: userTitle => userTitle ?? 'Button',
      transformInlineMeta: true,
    })
    .parse();

export { loadStoryFile, needsBabel, needsEstree };
