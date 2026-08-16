/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The two directions of a project's JSX, in one module.
//
// Reading: `sourcePlugin` stamps every composition element with where it came
// from, so the entity the renderer builds from it knows its own origin.
// Writing: `applyEdits` puts a value the editor arrived at back into the
// attribute that produced it, and `stampProject` gives elements the durable
// names that survive edits made to the file in between.
//
// Both directions number a file's JSX elements in document order, and an
// element is known by its position there until it has an `id`. If the two ever
// disagreed about the order, a drag would write to the wrong element — which
// is why they are here together and share one traversal (`eachElement`) over
// one parser, rather than agreeing by convention.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import Sqids from "sqids";

import { ID_ATTR, SOURCE_ATTR, formatSource, isCompositionTag, parseSource } from "@diffusionstudio/jsx";

import type { PropValue } from "@diffusionstudio/jsx";
import type { NodePath, PluginObj, TransformOptions, types as t } from "@babel/core";

export type { PropValue };

/** The parts of `@babel/core` this module needs; the caller owns loading it. */
export type SourceBabel = Pick<typeof import("@babel/core"), "parseSync" | "traverse">;

/** What babel hands a plugin factory. */
type BabelApi = { types: typeof import("@babel/core").types };

export interface SourceContext {
  babel: SourceBabel;
  /** Absolute path of the project folder. */
  dir: string;
  /** Called with the project-relative path of every file written. */
  onWrite?: (file: string) => void;
}

/** Overwrites props of the element named by `source` (a `SOURCE_ATTR` value). */
export interface SourceEdit {
  source: string;
  props: Record<string, PropValue>;
}

export interface WriteResult {
  /** Sources that could not be written, as `id` or `id (prop)`. */
  skipped: string[];
  /**
   * Elements that earned a name in this write, as `old source id -> new one`.
   * The canvas re-stamps its entities with these, so identity does not have to
   * wait for a recompile.
   */
  ids?: Record<string, string>;
  error?: string;
}

const SOURCE_FILE = /\.[jt]sx?$/;

const sqids = new Sqids({ minLength: 2 });

// ---------------------------------------------------------------------------
// The numbering

/**
 * Every JSX element a traversal reaches, in document order. Components and DOM
 * tags are counted but not stamped: a position means "the nth element in this
 * file", and skipping some would make that depend on which ones are
 * composition elements today.
 */
function eachElement(
  traverse: (visitor: { JSXElement(path: NodePath<t.JSXElement>): void }) => void,
  visit: (node: t.JSXElement, index: number) => void,
): void {
  let index = 0;
  traverse({
    JSXElement(path) {
      visit(path.node, index++);
    },
  });
}

/** The tag as written, or undefined for the member/namespaced forms no tag has. */
function tagName(node: t.JSXElement): string | undefined {
  const name = node.openingElement.name;
  return name.type === "JSXIdentifier" ? name.name : undefined;
}

function attributeOf(node: t.JSXElement, name: string): t.JSXAttribute | undefined {
  for (const attribute of node.openingElement.attributes) {
    if (attribute.type !== "JSXAttribute") continue;
    if (attribute.name.type === "JSXIdentifier" && attribute.name.name === name) return attribute;
  }
  return undefined;
}

function idOf(node: t.JSXElement): string | undefined {
  const value = attributeOf(node, ID_ATTR)?.value;
  return value?.type === "StringLiteral" ? value.value : undefined;
}

// ---------------------------------------------------------------------------
// Reading: the compile-time stamp

/**
 * Stamps every composition element with the location of its JSX source, so
 * entities on the canvas can be traced back to the code that produced them.
 * An element that names itself with `id` keeps that name; the position is the
 * fallback for elements nothing has had to write to yet. The id is removed on
 * the way through, so it never reaches a host as a prop.
 */
