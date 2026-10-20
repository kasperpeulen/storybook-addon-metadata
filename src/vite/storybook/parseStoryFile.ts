import { join } from 'node:path';

import { getStoryTitle } from 'storybook/internal/common';
import { readCsf } from 'storybook/internal/csf-tools';
import { resolveModuleName } from 'typescript';

import { REGEX } from '@/constants';

import { loadStoryFileParser } from '../classes';

import type { Typescript } from '../classes';
import type { ParsedStoryFile, StorybookConfig } from '@/types';

/**
 * Parses a `.stories.tsx/jsx` file into an object that can be used by the addon to generate
 * a map of components, and generate UIDs.
 * @param path The path to the Story file to parse.
 * @param storybookConfig The resolved {@link StorybookConfig} object.
 * @param viteRoot The root directory being used by vite. This may differ from the project
 * root, but the `storyPath` will be relative to it.
 * @param typescript Instance of the {@link Typescript} helper class to use for module resolution.
 * @returns An object containing information about the component that the story file relates to.
 */
const parseStoryFile = async (
  storyPath: string,
  storybookConfig: StorybookConfig,
  viteRoot: string,
  typescript: Typescript,
): Promise<ParsedStoryFile> => {
  const { storyTitleOptions } = storybookConfig;
  const storyFilePath = join(viteRoot, storyPath);
  // Use the internal CSF reader to parse the story file.
  const csf = (
    await readCsf(storyFilePath, {
      fileName: storyFilePath,
      makeTitle: userTitle =>
        getStoryTitle({
          ...storyTitleOptions,
          storyFilePath,
          userTitle,
        }) ??
        userTitle ??
        'unknown',
      transformInlineMeta: true,
    })
  ).parse();

  // Extract the basic data that the CSF parser returns.
  const {
    _rawComponentPath: componentPath,
    meta: { id, includeStories = [], excludeStories = [], tags = [], title },
    stories: csfStories,
  } = csf;
  const { MetaSymbol, extractStoryFileData } = await loadStoryFileParser();
  const { args, componentName, importedAs } = extractStoryFileData(csf);

  // Resolve the component path to a module and extract the full path
  const componentModule = componentPath
    ? resolveModuleName(componentPath, storyFilePath, typescript.compilerOptions, typescript.host)
    : null;

  const resolvedComponentPath = componentModule?.resolvedModule
    ? join(
        viteRoot,
        componentModule?.resolvedModule?.resolvedFileName.replace(
          viteRoot,
          REGEX.REPLACEMENTS.EMPTY,
        ),
      )
    : null;

  // Story args are keyed by export name
  const exportNames = new Map(csf.indexInputs.map(input => [input.__id, input.exportName]));

  const stories = csfStories.map(story => {
    const metaArgs = args[MetaSymbol];
    const exportName = exportNames.get(story.id);
    const storyArgs = exportName ? args[exportName] : undefined;

    return {
      ...story,
      args: {
        ...metaArgs,
        ...storyArgs,
      },
    };
  });

  return {
    componentPath: resolvedComponentPath,
    componentName,
    componentAlias: importedAs,
    excludeStories,
    id,
    includeStories,
    stories,
    storyFilePath,
    tags,
    title,
    used: false,
  };
};

export { parseStoryFile };
