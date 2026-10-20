import { readFile } from 'node:fs/promises';

import { globalPackages as globalManagerPackages } from 'storybook/internal/manager/globals';
import { globalPackages as globalPreviewPackages } from 'storybook/internal/preview/globals';
import type { PackageJson } from 'storybook/internal/types';
import { defineConfig } from 'tsup';

import type { Options } from 'tsup';

// The current browsers supported by Storybook v7
const BROWSER_TARGET: Options['target'] = ['chrome100', 'safari15', 'firefox91'];
const NODE_TARGET: Options['target'] = ['node18'];

type BundlerConfig = {
  bundler?: {
    exportEntries?: string[];
    nodeEntries?: string[];
    managerEntries?: string[];
    previewEntries?: string[];
  };
};

export default defineConfig(async options => {
  // Reading the three types of entries from package.json, which has the following structure:
  // {
  //  ...
  //   "bundler": {
  //     "exportEntries": ["./src/index.ts"],
  //     "managerEntries": ["./src/manager.ts"],
  //     "previewEntries": ["./src/preview.ts"]
  //     "nodeEntries": ["./src/preset.ts"]
  //   }
  // }
  const packageJson = (await readFile('./package.json', 'utf8').then(JSON.parse)) as BundlerConfig &
    PackageJson;
  const {
    bundler: {
      exportEntries = [],
      managerEntries = [],
      previewEntries = [],
      nodeEntries = [],
    } = {},
    name,
  } = packageJson;

  const GLOBALS = ['@babel/types', 'jiti', 'prettier', 'typescript'];
  name && GLOBALS.push(`.cache/${name}`);

  const commonConfig: Options = {
    clean: options.watch ? false : true,
    minify: !options.watch,
    sourcemap: true,
    splitting: true,
    treeshake: true,
  };

  const configs: Options[] = [];

  // Export entries are entries meant to be manually imported by the user
  // they are not meant to be loaded by the manager or preview
  // they'll be usable in both node and browser environments, depending on which features and modules they depend on
  if (exportEntries.length) {
    configs.push({
      ...commonConfig,
      name: 'exports',
      dts: {
        resolve: true,
      },
      entry: exportEntries,
      external: [...GLOBALS, ...globalManagerPackages, ...globalPreviewPackages],
      format: ['esm', 'cjs'],
      platform: 'neutral',
      target: [...BROWSER_TARGET, ...NODE_TARGET],
    });
  }

  // Manager entries are entries meant to be loaded into the manager UI
  // they'll have manager-specific packages externalized and they won't be usable in node
  // they won't have types generated for them as they're usually loaded automatically by Storybook
  if (managerEntries.length) {
    configs.push({
      ...commonConfig,
      entry: managerEntries,
      external: [...GLOBALS, ...globalManagerPackages],
      format: ['esm'],
      name: 'manager',
      platform: 'browser',
      target: BROWSER_TARGET,
    });
  }

  // Preview entries are entries meant to be loaded into the preview iframe
  // they'll have preview-specific packages externalized and they won't be usable in node
  // they'll have types generated for them so they can be imported when setting up Portable Stories
  if (previewEntries.length) {
    configs.push({
      ...commonConfig,
      dts: { resolve: true },
      entry: previewEntries,
      external: [...GLOBALS, ...globalPreviewPackages],
      format: ['esm', 'cjs'],
      name: 'preview',
      platform: 'browser',
      target: BROWSER_TARGET,
    });
  }

  // Node entries are entries meant to be used in node-only
  // this is useful for presets, which are loaded by Storybook when setting up configurations
  // they won't have types generated for them as they're usually loaded automatically by Storybook
  if (nodeEntries.length) {
    configs.push({
      ...commonConfig,
      entry: nodeEntries,
      external: [...GLOBALS],
      format: ['cjs'],
      name: 'node',
      platform: 'node',
      target: NODE_TARGET,
    });
  }

  return configs;
});
