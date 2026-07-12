# obsidian-media-sidecar-tools

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

Create sidecar notes for media with Ctrl+Click, and hide the original media in file navigation if wanted.

Ctrl+Click an attachment to create a Markdown sidecar note for it. This
[Obsidian](https://obsidian.md) plugin then hides the attachment from the
file explorer, leaving only the note visible.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Thanks](#thanks)
- [Contributing](#contributing)
- [License](#license)

## Background

Media files like photos or recordings can't hold Obsidian properties, so
they're invisible to features like [Bases](https://help.obsidian.md/bases)
that read note metadata. Pairing a media file with a sidecar note gives it a
place for that metadata. It also fits how these attachments are actually
used — screenshots, recordings, and scans are rarely opened directly, since
they're viewed through the note that embeds them — so this plugin hides the
original from the file explorer once it has a note of its own.

## Install

### From the Community Plugins browser

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Search for `Media Sidecar Tools`.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` (if present) from the
   [latest release](https://github.com/turingexmachina/obsidian-media-sidecar-tools/releases).
2. Copy them into `<your-vault>/.obsidian/plugins/media-sidecar-tools/`.
3. Reload Obsidian and enable **Media Sidecar Tools** under
   **Settings → Community plugins**.

### From source

The Node.js version is pinned via [mise](https://mise.jdx.dev); run
`mise install` first if you have it, otherwise use the Node version in
[.mise.toml](.mise.toml) directly.

```sh
git clone https://github.com/turingexmachina/obsidian-media-sidecar-tools.git
cd obsidian-media-sidecar-tools
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `versions.json` into
`<your-vault>/.obsidian/plugins/media-sidecar-tools/`.

## Usage

Enable the plugin and it works immediately. Any attachment that has the same
name as a Markdown note in the same folder disappears from the navigation
pane automatically. Renaming, moving, creating, or deleting notes and
attachments updates the navigation instantly.

### Create a note with Ctrl+Click

Ctrl+Click (Cmd+Click on macOS) an attachment in the navigation pane to
create a Markdown sidecar note with the same name in the same folder,
embedding the attachment in it — for example, Ctrl+Clicking `Photo.jpg`
creates `Photo.md` with `![[Photo.jpg]]` inside. Once the note exists, this
plugin hides `Photo.jpg` from the navigation automatically. If a note with
that name already exists, Ctrl+Click does nothing. This behavior can be
turned off in [Settings](#settings).

## Settings

Open **Settings → Media Sidecar Tools** to configure:

- **Create note with Ctrl+Click** — enabled by default; disable it to turn
  off the [Ctrl+Click behavior](#create-a-note-with-ctrlclick) above.
- **File extensions** — the attachment extensions the plugin looks for,
  edited as a list separated by commas or new lines. Defaults to:
  - Images: `jpg`, `jpeg`, `png`, `webp`, `gif`, `avif`, `bmp`, `svg`
  - Audio: `mp3`, `wav`, `opus`, `aac`, `m4a`, `flac`
  - Video: `mp4`, `mkv`, `mov`, `avi`

## How it works

The plugin does no per-frame or per-render work. On load, after any file is
created, deleted, or renamed, and whenever the extension list changes, it
scans the vault's note and file lists (both cached by Obsidian) to find
attachments that match a note's name in the same folder, then writes a
single CSS rule targeting those files' `data-path` attributes in the
navigation pane. Rescans triggered by vault events are debounced so bulk
operations, like moving a folder, only trigger one update. Because hiding is
done with CSS rather than by walking the DOM tree, performance stays
constant regardless of vault size.

## Thanks

The sidecar note concept was inspired by
[obsidian-media-companion](https://github.com/nick-de-bruin/obsidian-media-companion),
which creates one for every file in the vault. This plugin only does it for
the files you pair yourself.

## Contributing

Issues and pull requests are welcome. Please open an issue first to discuss
substantial changes. When contributing code, run `npm run build` and confirm
the plugin loads without errors in Obsidian before submitting a PR.

## License

MIT © turingexmachina
