import {
  isArrayExpression,
  isArrowFunctionExpression,
  isBigIntLiteral,
  isBooleanLiteral,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isImportDefaultSpecifier,
  isImportSpecifier,
  isJSXElement,
  isJSXFragment,
  isLogicalExpression,
  isMemberExpression,
  isNullLiteral,
  isNumericLiteral,
  isObjectExpression,
  isObjectMethod,
  isObjectProperty,
  isRegExpLiteral,
  isSpreadElement,
  isStringLiteral,
  isTemplateLiteral,
  isTSAsExpression,
  isTSNonNullExpression,
} from '@babel/types';

import { DEVELOPMENT_MODE } from '@/config';
import { DEFAULTS, FALLBACK } from '@/constants';
import { logger } from '@/utils';

import type { ArgRecord, ArgValue } from '@/types';
import type {
  ExportNamedDeclaration,
  Expression,
  Node,
  ObjectProperty,
  PrivateName,
  SpreadElement,
  V8IntrinsicIdentifier,
} from '@babel/types';
import type { IndexedCSFFile } from 'storybook/internal/types';
import type { CsfFile } from 'storybook/internal/csf-tools';
import type { Primitive } from 'type-fest';

/** Stored key for the main property we're looking for. */
const ARGS_KEY = 'args';
/** Symbol to store meta args against in case a story shares the name we choose. */
const MetaSymbol = Symbol('storyMeta');
/** Development logger for recording uncovered usage. */
const uncovered = logger(DEVELOPMENT_MODE, 'babel-parser-uncovered');

/** Type alias for the args object. */
type StoryFileArgs = Record<string, ArgRecord> & {
  /** Args recorded in the `meta`. */
  [MetaSymbol]: ArgRecord;
};

/**
 * Babel AST parser for extracting data from AST nodes parsed by Storybook's
 * CSF reader.
 */
class BabelParser {
  /** The parsed story file from `readCsf`. */
  readonly #csf: CsfFile & IndexedCSFFile;
  /** The parsed args from stories and meta. */
  #args: StoryFileArgs;

  //===================================
  //== Constructor
  //===================================
  public constructor(csf: CsfFile & IndexedCSFFile) {
    this.#args = { [MetaSymbol]: {} };
    this.#csf = csf;
  }

  //===================================
  //== Private Static Methods
  //===================================
  /**
   * Resolves any references to other stories in an {@link ArgRecord} (such as
   * a spread of a previous story's args).
   * @param argRecord The {@link ArgRecord} to clean.
   * @param args The {@link StoryFileArgs} object containing all args.
   * @returns The cleaned ArgRecord.
   */
  static #cleanArgRecord(argRecord: ArgRecord, args: StoryFileArgs): ArgRecord {
    const cleaned: ArgRecord = {};

    for (const [key, value] of Object.entries(argRecord)) {
      if (BabelParser.#isArgValue(value)) {
        const cleanValue = BabelParser.#cleanArgValue(value, args);
        if (!BabelParser.#isArgValue(cleanValue)) {
          for (const [argKey, argValue] of Object.entries(cleanValue)) {
            cleaned[argKey] = argValue;
          }
        } else {
          cleaned[key] = cleanValue;
        }
      } else {
        cleaned[key] = BabelParser.#cleanArgRecord(value, args);
      }
    }

