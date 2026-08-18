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

import { ID_ATTR, LOOP_ATTR, SOURCE_ATTR, formatSource, isCompositionTag, isLoopTag } from "@diffusionstudio/jsx";

import type { PluginObj, types as t } from "@babel/core";

/** What babel hands a plugin factory. */
type BabelApi = { types: typeof import("@babel/core").types };

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
            if (name.type !== "JSXIdentifier" || !isCompositionTag(name.name)) return;

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
