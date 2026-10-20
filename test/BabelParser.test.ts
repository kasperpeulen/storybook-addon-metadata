import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadStoryFile, needsBabel } from './csfTools';
import { storyFiles } from './fixtures';

// BabelParser reads the Babel nodes that only Storybook 10 hands out.
const parser = needsBabel
  ? ({} as typeof import('../src/vite/classes/BabelParser'))
  : await import('../src/vite/classes/BabelParser');

const extract = (code: string) => {
  const csf = loadStoryFile(code);
  const { args, componentName, importedAs } = new parser.BabelParser(csf).extractStoryFileData();
  const stories = Object.fromEntries(Object.entries(args));
  return { componentName, importedAs, meta: args[parser.MetaSymbol], stories };
};

describe('BabelParser', { skip: needsBabel }, () => {
  it('reads the args of the meta, but not of an inline story', () => {
    assert.deepEqual(extract(storyFiles.inlineStory), {
      componentName: 'Button',
      importedAs: 'Button',
      meta: {
        primary: { type: 'boolean', value: false },
        size: { type: 'string', value: 'medium' },
      },
      stories: {},
    });
  });

  it('reads the args of a story exported by name, under its export name', () => {
    assert.deepEqual(extract(storyFiles.namedExport).stories, {
      Secondary: { label: { type: 'string', value: 'Secondary' } },
    });
    assert.deepEqual(extract(storyFiles.renamedExport).stories, {
      Renamed: { label: { type: 'string', value: 'Base' } },
    });
  });

  it('reads functions as a placeholder', () => {
    const { meta, stories } = extract(storyFiles.functions);
    assert.deepEqual(meta, { onClick: { type: 'function', value: '() => {}' } });
    assert.deepEqual(stories, { Arrow: { onHover: { type: 'function', value: '() => {}' } } });
  });

  it('reads a nested object as the JSON of its args', () => {
    assert.deepEqual(extract(storyFiles.nestedObject).stories, {
      Nested: {
        style: {
          type: 'object',
          value: JSON.stringify({
            color: { type: 'string', value: 'red' },
            size: { type: 'number', value: 2 },
          }),
        },
      },
    });
  });

  it('takes the component name from the last named import of its module', () => {
    const { componentName, importedAs } = extract(storyFiles.aliasedComponent);
    assert.deepEqual(
      { componentName, importedAs },
      { componentName: 'ButtonProps', importedAs: 'Btn' },
    );
  });
});
