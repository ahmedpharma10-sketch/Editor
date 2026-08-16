/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The write direction of a project's JSX: `applyEdits` puts a value the editor
// arrived at back into the attribute that produced it, and `stampProject`
// gives elements the durable names that survive edits made to the file in
// between.
//
// Elements are addressed the way `./source` stamps them: by position in
// document order until they have an `id`. Both directions walk every JSX
// element a file has, so the nth tag here is the nth stamp there — one order,
// two parsers.
//
// ts-morph owns the parsing and the printing. It edits the syntax tree and
// re-prints only what changed, so a write touches the attribute it was asked
// to and leaves the rest of the file byte for byte as its author wrote it.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import Sqids from "sqids";
import { Project, SyntaxKind } from "ts-morph";

import { ID_ATTR, formatSource, isCompositionTag, parseSource } from "@diffusionstudio/jsx";

import type { PropValue } from "@diffusionstudio/jsx";
import type { JsxAttribute, JsxOpeningElement, JsxSelfClosingElement, Node, SourceFile } from "ts-morph";

export type { PropValue };

export interface SourceContext {
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

/** The opening half of a JSX element — where its attributes live. */
type JsxTag = JsxOpeningElement | JsxSelfClosingElement;

const SOURCE_FILE = /\.[jt]sx?$/;

const sqids = new Sqids({ minLength: 2 });

const absolute = (dir: string, file: string): string => join(dir, ...file.split("/"));

// ---------------------------------------------------------------------------
// The numbering

/**
 * Every JSX element in document order — the same sequence `./source` numbers,
 * so the nth entry here is the element the nth position refers to. Walked
 * rather than collected: `getDescendants` would wrap every token in the file
 * to find the handful that are elements.
 */
function tags(sourceFile: SourceFile): JsxTag[] {
  const found: JsxTag[] = [];
  sourceFile.forEachDescendant((node: Node) => {
    if (node.isKind(SyntaxKind.JsxSelfClosingElement)) found.push(node);
    else if (node.isKind(SyntaxKind.JsxElement)) found.push(node.getOpeningElement());
  });
  return found;
}

const tagName = (tag: JsxTag): string => tag.getTagNameNode().getText();

const attributeOf = (tag: JsxTag, name: string): JsxAttribute | undefined =>
  tag.getAttribute(name)?.asKind(SyntaxKind.JsxAttribute);

const idOf = (tag: JsxTag): string | undefined =>
  attributeOf(tag, ID_ATTR)?.getInitializer()?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();

/**
 * Ids live in text, which can be copied, so two elements can end up claiming
 * one. An ambiguous id resolves to nothing and the write is reported instead.
 */
function findTag(sourceFile: SourceFile, locator: number | string): JsxTag | undefined {
  const all = tags(sourceFile);
  if (typeof locator === "number") return all[locator];

  const matches = all.filter((tag) => idOf(tag) === locator);
  return matches.length === 1 ? matches[0] : undefined;
}

const idsIn = (sourceFile: SourceFile): Set<string> =>
  new Set(tags(sourceFile).flatMap((tag) => idOf(tag) ?? []));

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

// ---------------------------------------------------------------------------
// Values

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

/**
 * What a quoted JSX attribute cannot carry as itself: the quote that would end
 * it, the `&` that would start an entity, and the control characters that have
 * no spelling there — an attribute string is raw text, not JavaScript, so a
 * backslash escapes nothing.
 */
const UNQUOTABLE = /["&\p{Cc}\u2028\u2029]/u;

/**
 * A prop value as it appears after `=` in a JSX attribute. Strings are written
 * the way they are read — `fill="#ff0000"` — and fall back to an expression,
 * where JavaScript's escapes are available again, when they cannot be.
 */
const initializerText = (value: PropValue): string =>
  typeof value === "string" && !UNQUOTABLE.test(value)
    ? `"${value}"`
    : `{${literalText(value)}}`;

/** Writes a prop onto a tag as one would write it: `muted`, not `muted={true}`. */
function setProp(tag: JsxTag, name: string, value: PropValue): void {
  const attribute = attributeOf(tag, name);

  if (value === true) {
    if (attribute) attribute.removeInitializer();
    else tag.addAttribute({ name });
    return;
  }

  if (attribute) attribute.setInitializer(initializerText(value));
  else tag.addAttribute({ name, initializer: initializerText(value) });
}

/** Whether an expression is a value rather than a way of computing one. */
function isLiteral(node: Node): boolean {
  if (
    node.isKind(SyntaxKind.StringLiteral) ||
    node.isKind(SyntaxKind.NumericLiteral) ||
    node.isKind(SyntaxKind.TrueKeyword) ||
    node.isKind(SyntaxKind.FalseKeyword) ||
    node.isKind(SyntaxKind.NullKeyword)
  ) {
    return true;
  }

  if (node.isKind(SyntaxKind.PrefixUnaryExpression)) {
    const operator = node.getOperatorToken();
    const signed = operator === SyntaxKind.MinusToken || operator === SyntaxKind.PlusToken;
    return signed && isLiteral(node.getOperand());
  }

  if (node.isKind(SyntaxKind.ArrayLiteralExpression)) {
    return node.getElements().every(isLiteral);
  }

  if (node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return node.getProperties().every((property) => {
      const assignment = property.asKind(SyntaxKind.PropertyAssignment);
      if (!assignment || assignment.getNameNode().isKind(SyntaxKind.ComputedPropertyName)) return false;

      const initializer = assignment.getInitializer();
      return initializer !== undefined && isLiteral(initializer);
    });
  }

  return false;
}

/**
 * A prop is only written back when the source holds a plain literal. Anything
 * else — a signal, a prop of the surrounding component, an expression — is
 * someone's reactivity, and a drag has no business overwriting it.
 */
function isWritable(attribute: JsxAttribute): boolean {
  const initializer = attribute.getInitializer();
  if (!initializer) return true;
  if (initializer.isKind(SyntaxKind.StringLiteral)) return true;
  if (!initializer.isKind(SyntaxKind.JsxExpression)) return false;

  const expression = initializer.getExpression();
  return expression !== undefined && isLiteral(expression);
}

// ---------------------------------------------------------------------------
// Files

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

/** A file as it was read, alongside the tree edits are made against. */
interface OpenFile {
  sourceFile: SourceFile;
  text: string;
}

/** An edit resolved to the element it names within its file. */
interface FileEdit {
  locator: number | string;
  edit: SourceEdit;
}

/** What one file's edits came to. */
interface FileWrite {
  skipped: string[];
  ids: Record<string, string>;
}

/**
 * One write against a project's sources. ts-morph parses into a file system of
 * its own: bytes come off disk and go back to it here, and every file a write
 * touches is read once, edited in place, and saved at the end.
 *
 * One instance is one operation — construct it, run it, discard it. That is
 * what keeps a later write from editing a tree parsed before the project
 * changed underneath it.
 */
class SourceWriter {
  // Nothing here asks a question about types, so the standard library is never
  // loaded: parsing it costs more than everything else this class does.
  private readonly project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
  });
  private readonly files = new Map<string, OpenFile>();
  private readonly context: SourceContext;

