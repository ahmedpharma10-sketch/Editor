# `dapi report <title>`

Reports a bug in `dapi` itself or in the app behind it: a command that errors, contradicts this reference, or returns something it shouldn't. Bundles the description with diagnostics (dapi version, platform, node version, the app's recent console output) into a markdown report on disk, and prints a prefilled GitHub issue URL for [diffusionstudio/editor](https://github.com/diffusionstudio/editor/issues).

Nothing is submitted. The command only writes a file and composes a link; a human reviews the report and opens the issue, either from the printed URL or by pasting the file. `--open` opens the prefilled page in the default browser.

This is for defects in the tooling, not for problems inside a project: a composition that looks wrong, a node in the wrong place, or a generation that missed the prompt are editing problems, fixed with `node patch` / `mount`, not reported here.

Does not require the app to be running. If the app is down or unreachable, the report records that instead of failing, since that is often the bug being reported.

## Arguments

- `<title>`: one-line summary of the problem, used as the issue title and in the report filename.

## Options

- `-b, --body <text>`: what happened, in markdown: what you expected, what you got, and anything the diagnostics won't show.
- `-c, --command <cmd...>`: the `dapi` command(s) that reproduce it, in order. Repeatable (`-c "dapi node ls 5" -c "dapi node capture 5"`); rendered as a shell block under `## Repro`.
- `--logs <n>`: trailing app log entries to attach (default: 50). `--logs 0` omits the section, and then the app is not contacted at all.
- `-o, --output <path>`: where to write the report. A directory when it exists as one or ends with a path separator (the file is named after the title); otherwise an exact file path. Default: the system temp directory.
- `--open`: open the prefilled GitHub issue page in the default browser.

## Output

One JSON object:

```ts
{
  path: string,       // absolute path of the markdown report
  url: string,        // prefilled github.com/diffusionstudio/editor/issues/new link
  truncated: boolean  // true when the body was too long for the URL and was cut short in the link only
}
```

The report on disk is always complete. Long reports exceed what a prefilled URL can carry, so the link's body is trimmed and ends with a pointer to `path`; `truncated` says when that happened.

## Report layout

````md
# <title>

<body>

## Repro

```sh
dapi node capture 42
```

## Environment

| | |
| --- | --- |
| dapi | 0.129.0 |
| platform | darwin 25.5.0 (arm64) |
| node | v20.19.0 |
| app | running |

## App logs

```
19:37:17.538 [info] Finalizing file  (…)
```
````

The `app` row reads `running`, `not running`, `not checked` (with `--logs 0`), or the reason it was unreachable.

## Notes

- Attached logs are the same entries [`logs`](./logs.md) prints, and can contain project names, file paths, and prompt text. They land in a local file, not on GitHub, until someone submits the report: review it before posting.
- Exits non-zero on an empty title, an invalid `--logs`, or an unwritable `--output`.
- `dapi issue` is an alias of this command.
