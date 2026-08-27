/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The read direction of a project's JSX: a compile-time stamp recording where
// every composition element came from, so the entity the renderer builds from
// it knows its own origin.
//
// The numbering here and the one `./edit` walks with ts-morph must produce the
// same sequence — two parsers, two libraries, one order. If they ever
// disagreed, a drag would write to the wrong element; that invariant is why
// these two modules are read together.

import { COMPOSITION_TAGS, ID_ATTR, LOOP_ATTR, SOURCE_ATTR, formatSource, isCompositionTag, isLoopTag } from "@diffusionstudio/jsx";

import type { NodePath, PluginObj, types as t } from "@babel/core";

/** What babel hands a plugin factory. */
type BabelApi = { types: typeof import("@babel/core").types };

// Composition tags are authored in camelCase but must reach the renderer as
// PascalCase components. Lowercase is reserved at runtime for real DOM nodes
// inside <html>/<htmlPaint>.
const COMPOSITION_COMPONENTS = new Map<string, string>(
  COMPOSITION_TAGS.map((tag) => [tag, tag.charAt(0).toUpperCase() + tag.slice(1)]),
);

// These composition names also exist in SVG. An SVG fragment is DOM content
// only while it has an SVG container in the same JSX tree; elsewhere the tag
// keeps its composition meaning.
const AMBIGUOUS_SVG_TAGS: ReadonlySet<string> = new Set(["rect", "text", "image"]);
const SVG_CONTAINERS: ReadonlySet<string> = new Set([
  "svg", "g", "defs", "symbol", "marker", "mask", "clipPath", "pattern",
  "filter", "linearGradient", "radialGradient", "textPath", "tspan", "switch",
]);

const PASCAL_ELEMENTS = new Map(
  [...COMPOSITION_COMPONENTS].map(([camel, pascal]) => [pascal, camel]),
);

const SOLID_CONTROL_FLOW: ReadonlySet<string> = new Set([
  "For", "Show", "Switch", "Match", "Suspense", "SuspenseList", "Index", "ErrorBoundary",
]);

function hasSvgAncestor(path: NodePath<t.JSXElement>, types: typeof import("@babel/core").types): boolean {
  return path.findParent(
    (parent) => parent.isJSXElement()
      && types.isJSXIdentifier(parent.node.openingElement.name)
      && SVG_CONTAINERS.has(parent.node.openingElement.name.name),
  ) !== null;
}

function isSvgCollision(path: NodePath<t.JSXElement>, name: string, types: typeof import("@babel/core").types): boolean {
  return AMBIGUOUS_SVG_TAGS.has(name) && hasSvgAncestor(path, types);
}

/**
 * Rewrites authored composition intrinsics to aliased PascalCase imports
 * before babel-preset-solid consumes the JSX tree. Aliases prevent a user
 * binding named e.g. `Rect` from capturing an authored `<rect>`.
 */
export function canonicalizeTagsPlugin({ types }: BabelApi): PluginObj {
  return {
    name: "jsx-canonical-composition-tags",
    visitor: {
      // Babel merges plugin and preset visitors. Rewriting the complete tree
      // on Program enter ensures Solid cannot consume a parent before this
      // pass reaches its descendants.
      Program(program) {
        const aliases = new Map<string, string>();

        program.traverse({
          JSXElement(path) {
            const name = path.node.openingElement.name;
            if (!types.isJSXIdentifier(name)) return;

            if (/^[A-Z]/.test(name.name) && !path.scope.hasBinding(name.name)) {
              const camel = PASCAL_ELEMENTS.get(name.name);
              if (camel !== undefined) {
                throw path.buildCodeFrameError(
                  `<${name.name}> is not a tag; write the composition element as <${camel}>`,
                );
              }
              if (SOLID_CONTROL_FLOW.has(name.name)) {
                throw path.buildCodeFrameError(
                  `<${name.name}> needs an import: add \`import { ${name.name} } from "solid-js"\``,
                );
              }
              return;
            }

            const component = COMPOSITION_COMPONENTS.get(name.name);
            if (component === undefined || isSvgCollision(path, name.name, types)) return;

            let alias = aliases.get(component);
            if (alias === undefined) {
              alias = program.scope.generateUidIdentifier(component).name;
              aliases.set(component, alias);
            }

            path.node.openingElement.name = types.jsxIdentifier(alias);
            if (path.node.closingElement) {
              path.node.closingElement.name = types.jsxIdentifier(alias);
            }
          },
        });

        if (aliases.size === 0) return;
        const specifiers = [...aliases].map(([name, alias]) =>
          types.importSpecifier(types.identifier(alias), types.identifier(name)),
        );
        program.unshiftContainer(
          "body",
          types.importDeclaration(specifiers, types.stringLiteral("@diffusionstudio/jsx")),
        );
      },
    },
  };
}

const jsxTagName = (element: t.JSXElement): string | undefined => {
  const name = element.openingElement.name;
  return name.type === "JSXIdentifier" ? name.name : undefined;
};

/**
 * Stamps every composition element with the location of its JSX source, so
 * entities on the canvas can be traced back to the code that produced them.
 * An element in the body of a `<For>`/`<Index>` is also stamped with the
 * location of that loop (see LOOP_ATTR).
 */
export function sourcePlugin({ types }: BabelApi, { file }: { file: string }): PluginObj {
  return {
    name: "jsx-source-location",
    visitor: {
      // Stamped up front: Solid's transform replaces whole JSX trees, so by the
      // time a nested element would be visited normally it no longer exists.
      Program(program) {
        // Components and DOM tags are counted but not stamped: a position means
        // "the nth element in this file", and skipping some would make that
        // depend on which ones are composition elements today.
        let index = 0;
        // Loops are addressed by their position too, since nothing else names
        // them; visited before what they contain, so it is known by then.
        const positions = new WeakMap<t.JSXElement, number>();

        program.traverse({
          JSXElement(path) {
            const position = index++;
            positions.set(path.node, position);

            const opening = path.node.openingElement;
            const name = opening.name;
            if (
              name.type !== "JSXIdentifier"
              || !isCompositionTag(name.name)
              || isSvgCollision(path, name.name, types)
            ) return;

            const loop = path.findParent(
              (parent) => parent.isJSXElement() && isLoopTag(jsxTagName(parent.node) ?? ""),
            );
            const loopPosition = loop ? positions.get(loop.node as t.JSXElement) : undefined;

            // An element that names itself keeps that name; the position is the
            // fallback for elements nothing has had to write to yet. The id is
            // removed on the way through, so it never reaches a host as a prop.
            let locator: string | number = position;
            opening.attributes = opening.attributes.filter((attribute) => {
              if (
                attribute.type !== "JSXAttribute" ||
                attribute.name.type !== "JSXIdentifier" ||
                attribute.name.name !== ID_ATTR
              ) {
                return true;
              }
              if (attribute.value?.type === "StringLiteral") locator = attribute.value.value;
              return false;
            });

            opening.attributes.push(
              types.jsxAttribute(
                types.jsxIdentifier(SOURCE_ATTR),
                types.stringLiteral(formatSource(file, locator)),
              ),
            );

            if (loopPosition !== undefined) {
              opening.attributes.push(
                types.jsxAttribute(
                  types.jsxIdentifier(LOOP_ATTR),
                  types.stringLiteral(formatSource(file, loopPosition)),
                ),
              );
            }
          },
        });
      },
    },
  };
}
