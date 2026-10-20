import type { ArgRecord } from '@/types';
import type { CsfFile } from 'storybook/internal/csf-tools';
import type { IndexedCSFFile } from 'storybook/internal/types';

/** What the parsers read from a story file. */
type StoryFileData = {
  /** The args of the meta under `MetaSymbol`, and of each story under its export name. */
  args: Record<string | symbol, ArgRecord | undefined>;
  /** The name the component is exported under. */
  componentName: string;
  /** The name the component is imported as. */
  importedAs: string;
};

/** Reads the args and the component of a parsed story file. */
type StoryFileParser = {
  /** The key of the meta's args in {@link StoryFileData.args}. */
  MetaSymbol: symbol;
  extractStoryFileData: (csf: CsfFile & IndexedCSFFile) => StoryFileData;
};

/**
 * Whether csf-tools are the ESTree ones of Storybook 11, which alone export `parseModule`.
 * @param csfTools The `storybook/internal/csf-tools` module.
 * @returns A boolean indicating whether they hand out ESTree nodes.
 */
const isEstreeCsfTools = (csfTools: object): boolean =>
  'parseModule' in csfTools && typeof csfTools.parseModule === 'function';

let parser: Promise<StoryFileParser> | undefined;

/**
 * Storybook 11 replaced the Babel-based csf-tools of Storybook 10 with ESTree
 * ones, so story files are read by `BabelParser` on Storybook 10 and by
 * `EstreeParser` on Storybook 11. Each is imported only on the Storybook it is
 * written for: `BabelParser` needs `@babel/types`, which a Storybook 11 project
 * may not have, and `EstreeParser` needs csf-tools exports that Storybook 10
 * does not have.
 * @returns The parser for the installed Storybook.
 */
const loadStoryFileParser = (): Promise<StoryFileParser> =>
  (parser ??= (async () => {
    if (isEstreeCsfTools(await import('storybook/internal/csf-tools'))) {
      const { EstreeParser, MetaSymbol } = await import('./EstreeParser');
      return {
        MetaSymbol,
        extractStoryFileData: csf => new EstreeParser(csf).extractStoryFileData(),
      };
    }
    const { BabelParser, MetaSymbol } = await import('./BabelParser');
    return {
      MetaSymbol,
      extractStoryFileData: csf => new BabelParser(csf).extractStoryFileData(),
    };
  })());

export { isEstreeCsfTools, loadStoryFileParser };
