/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, useContext } from "solid-js";
import { createRenderer } from "solid-js/universal";

import type { JSX } from "solid-js";
import type { ProjectDocument } from "./document";

// Compiled project modules call the static runtime exports below
// (babel-preset-solid in `universal` mode with a fixed moduleName), so the
// renderer must be a module-level singleton.
const DocumentContext = createContext<ProjectDocument | null>(null);

let currentDocument: ProjectDocument | null = null;

function doc(): ProjectDocument {
  const document = useContext(DocumentContext) ?? currentDocument;
  if (document === null) {
    throw new Error("No active mount — elements can only be created while a project renders");
  }
  return document;
}

const renderer = createRenderer<unknown>({
  createElement(tag: string): unknown {
    return doc().createElement(tag);
  },
  createTextNode(value: string): unknown {
    return doc().createTextNode(String(value));
  },
  replaceText(textNode: unknown, value: string): void {
    doc().replaceText(textNode, String(value));
  },
  isTextNode(node: unknown): boolean {
    return doc().isTextNode(node);
  },
  setProperty(node: unknown, name: string, value: unknown): void {
    doc().setProperty(node, name, value);
  },
  insertNode(parent: unknown, node: unknown, anchor?: unknown): void {
    doc().insertNode(parent, node, anchor);
  },
  removeNode(parent: unknown, node: unknown): void {
    doc().removeNode(parent, node);
  },
  getParentNode(node: unknown): unknown {
    return doc().getParentNode(node);
  },
  getFirstChild(node: unknown): unknown {
    return doc().getFirstChild(node);
  },
  getNextSibling(node: unknown): unknown {
    return doc().getNextSibling(node);
  },
});

export const {
  render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = renderer;

/**
 * Host entry point: renders a project component directly into `document`.
 * Mounting is synchronous — the document is fully written when this returns.
 */
export function renderProject<N>(project: () => unknown, document: ProjectDocument<N>): () => void {
  const previous = currentDocument;
  currentDocument = document as ProjectDocument;

  try {
    return render(
      () =>
        createComponent(DocumentContext.Provider, {
          value: document as ProjectDocument,
          get children() {
            return createComponent(project, {}) as JSX.Element;
          },
        }),
      document.stage,
    );
  } finally {
    currentDocument = previous;
  }
}
