# Distribution (macOS)

The desktop app ships as a signed, notarized macOS build with the `dapi` CLI bundled inside the app (no separate Node or CLI install). Auto-updates come from [update.electronjs.org](https://update.electronjs.org), which serves the ZIP asset of the latest published GitHub release.

## Releasing

There is one global version, shared by the root and all apps (web, desktop, cli); the workflow fails if any of them drift from the tag.

1. `npm run release <patch|minor|major|x.y.z>`: bumps every package.json to the same version, refreshes the lockfile, commits, and tags.
2. Push as printed by the script: `git push origin HEAD v0.130.0`.
3. The `Release` workflow builds, signs, notarizes, and uploads a **draft** GitHub release with two assets:
   - `Diffusion Studio-darwin-arm64-<version>.zip`: consumed by the auto-updater.
   - `Diffusion-Studio-arm64.dmg`: manual download and Homebrew.
4. Publish the draft release. Installed apps pick up the update on next launch (checked every 10 minutes while running).

Local equivalent without publishing: `npm run make --workspace=@diffusionstudio/desktop` (artifacts in `apps/desktop/out/make`). Set `SKIP_SIGN=1` to build without a signing identity.

## Required repository secrets

| Secret | Value |
|---|---|
| `MACOS_CERT_P12` | Developer ID Application certificate + key, exported as .p12, base64-encoded |
| `MACOS_CERT_PASSWORD` | Password of the .p12 export |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_PASSWORD` | App-specific password for that Apple ID (appleid.apple.com) |
| `APPLE_TEAM_ID` | Team id, e.g. `BYVQNNK2TH` |

## App icon

The current icon is a placeholder. To replace it: overwrite `apps/desktop/assets/icon.png` with a 1024x1024 PNG (transparent background, artwork on the macOS icon grid, i.e. a rounded square of ~824px centered), then run `npm run make:icns --workspace=@diffusionstudio/desktop` and commit both files. The build uses `assets/icon.icns` for the app bundle and the DMG volume.

## DMG window

The installer window uses a dark, on-brand background with a glowing arrow pointing from the app to the Applications folder. The source is `apps/desktop/assets/dmg-background.svg` (658x498, matching the DMG window size). To regenerate the raster assets after editing the SVG:

```sh
cd apps/desktop/assets
rsvg-convert -w 658 -h 498 dmg-background.svg -o dmg-background.png
rsvg-convert -w 1316 -h 996 dmg-background.svg -o dmg-background@2x.png
```

`electron-installer-dmg` picks up the `@2x` sibling automatically for retina. Icon positions and window size live in `forge.config.ts` (the `MakerDMG` `contents` / `additionalDMGOptions`); keep them in sync with the arrow placement if you move things.

## Bundled CLI

`dapi` lives at `Diffusion Studio.app/Contents/Resources/cli/bin/dapi`, a wrapper that runs the CLI bundle on the app's own Electron binary (`ELECTRON_RUN_AS_NODE`). Users get it on their PATH via:

- Homebrew: the cask's `binary` stanza links it automatically.
- Manual install: menu bar > Diffusion Studio > "Install dapi Command Line Tool" links it into `/usr/local/bin`.

## Homebrew cask

Lives in a tap repo (e.g. `diffusionstudio/homebrew-tap`, file `Casks/editor.rb`). Update `version` and `sha256` (`shasum -a 256 <dmg>`) per release, or wire up a bump automation later.

```ruby
cask "editor" do
  version "0.129.0"
  sha256 "REPLACE_WITH_DMG_SHA256"

  url "https://github.com/diffusionstudio/editor/releases/download/v#{version}/Diffusion-Studio-arm64.dmg"
  name "Diffusion Studio"
  desc "Agentic video editor"
  homepage "https://diffusion.studio"

  depends_on arch: :arm64
  depends_on macos: ">= :big_sur"
  auto_updates true

  app "Diffusion Studio.app"
  binary "#{appdir}/Diffusion Studio.app/Contents/Resources/cli/bin/dapi"

  zap trash: [
    "~/Library/Application Support/Diffusion Studio",
    "~/Library/Preferences/studio.diffusion.editor.plist",
    "~/Library/Saved Application State/studio.diffusion.editor.savedState",
  ]
end
```

Install: `brew install --cask diffusionstudio/tap/editor`.
