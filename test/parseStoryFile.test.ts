import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { Typescript } from '../src/vite/classes';
import { parseStoryFile } from '../src/vite/storybook';

import type { StorybookConfig } from '@/types';

// Runs on every Storybook: parseStoryFile picks the parser for the installed one.
describe('parseStoryFile', () => {
  const root = mkdtempSync(join(tmpdir(), 'storybook-addon-metadata-'));
  after(() => rmSync(root, { force: true, recursive: true }));

  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }),
  );
  writeFileSync(join(root, 'Button.tsx'), 'export const Button = () => null;\n');
  writeFileSync(
    join(root, 'Button.stories.tsx'),
    `
      import { Button as Btn } from './Button';
      export default { title: 'Example/Button', component: Btn, args: { primary: false } };
      const Base = { args: { label: 'Base' } };
      export { Base as Renamed };
    `,
  );
  const storybookConfig = {
    storyTitleOptions: { configDir: join(root, '.storybook'), stories: ['../*.stories.tsx'] },
  } as unknown as StorybookConfig;
  const typescript = new Typescript({ baseUrl: root, debug: false });

  it('reads the component and the args of each story by its export name', async () => {
    const { componentAlias, componentName, componentPath, stories, title } = await parseStoryFile(
      'Button.stories.tsx',
      storybookConfig,
      root,
      typescript,
    );

    assert.equal(title, 'Example/Button');
    assert.equal(componentPath, join(root, 'Button.tsx'));
    assert.equal(componentName, 'Button');
    assert.equal(componentAlias, 'Btn');
    assert.deepEqual(
      stories.map(({ args, id }) => ({ args, id })),
      [
        {
          args: {
            label: { type: 'string', value: 'Base' },
            primary: { type: 'boolean', value: false },
          },
          id: 'example-button--renamed',
        },
      ],
    );
  });
});