    return cleaned;
  }

  /**
   * Resolves any references to other stories in an {@link ArgValue} (such as
   * a spread of a previous story's args).
   * @param argValue The {@link ArgValue} to clean.
   * @param args The {@link StoryFileArgs} object containing all args.
   * @returns The cleaned ArgValue.
   */
  static #cleanArgValue(argValue: ArgValue, args: StoryFileArgs): ArgRecord | ArgValue {
    const { storyId, property } = BabelParser.#extractSpread(argValue) ?? {};

    if (property?.replace('?', '') === ARGS_KEY) {
      const storyArgs = BabelParser.#findArgStory(args, storyId?.replace('?', ''));

      if (storyArgs) {
        return storyArgs;
      }
    }

    return argValue;
  }

  // TODO: Combine/Use AstParser version?
  /**
   * Assembles an object access path into a single string.
   * @param left The left-hand string.
   * @param right The right-hand string.
   * @param isOptional The access is optional.
   * @returns A string with the composed access name separated with `'.'`/`'?.'`/
   */
  static #composeAccessName(
    left: string | undefined,
    right: string | undefined,
    isOptional: boolean = false,
  ): string | undefined {
    if (!left && !right) return undefined;
    const leftText = left ?? '';
    const rightText = right ?? '';
    const connector =
      left && isOptional ? DEFAULTS.OPTIONAL_CONNECTOR : left ? DEFAULTS.CONNECTOR : '';

    return `${leftText}${connector}${rightText}`.trim() || undefined;
  }

  // TODO:
  static #extractSpread(argValue: ArgValue): {
    storyId: string | undefined;
    property: string | undefined;
  } | null {
    const { spreadOf } = argValue;
    if (typeof spreadOf === 'string') {
      const [storyId, property] = spreadOf.split(DEFAULTS.CONNECTOR);
      return { storyId, property };
    } else if (typeof spreadOf?.value === 'string') {
      const [storyId, property] = spreadOf.value.split(DEFAULTS.CONNECTOR);
      return { storyId, property };
    } else if (spreadOf) {
      return BabelParser.#extractSpread(spreadOf);
    }
    return null;
  }

  /**
   * Finds the generated {@link ArgRecord} for the given `storyId`.
   * @param args The {@link StoryFileArgs} object containing the args for all stories.
   * @param storyId The ID of the story to extract.
   * @returns The {@link ArgRecord} for the story, or null if none can be found.
   */
  static #findArgStory(args: StoryFileArgs, storyId: string | undefined): ArgRecord | null {
    return storyId ? (args[storyId] ?? null) : null;
  }

  /**
   * Typeguard to check whether the `arg` is an {@link ArgValue}.
   * @param arg The {@link ArgRecord} or {@link ArgValue} to check.
   * @returns A boolean indicating whether the `arg` is an {@link ArgValue}.
   */
  static #isArgValue(arg: ArgRecord | ArgValue): arg is ArgValue {
    return (arg as ArgValue | undefined)?.type != null;
  }

  //===================================
  //== Private Methods
  //===================================
  /**
   * Extracts the values of an object and adds it to the `this.#args` object.
   * @param node The {@link Node} containing the story's args.
   * @param parent The name of the story that this belongs to.
   */
  #addStoryArgs(node: Node | undefined, parent: string | typeof MetaSymbol): void {
    const args = this.#extractArgsFromObjectExpression(node);

    if (args) {
      this.#args[parent] = {
        ...this.#args[parent],
        ...args,
      };
    }
  }

  /**
   * Resolves any referenced story args that are referenced in other stories.
   */
  #cleanArgs() {
    for (const value of Object.values(this.#args)) {
      BabelParser.#cleanArgRecord(value, this.#args);
    }
  }

  /**
   * Extracts the values of `args` from a story's AST.
   * @param stories The AST nodes for the story definitions.
   */
  #extractArgsFromStoryStatements(
    stories: Record<string, ExportNamedDeclaration | Expression>,
  ): void {
    for (const [storyName, node] of Object.entries(stories)) {
      // Find the 'args' property if it exists
      if (isObjectExpression(node)) {
        const { properties } = node;
        for (const property of properties) {
          // Args should be a property on the object
          if (isObjectProperty(property)) {
            const { key, value } = property;
            // The key should be a simple identifier
            if (isIdentifier(key) && key.name === ARGS_KEY) {
              this.#addStoryArgs(value, storyName);
            }
          }
        }
      }
    }
  }

  /**
   * Extracts the values of an object and adds it to the `this.#args` object.
   * @param node The {@link Node} containing the story's args.
   * @param parent The name of the story that this belongs to.
   */
  #extractArgsFromObjectExpression(
    node: Node | undefined,
    parent: string | undefined = FALLBACK.ARG,
  ): ArgRecord | null {
    if (!node) return null;
    let finalArgs: ArgRecord = {};

    // Need to cover:
    // TSNonNullExpression
    // MemberExpression
    // Identifier

    if (isObjectExpression(node)) {
      const { properties } = node;
      for (const property of properties) {
        if (isObjectMethod(property)) {
          const { key } = property;
          const keyName = this.#extractKeyValue(key);
          if (keyName) {
            finalArgs[keyName] = { type: 'function', value: '() => {}' };
          }
        } else if (isObjectProperty(property)) {
          const { key, value } = property;
          const keyName = this.#extractKeyValue(key);
          const propertyValue = this.#extractPropertyValue(value);
          if (propertyValue && keyName) {
            finalArgs[keyName] = propertyValue;
          }
        } else {
          // SpreadElement
          const { argument } = property;
          const argValue = this.#extractPropertyValue(argument, true);
          if (typeof argValue?.value === 'string') {
            const [story, prop] = argValue.value.split(DEFAULTS.CONNECTOR);
            if (typeof story === 'string' && typeof prop === 'string' && prop === ARGS_KEY) {
              // It's a spread of another story's args
              const existing = this.#args[story] ?? null;
              finalArgs = { ...finalArgs, ...existing };
            }
          }
        }
      }
    } else if (isTSNonNullExpression(node)) {
      // It's wrapped,
      const { expression } = node;
      return this.#extractArgsFromObjectExpression(expression);
    } else if (isMemberExpression(node) || isIdentifier(node)) {
      const value = this.#extractPropertyValue(node);
      if (value) {
        finalArgs[parent] = value;
      }
    } else {
      uncovered.verbose('extractArgsFromObjectExpression', node.type);
    }

    return { ...finalArgs };
  }

  /**
   * Extracts the component's original name (or 'default' for default exports),
   * and the local alias (if any) from the AST.
   * @returns An object containing the original export name and the local alias.
   */
  #extractComponentName(): { alias: string | undefined; name: string } {
    let alias: string | undefined = undefined;
    let name = '';

    const {
      _ast: {
        program: { body },
      },
      _rawComponentPath: expectedPath,
    } = this.#csf;

    for (const statement of body) {
      if (isImportDeclaration(statement)) {
        const { source, specifiers } = statement;
        if (source.value === expectedPath) {
          const imports: string[] = [];
          for (const specifier of specifiers) {
            if (isImportDefaultSpecifier(specifier)) {
              imports.push('default');
            } else if (isImportSpecifier(specifier)) {
              const { local, imported } = specifier;
              const localAlias = local.name;
              const importName = isIdentifier(imported) ? imported.name : imported.value;

              if (localAlias !== importName) {
                alias = localAlias;
              }
              name = importName;
            }
          }
        }
      }
    }

    return { alias, name };
  }

  /**
   * Extracts the string name of a key.
   * @param key The key to extract the name for.
   * @returns The resolved name of the key, or undefined if none can be extracted.
   */
  #extractKeyValue(key: Expression | PrivateName | V8IntrinsicIdentifier): string | undefined {
    // ArrayExpression | AssignmentExpression | BinaryExpression | CallExpression | ConditionalExpression | FunctionExpression | Identifier | StringLiteral | NumericLiteral | NullLiteral | BooleanLiteral | RegExpLiteral | LogicalExpression | MemberExpression | NewExpression | ObjectExpression | SequenceExpression | ParenthesizedExpression | ThisExpression | UnaryExpression | UpdateExpression | ArrowFunctionExpression | ClassExpression | ImportExpression | MetaProperty | Super | TaggedTemplateExpression | TemplateLiteral | YieldExpression | AwaitExpression | Import | BigIntLiteral | OptionalMemberExpression | OptionalCallExpression | TypeCastExpression | JSXElement | JSXFragment | BindExpression | DoExpression | RecordExpression | TupleExpression | DecimalLiteral | ModuleExpression | TopicReference | PipelineTopicExpression | PipelineBareFunction | PipelinePrimaryTopicReference | TSInstantiationExpression | TSAsExpression | TSSatisfiesExpression | TSTypeAssertion | TSNonNullExpression
    if (isIdentifier(key)) {
      return key.name;
    } else if (isMemberExpression(key)) {
      const { object, optional, property } = key;
      const objectValue = this.#extractKeyValue(object);
      const propertyValue = this.#extractKeyValue(property);
      return BabelParser.#composeAccessName(objectValue, propertyValue, optional ?? false);
    } else if (isStringLiteral(key)) {
      return key.value;
    } else {
      uncovered.verbose('extractKeyValue', key.type);
    }
    return undefined;
  }

  /**
   * Extracts the value of an object property.
   * @param value The value of an object property to extract.
   * @param isSpread Whether the parent element is a spread element.
   * @returns The extracted value, or nullif none can be extracted.
   */
  #extractPropertyValue(
    value: ObjectProperty['value'] | SpreadElement | null,
    isSpread: boolean = false,
  ): ArgValue | null {
    if (!value) return null;

    // TODO: Need to cover:
    // JSXFragment
    // Identifier
    // JSXElement
    // LogicalExpression ??

    if (isArrayExpression(value)) {
      const { elements } = value;
      const values: Primitive[] = [];
      for (const element of elements) {
        const elementValue = this.#extractPropertyValue(element);
        if (Array.isArray(elementValue?.value)) {
          values.push(...elementValue.value);
        } else if (elementValue?.value) {
          values.push(elementValue.value);
        }
      }
    } else if (isArrowFunctionExpression(value) || isFunctionExpression(value)) {
      return { type: 'function', value: '() => {}' };
    } else if (isBigIntLiteral(value)) {
      return { type: 'number', value: value.value };
    } else if (isBooleanLiteral(value)) {
      return { type: 'boolean', value: value.value };
    } else if (isNullLiteral(value)) {
      return { type: 'null', value: null };
    } else if (isNumericLiteral(value)) {
      return { type: 'number', value: value.value };
    } else if (isRegExpLiteral(value)) {
      return { type: 'string', value: value.pattern };
    } else if (isStringLiteral(value)) {
      return { type: 'string', value: value.value };
    } else if (isTemplateLiteral(value)) {
      return { type: 'string', value: value.quasis.map(quasi => quasi.value.raw).join(' ') };
    } else if (isCallExpression(value)) {
      const { callee } = value;
      const calleeName = this.#extractKeyValue(callee);
      if (calleeName === 'fn') {
        // It's a placeholder function
        return { type: 'function', value: '() => {}' };
      } else {
        // Without a large amount of work, we're not going to know what the function returns.
        // Just return unknown as we can only match against it having a value.
        return { type: 'unknown', value: value.toString() };
      }
    } else if (isMemberExpression(value)) {
      const accessorValue = this.#extractKeyValue(value);
      return isSpread && accessorValue
        ? {
            spreadOf: accessorValue,
            type: 'reference',
            value: '',
          }
        : { type: 'reference', value: accessorValue };
    } else if (isObjectExpression(value)) {
      const propertyData = this.#extractArgsFromObjectExpression(value);
      return { type: 'object', value: JSON.stringify(propertyData) };
    } else if (isJSXFragment(value) || isJSXElement(value)) {
      return { type: 'jsx', value: value.toString() };
    } else if (isIdentifier(value)) {
      // We don't have the data to extract the value type here (without a whole
      // host of additional babel parsing).
      // Record as a reference, and wait until we are parsing properly.
      const identifier = this.#extractKeyValue(value);
      return { type: 'reference', value: identifier };
    } else if (isLogicalExpression(value)) {
      // TODO:
    } else if (isTSAsExpression(value)) {
      // TODO:
    } else if (isSpreadElement(value)) {
      const { argument } = value;
      return {
        spreadOf: this.#extractPropertyValue(argument),
        type: 'reference',
        value: '',
      };
      // } else if (isTSNonNullExpression(value)) {
      //   // Extract the inner value instead.
      //   const { expression } = value;
      //   return this.#extractPropertyValue(expression);
    } else {
      uncovered.verbose('extractPropertyValue', value.type);
    }

    return null;
  }

  //===================================
  //== Public Methods
  //===================================
  /**
   * Extracts args and component data from a Story File's parsed CSF/AST.
   * @returns An object containing the args for all stories, the name of the
   * component imported, and the alias it was imported as.
   */
  public extractStoryFileData(): {
    args: StoryFileArgs;
    componentName: string;
    importedAs: string;
  } {
    const { _metaAnnotations: metaAnnotations, _storyStatements: stories } = this.#csf;

    const metaArgsNode = metaAnnotations[ARGS_KEY];
    this.#addStoryArgs(metaArgsNode, MetaSymbol);
    this.#extractArgsFromStoryStatements(stories);
    this.#cleanArgs();

    const { alias, name } = this.#extractComponentName();

    return { args: this.#args, componentName: name, importedAs: alias ?? name };
  }
}

export { BabelParser, MetaSymbol };