export function sourcePlugin({ types }: BabelApi, { file }: { file: string }): PluginObj {
  return {
    name: "jsx-source-location",
    visitor: {
      // Stamped up front: Solid's transform replaces whole JSX trees, so by the
      // time a nested element would be visited normally it no longer exists.
      Program(program) {
        eachElement(
          (visitor) => program.traverse(visitor),
          (node, index) => {
            const tag = tagName(node);
            if (tag === undefined || !isCompositionTag(tag)) return;

            const id = idOf(node);
            const opening = node.openingElement;
            opening.attributes = opening.attributes.filter(
              (attribute) =>
                !(
                  attribute.type === "JSXAttribute" &&
                  attribute.name.type === "JSXIdentifier" &&
                  attribute.name.name === ID_ATTR
                ),
            );
            opening.attributes.push(
              types.jsxAttribute(
                types.jsxIdentifier(SOURCE_ATTR),
                types.stringLiteral(formatSource(file, id ?? index)),
              ),
            );
          },
        );
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Writing: values back into attributes

const round = (value: number): number => Math.round(value * 100) / 100;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A prop value as the JavaScript that would have produced it. */
function literalText(value: PropValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(round(value));
  if (typeof value === "boolean" || value === null) return String(value);
  if (Array.isArray(value)) return `[${value.map(literalText).join(", ")}]`;

  const entries = Object.entries(value).map(
    ([key, nested]) => `${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${literalText(nested)}`,
  );
  return entries.length ? `{ ${entries.join(", ")} }` : "{}";
}

/** A prop value as it appears after `=` in a JSX attribute. */
export function initializerText(value: PropValue): string {
  return typeof value === "string" ? JSON.stringify(value) : `{${literalText(value)}}`;
}

/** `muted`, not `muted={true}` — an attribute as one would write it. */
function attributeText(name: string, value: PropValue): string {
  if (typeof value === "boolean") return value ? name : `${name}={false}`;
  return `${name}=${initializerText(value)}`;
}

/** Whether an expression is a value rather than a way of computing one. */
function isLiteral(node: t.Node): boolean {
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
      return true;
    case "UnaryExpression":
      return (node.operator === "-" || node.operator === "+") && isLiteral(node.argument);
    case "ArrayExpression":
      return node.elements.every((element) => element !== null && isLiteral(element));
    case "ObjectExpression":
      return node.properties.every(
        (property) =>
          property.type === "ObjectProperty" && !property.computed && isLiteral(property.value),
      );
    default:
      return false;
  }
}

/**
 * A prop is only written back when the source holds a plain literal. Anything
 * else — a signal, a prop of the surrounding component, an expression — is
 * someone's reactivity, and a drag has no business overwriting it.
 */
function isWritable(attribute: t.JSXAttribute): boolean {
  const value = attribute.value;
  if (!value) return true;
  if (value.type === "StringLiteral") return true;
  if (value.type !== "JSXExpressionContainer") return false;
  return value.expression.type !== "JSXEmptyExpression" && isLiteral(value.expression);
}

// ---------------------------------------------------------------------------
// Files

/** Text edits over one file's source, applied together so ranges stay valid. */
class Splices {
  // Keyed by range, so writing the same attribute twice in one batch replaces
  // it once rather than splicing over a range that is no longer there.
  private readonly replacements = new Map<string, { start: number; end: number; text: string }>();
  private readonly insertions = new Map<number, string[]>();

  public replace(node: { start?: number | null; end?: number | null }, text: string): void {
    if (typeof node.start !== "number" || typeof node.end !== "number") return;
    this.replacements.set(`${node.start}:${node.end}`, { start: node.start, end: node.end, text });
  }

  /**
   * Adds an attribute to an element, after the ones it already has — where one
   * would have written it. That position is the end of an existing attribute
   * rather than the inside of one, so it never lands within a replacement; and
   * since edits apply back to front, an insertion sitting exactly on the end of
   * an attribute being replaced still ends up after it.
   */
  public addAttribute(node: t.JSXElement, text: string): void {
    const attributes = node.openingElement.attributes;
    const at = attributes[attributes.length - 1]?.end ?? node.openingElement.name.end;
    if (typeof at !== "number") return;
    this.insertions.set(at, [...(this.insertions.get(at) ?? []), text]);
  }

  public get empty(): boolean {
    return !this.replacements.size && !this.insertions.size;
  }

  /** Applies back to front, so earlier offsets are still the ones parsed. */
  public apply(source: string): string {
    const all = [
      ...this.replacements.values(),
      ...[...this.insertions].map(([at, texts]) => ({
        start: at,
        end: at,
        text: texts.map((text) => ` ${text}`).join(""),
      })),
    ].sort((a, b) => b.start - a.start);

    let text = source;
    for (const splice of all) {
      text = text.slice(0, splice.start) + splice.text + text.slice(splice.end);
    }
    return text;
  }
}

/** One file, parsed, with its elements in the order both directions number them. */
interface ParsedFile {
  source: string;
  elements: t.JSXElement[];
}

const absolute = (dir: string, file: string): string => join(dir, ...file.split("/"));

async function parseFile(context: SourceContext, file: string): Promise<ParsedFile | undefined> {
  let source: string;
  try {
    source = await readFile(absolute(context.dir, file), "utf8");
  } catch {
    return undefined;
  }

  const options: TransformOptions = {
    filename: absolute(context.dir, file),
    babelrc: false,
    configFile: false,
    sourceType: "module",
    // JSX everywhere but in `.ts`, where `<T>value` is a type assertion
    // instead — the same reading babel's TypeScript preset picks by extension.
    parserOpts: { plugins: file.endsWith(".ts") ? ["typescript"] : ["jsx", "typescript"] },
  };

  let ast: ReturnType<SourceBabel["parseSync"]>;
  try {
    ast = context.babel.parseSync(source, options);
  } catch {
    // A file mid-edit does not parse; the next change brings another chance.
    return undefined;
  }
  if (!ast) return undefined;

  const elements: t.JSXElement[] = [];
  eachElement(
    (visitor) => context.babel.traverse(ast as t.Node, visitor),
    (node) => elements.push(node),
  );
  return { source, elements };
}

async function save(context: SourceContext, file: string, text: string): Promise<void> {
  // Claimed before the write lands: a watcher must never see this change
  // arrive without knowing whose it was.
  context.onWrite?.(file);
  await writeFile(absolute(context.dir, file), text, "utf8");
}

/**
 * Ids live in text, which can be copied, so two elements can end up claiming
 * one. An ambiguous id resolves to nothing and the write is reported instead.
 */
function findElement(elements: t.JSXElement[], locator: number | string): t.JSXElement | undefined {
  if (typeof locator === "number") return elements[locator];
  const matches = elements.filter((element) => idOf(element) === locator);
  return matches.length === 1 ? matches[0] : undefined;
}

function counterOf(id: string): number {
  const decoded = sqids.decode(id);
  return decoded.length === 1 && Number.isInteger(decoded[0]) ? decoded[0]! : 0;
}

function idAllocator(taken: Set<string>): () => string {
  let counter = 0;

  for (const id of taken) {
    counter = Math.max(counter, counterOf(id));
  }

  return () => {
    while (true) {
      const id = sqids.encode([++counter]);
      if (taken.has(id)) continue;
      taken.add(id);
      return id;
    }
  };
}

const idsIn = (elements: t.JSXElement[]): Set<string> =>
  new Set(elements.flatMap((element) => idOf(element) ?? []));

// ---------------------------------------------------------------------------
// Naming

/** Every project source file, project-relative and `/`-separated. */
async function sourceFiles(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(prefix ? join(dir, ...prefix.split("/")) : dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await sourceFiles(dir, path)));
    else if (SOURCE_FILE.test(entry.name)) files.push(path);
  }
  return files;
}

/**
 * Names every composition element in a file, so identity does not have to be
 * earned one write at a time: without an id, an element is only a position,
 * and any edit that adds an element above it moves it. Idempotent — a file
 * where nothing is missing an id is not written to, which is what makes this
 * safe to run before every compile.
 */
async function stampFile(context: SourceContext, file: string): Promise<void> {
  const parsed = await parseFile(context, file);
  if (!parsed) return;

  const nextId = idAllocator(idsIn(parsed.elements));
  const splices = new Splices();

  for (const element of parsed.elements) {
    const tag = tagName(element);
    if (tag === undefined || !isCompositionTag(tag) || idOf(element)) continue;

    splices.addAttribute(element, `${ID_ATTR}="${nextId()}"`);
  }

  if (splices.empty) return;
  await save(context, file, splices.apply(parsed.source));
}

/** Stamps every source file of the project. Writes nothing to a fully named project. */
export async function stampProject(context: SourceContext): Promise<void> {
  for (const file of await sourceFiles(context.dir)) {
    await stampFile(context, file);
  }
}

// ---------------------------------------------------------------------------
// Prop writes

/**
 * Writes prop values back into the JSX that produced them. Props whose source
 * is an expression rather than a literal are reported as skipped and left
 * alone; an element that is written to and has no id gets one, so that the
 * next edit to renumber the file cannot strand it.
 */
export async function applyEdits(context: SourceContext, edits: SourceEdit[]): Promise<WriteResult> {
  const skipped: string[] = [];
  const ids: Record<string, string> = {};

  // Grouped by file: one parse and one write per file, however many elements
  // of it an edit touched.
  const byFile = new Map<string, { locator: number | string; edit: SourceEdit }[]>();
  for (const edit of edits) {
    const location = parseSource(edit.source);
    if (!location) {
      skipped.push(edit.source);
      continue;
    }
    byFile.set(location.file, [
      ...(byFile.get(location.file) ?? []),
      { locator: location.locator, edit },
    ]);
  }

  for (const [file, entries] of byFile) {
    const parsed = await parseFile(context, file);
    if (!parsed) {
      skipped.push(...entries.map((entry) => entry.edit.source));
      continue;
    }

    const nextId = idAllocator(idsIn(parsed.elements));
    const splices = new Splices();

    for (const { locator, edit } of entries) {
      const element = findElement(parsed.elements, locator);
      if (!element) {
        skipped.push(edit.source);
        continue;
      }

      let wrote = false;
      for (const [name, value] of Object.entries(edit.props)) {
        const attribute = attributeOf(element, name);
        if (attribute && !isWritable(attribute)) {
          skipped.push(`${edit.source} (${name})`);
          continue;
        }

        if (attribute) splices.replace(attribute, attributeText(name, value));
        else splices.addAttribute(element, attributeText(name, value));
        wrote = true;
      }

      // Named only once something was written: failing to write to an element
      // is no reason to touch the file.
      if (!wrote || idOf(element)) continue;
      const id = nextId();
      splices.addAttribute(element, `${ID_ATTR}="${id}"`);
      ids[edit.source] = formatSource(file, id);
    }

    if (splices.empty) continue;
    await save(context, file, splices.apply(parsed.source));
  }

  return { skipped, ...(Object.keys(ids).length ? { ids } : {}) };
}
