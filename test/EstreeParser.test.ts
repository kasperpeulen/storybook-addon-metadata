import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadStoryFile, needsEstree } from './csfTools';
import { storyFiles } from './fixtures';

// EstreeParser reads the ESTree nodes that only Storybook 11 hands out.
const parser = needsEstree
  ? ({} as typeof import('../src/vite/classes/EstreeParser'))
  : await import('../src/vite/classes/EstreeParser');

const extract = (code: string) => {
  const csf = loadStoryFile(code);
  const { args, componentName, importedAs } = new parser.EstreeParser(csf).extractStoryFileData();
  const stories = Object.fromEntries(Object.entries(args));
  return { componentName, importedAs, meta: args[parser.MetaSymbol], stories };
};

describe('EstreeParser', { skip: needsEstree }, () => {
  it('reads the args of the meta and of an inline story', () => {
    assert.deepEqual(extract(storyFiles.inlineStory), {
      componentName: 'Button',
      importedAs: 'Button',
      meta: {
        primary: { type: 'boolean', value: false },
        size: { type: 'string', value: 'medium' },
      },
      stories: {
        Primary: {
          count: { type: 'number', value: 2 },
          empty: { type: 'null', value: null },
          label: { type: 'string', value: 'Button' },
          primary: { type: 'boolean', value: true },
        },
      },
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

  it('gives a story that aliases another the args of that story', () => {
    const primary = { label: { type: 'string', value: 'Primary' } };
    assert.deepEqual(extract(storyFiles.aliasedStory).stories, {
      Again: primary,
      Copy: primary,
      Primary: primary,
    });
  });

  it('reads functions as their source', () => {
    const { meta, stories } = extract(storyFiles.functions);
    assert.deepEqual(meta, { onClick: { type: 'function', value: 'fn()' } });
    assert.deepEqual(stories, { Arrow: { onHover: { type: 'function', value: '() => 1' } } });
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

  it('takes the component name from the import that component refers to', () => {
    const { componentName, importedAs } = extract(storyFiles.aliasedComponent);
    assert.deepEqual({ componentName, importedAs }, { componentName: 'Button', importedAs: 'Btn' });
  });
});
