import { staticKey, textOf, unwrapExpression } from 'storybook/internal/csf-tools';

import { FALLBACK } from '@/constants';

import type { ArgRecord, ArgValue } from '@/types';
import type { IndexedCSFFile } from 'storybook/internal/types';
import type { CsfFile, CsfObject, CsfValue, ESTreeNode } from 'storybook/internal/csf-tools';

/** Stored key for the main property we're looking for. */
const ARGS_KEY = 'args';
/** Symbol to store meta args against in case a story shares the name we choose. */
const MetaSymbol = Symbol('storyMeta');

/** Type alias for the args object. */
type StoryFileArgs = Record<string, ArgRecord> & {
  /** Args recorded in the `meta`. */
  [MetaSymbol]: ArgRecord;
};

/**
 * Converts the plain values of an object into an {@link ArgRecord}.
 * @param record The object read with `CsfObject#getValue`.
 * @returns The {@link ArgRecord} for the object.
 */
const fromRecord = (record: { readonly [key: string]: CsfValue }): ArgRecord => {
  const args: ArgRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      args[key] = fromValue(value);
    }
  }
  return args;
};

/**
 * Converts a plain value into an {@link ArgValue}.
 * @param value The value read with `CsfObject#getValue`.
 * @returns The {@link ArgValue} for the value.
 */
const fromValue = (value: Exclude<CsfValue, undefined>): ArgValue => {
  if (value === null) {
    return { type: 'null', value: null };
  } else if (Array.isArray(value)) {
    return { type: 'array', value: JSON.stringify(value) };
  } else if (typeof value === 'object') {
    // `Array.isArray` does not narrow out readonly arrays
    const record = value as { readonly [key: string]: CsfValue };
    return { type: 'object', value: JSON.stringify(fromRecord(record)) };
  } else if (typeof value === 'string') {
    return { type: 'string', value };
  } else if (typeof value === 'number') {
    return { type: 'number', value };
  }
  return { type: 'boolean', value };
};

/**
 * Describes an expression that has no static value, such as a function, JSX
 * or a reference to an import, by its type and source text.
 * @param node The expression to describe.
 * @returns The {@link ArgValue} for the expression.
 */
const fromExpression = (node: ESTreeNode): ArgValue => {
  const value = textOf(node);
  const inner = unwrapExpression(node);
  switch (inner.type) {
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return { type: 'function', value };
    case 'CallExpression': {
      // `fn()` is a placeholder function
      const { callee } = inner;
      const isFn = callee.type === 'Identifier' && callee.name === 'fn';
      return { type: isFn ? 'function' : 'unknown', value };
    }
    case 'JSXElement':
    case 'JSXFragment':
      return { type: 'jsx', value };
    case 'Identifier':
    case 'MemberExpression':
      return { type: 'reference', value };
    case 'ArrayExpression':
      return { type: 'array', value };
    case 'ObjectExpression':
      return { type: 'object', value };
    case 'Literal':
      if (typeof inner.value === 'string' || typeof inner.value === 'number') {
        return { type: typeof inner.value === 'string' ? 'string' : 'number', value: inner.value };
      } else if (typeof inner.value === 'boolean') {
        return { type: 'boolean', value: inner.value };
      } else if (inner.raw === 'null') {
        return { type: 'null', value: null };
      }
      return { type: 'unknown', value };
    default:
      return { type: 'unknown', value };
  }
};

/**
 * Checks whether an expression is `undefined`, which `getValue` cannot tell
 * apart from a value it cannot read.
 * @param node The expression to check.
 * @returns A boolean indicating whether the expression is `undefined`.
 */
const isUndefined = (node: ESTreeNode): boolean => {
  const inner = unwrapExpression(node);
  return inner.type === 'Identifier' && inner.name === 'undefined';
};

/**
 * Reads the `args` of a meta or story.
 * @param object The {@link CsfObject} for the meta or story.
 * @returns The {@link ArgRecord} of its args.
 */
const readArgs = (object: CsfObject): ArgRecord => {
  const value = object.getValue([ARGS_KEY]);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return fromRecord(value as { readonly [key: string]: CsfValue });
  }

  // Some args have no static value: read each of them on its own.
  const expression = object.get([ARGS_KEY]);
  const node = expression && unwrapExpression(expression);
  if (node?.type === 'Identifier' || node?.type === 'MemberExpression') {
    return { [FALLBACK.ARG]: fromExpression(node) };
  } else if (node?.type !== 'ObjectExpression') {
    return {};
  }

  const args: ArgRecord = {};
  for (const property of node.properties) {
    // Spreads and computed keys are skipped
    const key = staticKey(property);
    if (property.type !== 'Property' || key === undefined) continue;

    if (property.method || property.kind !== 'init') {
      args[key] = { type: 'function', value: textOf(property) };
      continue;
    }

    // An `undefined` arg is skipped, as `fromRecord` skips it
    const argValue = object.getValue([ARGS_KEY, key]);
    if (argValue !== undefined) {
      args[key] = fromValue(argValue);
    } else if (!isUndefined(property.value)) {
      args[key] = fromExpression(property.value);
    }
  }
  return args;
};

/**
 * Parser for extracting args and component data from a story file through
 * Storybook's CSF reader.
 */
class CsfParser {
  /** The parsed story file from `readCsf`. */
  readonly #csf: CsfFile & IndexedCSFFile;

  //===================================
  //== Constructor
  //===================================
  public constructor(csf: CsfFile & IndexedCSFFile) {
    this.#csf = csf;
  }

  //===================================
  //== Private Methods
  //===================================
  /**
   * Extracts the component's original name and the local alias (if any).
   * `csf.imports` and `csf.meta.component` only give the module and the local
   * name, so the imported name comes from the import specifier Storybook
   * resolved for the meta's `component`.
   * @returns An object containing the original export name and the local alias.
   */
  #extractComponentName(): { alias: string | undefined; name: string } {
    const specifier = this.#csf._componentImportSpecifier;
    if (specifier?.type !== 'ImportSpecifier') {
      // A default import has no name
      return { alias: undefined, name: '' };
    }

    const { imported, local } = specifier;
    const name = imported.type === 'Identifier' ? imported.name : imported.value;
    return { alias: local.name === name ? undefined : local.name, name };
  }

  //===================================
  //== Public Methods
  //===================================
  /**
   * Extracts args and component data from a Story File's parsed CSF.
   * @returns An object containing the args for the meta and each story export,
   * the name of the component imported, and the alias it was imported as.
   */
  public extractStoryFileData(): {
    args: StoryFileArgs;
    componentName: string;
    importedAs: string;
  } {
    const args: StoryFileArgs = { [MetaSymbol]: {} };
    for (const object of this.#csf.objects()) {
      const { target } = object;
      if (target.kind === 'meta') {
        args[MetaSymbol] = readArgs(object);
      } else if (target.kind === 'story') {
        args[target.exportName] = readArgs(object);
      }
    }

    const { alias, name } = this.#extractComponentName();

    return { args, componentName: name, importedAs: alias ?? name };
  }
}

export { CsfParser, MetaSymbol };
