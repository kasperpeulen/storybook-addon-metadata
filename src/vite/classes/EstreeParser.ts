import { FALLBACK } from '@/constants';

import { staticKey, textOf, unwrapExpression } from './estreeCsfTools';

import type { CsfFile, CsfObject, CsfValue, ESTreeNode } from './estreeCsfTools';
import type { ArgRecord, ArgValue } from '@/types';
import type { IndexedCSFFile } from 'storybook/internal/types';

/** Stored key for the main property we're looking for. */
const ARGS_KEY = 'args';
/** Symbol to store meta args against in case a story shares the name we choose. */
const MetaSymbol = Symbol('storyMeta');

/** Type alias for the args object. */
type StoryFileArgs = Record<string, ArgRecord> & {
  /** Args recorded in the `meta`. */
  [MetaSymbol]: ArgRecord;
};

/** An object read with `CsfObject#getValue`. */
type CsfRecord = { readonly [key: string]: CsfValue };

/**
 * Typeguard to check whether a value read with `CsfObject#getValue` is an object.
 * @param value The value to check.
 * @returns A boolean indicating whether the value is a {@link CsfRecord}.
 */
const isRecord = (value: CsfValue): value is CsfRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Converts the plain values of an object into an {@link ArgRecord}.
 * @param record The object read with `CsfObject#getValue`.
 * @returns The {@link ArgRecord} for the object.
 */
const fromRecord = (record: CsfRecord): ArgRecord => {
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
  } else if (isRecord(value)) {
    return { type: 'object', value: JSON.stringify(fromRecord(value)) };
  } else if (typeof value === 'object') {
    return { type: 'array', value: JSON.stringify(value) };
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
      // BigInt and regex literals have no plain value
      return 'bigint' in inner || 'regex' in inner
        ? { type: 'unknown', value }
        : fromValue(inner.value);
    default:
      return { type: 'unknown', value };
  }
};

/**
 * Checks whether an expression can have a static value, so that reading it
 * with `getValue` does not record a diagnostic for a function, call, JSX,
 * BigInt or regex.
 * @param node The expression to check.
 * @returns A boolean indicating whether the expression can have a value.
 */
const canHaveValue = (node: ESTreeNode): boolean => {
  const inner = unwrapExpression(node);
  if (inner.type === 'Literal') {
    // BigInt and regex literals have no plain value
    return !('bigint' in inner) && !('regex' in inner);
  }
  return [
    'ArrayExpression',
    'Identifier',
    'ObjectExpression',
    'TemplateLiteral',
    'UnaryExpression',
  ].includes(inner.type);
};

/**
 * Reads the `args` of a meta or story. `inspect` reads without recording a
 * diagnostic; `getValue` is only used where a plain value can result.
 * @param object The {@link CsfObject} for the meta or story.
 * @returns The {@link ArgRecord} of its args.
 */
const readArgs = (object: CsfObject): ArgRecord => {
  const inspection = object.inspect([ARGS_KEY]);
  if (inspection.kind !== 'value') return {};

  const node = unwrapExpression(inspection.node);
  if (node.type === 'Identifier' || node.type === 'MemberExpression') {
    // A name can stand for a local constant
    const value = node.type === 'Identifier' ? object.getValue([ARGS_KEY]) : undefined;
    return isRecord(value) ? fromRecord(value) : { [FALLBACK.ARG]: fromExpression(node) };
  } else if (node.type !== 'ObjectExpression') {
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

    // `getValue` can't tell `undefined` apart from an unreadable value, and `fromRecord` skips it
    const { value: expression } = property;
    const inner = unwrapExpression(expression);
    if (inner.type === 'Identifier' && inner.name === 'undefined') continue;

    // A field that a spread may override is unreadable, so only its source is known
    const readable = object.inspect([ARGS_KEY, key]).kind === 'value';
    const value =
      readable && canHaveValue(expression) ? object.getValue([ARGS_KEY, key]) : undefined;
    args[key] = value === undefined ? fromExpression(expression) : fromValue(value);
  }
  return args;
};

/**
 * Parser for extracting args and component data from a story file through
 * the ESTree csf-tools of Storybook 11. `BabelParser` does the same on
 * Storybook 10.
 */
class EstreeParser {
  /** The parsed story file from `readCsf`. */
  readonly #csf: CsfFile & IndexedCSFFile;

  //===================================
  //== Constructor
  //===================================
  public constructor(csf: CsfFile & IndexedCSFFile) {
    this.#csf = csf;
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

    // A default import has no name
    const { componentImport } = this.#csf;
    const named = componentImport?.imported === 'default' ? undefined : componentImport;

    return { args, componentName: named?.imported ?? '', importedAs: named?.local ?? '' };
  }
}

export { EstreeParser, MetaSymbol };
