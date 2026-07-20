/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { transformAsync } from "@babel/core";
import { build } from "esbuild";
import type { Plugin } from "esbuild";
import presetSolid from "babel-preset-solid";
import presetTypescript from "@babel/preset-typescript";

/**
 * Compiles a Solid JSX project module into a single-file ESM bundle for `dapi mount`.
 *
 * Import resolution splits modules into two worlds:
 *   - Host modules the app must provide as its own instance (the shared Solid
 *     reactive runtime and the JSX runtime) are left external under the
 *     "dapi-host:" prefix and shimmed to the app's namespaces at load time.
 *   - Everything else is userland: bare specifiers (three, gsap, ...) are left
 *     external and rewritten to a CDN URL, so authors never install anything and
 *     any npm package works without us hardcoding a dependency list. An optional
 *     `dapi.config.json` import map pins versions or redirects to a mirror.
 */

// Prefix shared with the app's module loader — a specifier no user code would
// contain by accident, so the app-side rewrite is unambiguous.
export const HOST_MODULE_PREFIX = "dapi-host:";

// Modules that must be the app's own instance (a second copy of the Solid
// runtime would not share the reactive graph). These are never userland.
const HOST_MODULES_RE = /^(?:solid-js(?:\/store)?|@diffusionstudio\/jsx)$/;

// Userland bare imports resolve here at runtime unless the import map overrides
// them; the renderer imports the URL natively (a blob module can import
// absolute URLs). esm.sh resolves each package's own transitive deps.
const DEFAULT_CDN_BASE = "https://esm.sh";

type ResolverConfig = { cdnBase: string; importMap: Record<string, string> };

/**
 * Config hook. `dapi.config.json` in the cwd may set `cdnBase` and `imports`
 * (exact keys like "three" or trailing-slash prefixes like "three/"); env vars
 * override for one-offs. Malformed config is ignored in favour of the defaults.
 */
function loadResolverConfig(): ResolverConfig {
  let cdnBase = process.env.DAPI_CDN_BASE || DEFAULT_CDN_BASE;
  let importMap: Record<string, string> = {};

  const configPath = resolve(process.cwd(), "dapi.config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8")) as {
        cdnBase?: string;
        imports?: Record<string, string>;
      };
      if (cfg.cdnBase) cdnBase = cfg.cdnBase;
      if (cfg.imports) importMap = cfg.imports;
    } catch {
      // Ignore a malformed config; fall back to defaults.
    }
  }

  if (process.env.DAPI_IMPORT_MAP) {
    try {
      importMap = { ...importMap, ...(JSON.parse(process.env.DAPI_IMPORT_MAP) as Record<string, string>) };
    } catch {
      // Ignore malformed env override.
    }
  }

  return { cdnBase: cdnBase.replace(/\/+$/, ""), importMap };
}

/**
 * Maps a bare specifier to a URL: an exact import-map hit wins, then the longest
 * matching trailing-slash prefix, then the CDN default.
 */
function resolveBareSpecifier(spec: string, { cdnBase, importMap }: ResolverConfig): string {
  const exact = importMap[spec];
  if (exact) return exact;

  let prefix: string | undefined;
  for (const key of Object.keys(importMap)) {
    if (key.endsWith("/") && spec.startsWith(key) && (prefix === undefined || key.length > prefix.length)) {
      prefix = key;
    }
  }
  if (prefix !== undefined) return importMap[prefix] + spec.slice(prefix.length);

  return `${cdnBase}/${spec}`;
}

// Identifiers babel auto-imports from `moduleName` when used as JSX tags
// without an in-scope binding: Solid's control-flow defaults plus the
// PascalCase composition elements, so project files need no imports for tags.
// Element names must match the components in packages/jsx/src/elements.ts.
const BUILT_INS = [
  "For", "Show", "Switch", "Match", "Suspense", "SuspenseList", "Portal", "Index", "Dynamic", "ErrorBoundary",
  "Scene", "Group", "Rect", "Video", "Image", "Audio", "Text", "Sequence", "Captions",
  "SolidPaint", "LinearGradientPaint", "RadialGradientPaint", "ColorStop",
  "HtmlPaint", "Html", "SurfacePaint", "Surface",
];

async function transformSolidJsx(source: string, filename: string): Promise<string> {
  const result = await transformAsync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [
      [presetSolid, { generate: "universal", moduleName: "@diffusionstudio/jsx", builtIns: BUILT_INS }],
      [presetTypescript, {}],
    ],
    sourceMaps: "inline",
  });
  if (!result?.code) {
    throw new Error(`Failed to compile ${filename}`);
  }
  return result.code;
}

function resolverPlugin(config: ResolverConfig): Plugin {
  return {
    name: "dapi-resolver",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, (args) => {
        const spec = args.path;

        // Let esbuild resolve the entry file itself on disk.
        if (args.kind === "entry-point") return null;

        // App-provided singletons: externalized and shimmed at load time.
        if (HOST_MODULES_RE.test(spec)) {
          return { path: `${HOST_MODULE_PREFIX}${spec}`, external: true };
        }

        // Explicit URL imports pass through to the renderer untouched.
        if (/^https?:\/\//.test(spec)) return { external: true };

        // Relative or absolute-path imports resolve on disk as usual (multi-file
        // samples, local helpers).
        if (spec.startsWith(".") || isAbsolute(spec)) return null;

        // Anything else is a userland bare specifier -> CDN / import map.
        return { path: resolveBareSpecifier(spec, config), external: true };
      });

      // esbuild strips types from .ts natively; only JSX files go through babel
      // so the Solid transform sees the untouched JSX.
      pluginBuild.onLoad({ filter: /\.[jt]sx$/ }, async (args) => ({
        contents: await transformSolidJsx(await readFile(args.path, "utf8"), args.path),
        loader: "js",
      }));
    },
  };
}

export type CompileInput = { path: string } | { code: string };

// `--code` ergonomics: a bare JSX expression (no `export default`) is wrapped
// into a component module, so one-liners like `--code '<Rect width={10} />'`
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
    plugins: [resolverPlugin(loadResolverConfig())],
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
