/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { readFile } from "node:fs/promises";
import { transformAsync } from "@babel/core";
import { build } from "esbuild";
import type { Plugin } from "esbuild";
import presetSolid from "babel-preset-solid";
import presetTypescript from "@babel/preset-typescript";

/**
 * Compiles a Solid JSX project module into a single-file ESM bundle for
 * `dapi mount` (see JSX_API.md). JSX compiles against the editor's universal
 * renderer runtime (`@diffusionstudio/jsx`); npm dependencies and local
 * imports are bundled; the host-provided modules are left external under the
 * "dapi-host:" prefix so the app can rewrite them to its own module instances.
 */

// Prefix shared with the app's module loader — a specifier no user code would
// contain by accident, so the app-side rewrite is unambiguous.
export const HOST_MODULE_PREFIX = "dapi-host:";

const HOST_MODULES_RE = /^(?:solid-js(?:\/store)?|@diffusionstudio\/jsx)$/;

async function transformSolidJsx(source: string, filename: string): Promise<string> {
  const result = await transformAsync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [
      [presetSolid, { generate: "universal", moduleName: "@diffusionstudio/jsx" }],
      [presetTypescript, {}],
    ],
    sourceMaps: "inline",
  });
  if (!result?.code) {
    throw new Error(`Failed to compile ${filename}`);
  }
  return result.code;
}

const solidUniversalPlugin: Plugin = {
  name: "solid-universal",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: HOST_MODULES_RE }, (args) => ({
      path: `${HOST_MODULE_PREFIX}${args.path}`,
      external: true,
    }));

    // esbuild strips types from .ts natively; only JSX files go through babel
    // so the Solid transform sees the untouched JSX.
    pluginBuild.onLoad({ filter: /\.[jt]sx$/ }, async (args) => ({
      contents: await transformSolidJsx(await readFile(args.path, "utf8"), args.path),
      loader: "js",
    }));
  },
};

export type CompileInput = { path: string } | { code: string };

// `--code` ergonomics: a bare JSX expression (no `export default`) is wrapped
// into a component module, so one-liners like `--code '<rect width={10} />'`
function wrapBareJsx(code: string): string {
  if (/\bexport\s+default\b/.test(code)) return code;
  return `export default () => (\n${code.trim().replace(/;+\s*$/, "")}\n);`;
}

export async function compileProject(input: CompileInput): Promise<string> {
  const common = {
    bundle: true as const,
    write: false as const,
    format: "esm" as const,
    platform: "browser" as const,
    target: "es2022",
    sourcemap: "inline" as const,
    logLevel: "silent" as const,
    plugins: [solidUniversalPlugin],
  };

  // Inline --code bypasses esbuild's loader pipeline (stdin skips onLoad), so
  // it is babel-transformed up front and fed in as plain JS.
  const result =
    "path" in input
      ? await build({ ...common, entryPoints: [input.path] })
      : await build({
          ...common,
          stdin: {
            contents: await transformSolidJsx(wrapBareJsx(input.code), "project.tsx"),
            loader: "js",
            resolveDir: process.cwd(),
            sourcefile: "project.tsx",
          },
        });

  const out = result.outputFiles?.[0];
  if (!out) throw new Error("Compilation produced no output");
  return out.text;
}