  public constructor(context: SourceContext) {
    this.context = context;
  }

  /** Reads a file into the project, or does nothing if it cannot be read. */
  private async load(path: string): Promise<void> {
    if (this.files.has(path)) return;

    let text: string;
    try {
      text = await readFile(absolute(this.context.dir, path), "utf8");
    } catch {
      return;
    }

    // Created under the name it has in the project, so the extension still
    // decides the dialect: in `.ts`, `<T>value` is a type assertion rather
    // than an element.
    const sourceFile = this.project.createSourceFile(`/${path}`, text, { overwrite: true });
    this.files.set(path, { sourceFile, text });
  }

  /**
   * Drops every file the parser had to guess at, since re-printing one would
   * hand back source no one wrote — a file mid-edit is not a file to write to.
   *
   * Checked in one pass because ts-morph builds a program to answer for a
   * file, and that program is rebuilt every time another file arrives or one
   * is edited: asking per file would cost a program per file.
   */
  private dropUnparsed(paths: Iterable<string> = this.files.keys()): void {
    const program = this.project.getProgram();
    for (const path of [...paths]) {
      const open = this.files.get(path);
      if (!open) continue;
      if (program.getSyntacticDiagnostics(open.sourceFile).length) this.discard(path);
    }
  }

  /** Drops a file from the write set, leaving what is on disk untouched. */
  private discard(path: string): void {
    const open = this.files.get(path);
    if (!open) return;
    this.files.delete(path);
    this.project.removeSourceFile(open.sourceFile);
  }

  /** Writes back the files an edit actually changed, and only those. */
  private async save(): Promise<void> {
    for (const [path, open] of this.files) {
      const text = open.sourceFile.getFullText();
      if (text === open.text) continue;
      open.text = text;

      // Claimed before the write lands: a watcher must never see this change
      // arrive without knowing whose it was.
      this.context.onWrite?.(path);
      await writeFile(absolute(this.context.dir, path), text, "utf8");
    }
  }

  /**
   * Names every composition element in the project, so identity does not have
   * to be earned one write at a time: without an id, an element is only a
   * position, and any edit that adds an element above it moves it. Idempotent —
   * a project where nothing is missing an id is not written to, which is what
   * makes this safe to run before every compile.
   */
  public async stampProject(paths: string[]): Promise<void> {
    for (const path of paths) await this.load(path);
    this.dropUnparsed();

    for (const path of [...this.files.keys()]) this.stampFile(path);

    // Nothing ts-morph will not vouch for reaches the disk.
    this.dropUnparsed();
    await this.save();
  }

  private stampFile(path: string): void {
    const sourceFile = this.files.get(path)!.sourceFile;
    const nextId = idAllocator(idsIn(sourceFile));

    // Every id in one manipulation: each tag says where its own name goes —
    // after the attributes it already has — and the file is reparsed once
    // rather than once per element.
    const changes = tags(sourceFile).flatMap((tag) => {
      if (!isCompositionTag(tagName(tag)) || idOf(tag)) return [];

      const at = (tag.getAttributes().at(-1) ?? tag.getTagNameNode()).getEnd();
      return [{ span: { start: at, length: 0 }, newText: ` ${ID_ATTR}="${nextId()}"` }];
    });

    if (!changes.length) return;

    try {
      sourceFile.applyTextChanges(changes);
    } catch {
      this.discard(path);
    }
  }

  /**
   * Writes prop values back into the JSX that produced them. Props whose source
   * is an expression rather than a literal are reported as skipped and left
   * alone; an element that is written to and has no id gets one, so that the
   * next edit to renumber the file cannot strand it.
   */
  public async applyEdits(edits: SourceEdit[]): Promise<WriteResult> {
    const skipped: string[] = [];
    const ids: Record<string, string> = {};

    // Grouped by file: one parse and one write per file, however many elements
    // of it an edit touched.
    const byFile = new Map<string, FileEdit[]>();
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

    for (const file of byFile.keys()) await this.load(file);
    this.dropUnparsed(byFile.keys());

    for (const [file, entries] of byFile) {
      const sourceFile = this.files.get(file)?.sourceFile;
      const written = sourceFile ? this.editFile(file, sourceFile, entries) : undefined;

      // All or nothing per file: a file whose tree an edit left in a state
      // ts-morph will not vouch for is dropped rather than half written.
      if (!written) {
        this.discard(file);
        skipped.push(...entries.map((entry) => entry.edit.source));
        continue;
      }

      skipped.push(...written.skipped);
      Object.assign(ids, written.ids);
    }

    await this.save();
    return { skipped, ...(Object.keys(ids).length ? { ids } : {}) };
  }

  /**
   * One file's worth of edits, applied to the tree: the ids it handed out and
   * the sources it would not write, or undefined if the file is to be left
   * alone entirely.
   */
  private editFile(file: string, sourceFile: SourceFile, entries: FileEdit[]): FileWrite | undefined {
    const nextId = idAllocator(idsIn(sourceFile));
    const skipped: string[] = [];
    const ids: Record<string, string> = {};

    try {
      for (const { locator, edit } of entries) {
        let wrote = false;

        for (const [name, value] of Object.entries(edit.props)) {
          // Re-resolved per prop: editing one attribute forgets its siblings.
          const tag = findTag(sourceFile, locator);
          if (!tag) {
            skipped.push(edit.source);
            break;
          }

          const attribute = attributeOf(tag, name);
          if (attribute && !isWritable(attribute)) {
            skipped.push(`${edit.source} (${name})`);
            continue;
          }

          setProp(tag, name, value);
          wrote = true;
        }

        // Named only once something was written: failing to write to an
        // element is no reason to touch the file.
        const tag = wrote ? findTag(sourceFile, locator) : undefined;
        if (!tag || idOf(tag)) continue;

        const id = nextId();
        tag.addAttribute({ name: ID_ATTR, initializer: `"${id}"` });
        ids[edit.source] = formatSource(file, id);
      }
    } catch {
      return undefined;
    }

    // The tree an edit leaves behind answers for itself before it is printed.
    this.dropUnparsed([file]);
    return this.files.has(file) ? { skipped, ids } : undefined;
  }
}

/** Stamps every source file of the project. Writes nothing to a fully named project. */
export async function stampProject(context: SourceContext): Promise<void> {
  await new SourceWriter(context).stampProject(await sourceFiles(context.dir));
}

/** Writes values the editor arrived at back into the JSX that produced them. */
export function applyEdits(context: SourceContext, edits: SourceEdit[]): Promise<WriteResult> {
  return new SourceWriter(context).applyEdits(edits);
}
