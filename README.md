# Reading Companion

A small desktop browser with a reading companion built in. Open any website, highlight
what lost you, and a model explains it right there. Powered by
[Nebius Token Factory](https://tokenfactory.nebius.com).

![Home screen](docs/home.png)

## What it does

- **Highlight to explain.** Select text and choose Explain, Simplify or Ask. The answer
  streams into a note pinned to the passage, and you can keep asking in the same note.
- **Ask about a picture.** Hover a picture and press Explain picture, or press Snip and
  drag over any part of the page.
- **Follow up on an answer.** Highlight part of an answer to ask about just that, or add a
  snip, a file or a pasted screenshot to your next question.
- **Ask the page.** Click the companion for a summary or any question about the page.
- **PDFs too.** A PDF opens in the app's own page view, so highlighting, notes and
  questions work on a paper the way they do on a web page.
- **Notes stay put.** A closed note leaves a marker beside its passage; click it to reopen
  the conversation. Notes last until you leave or reload the page.
- **Tabs**, each with its own notes.

## Install

Download the file for your computer from the
[releases page](https://github.com/tonykipkemboi/reading-companion/releases).

| Your computer | File | What to do |
|---|---|---|
| Mac, Apple silicon | `...-mac-arm64.dmg` | Open it and drag the app to Applications |
| Mac, Intel | `...-mac-x64.dmg` | Same |
| Windows | `...-win.exe` | Run it. SmartScreen warns because the installer is not code-signed: choose More info, then Run anyway |
| Ubuntu, Debian | `...-linux-amd64.deb` or `-arm64.deb` | `sudo apt install ./<file>.deb` |
| Other Linux | `...-linux-x86_64.AppImage` or `-arm64.AppImage` | `chmod +x <file>.AppImage`, then run it. On Ubuntu 24.04 and later use the `.deb` |

On first launch a pop-up asks for your Token Factory key. Create one at
https://tokenfactory.nebius.com, copy it, and press **Use the key I copied**. Browsing
works without a key; explanations do not.

The key is saved in `settings.txt` in the app's data folder. Open it with Cmd+, (Ctrl+, on
Windows and Linux) to change the key or any setting.

## What leaves your computer

- **Your key** goes to Nebius Token Factory with each request and nowhere else. The app's
  background process reads it from the clipboard or the settings file; it never reaches
  the app window or any web page.
- **When you ask a question**, the page's text (up to 60,000 characters), its address
  without the query string, what you highlighted or snipped, and your question go to
  Nebius. That includes pages you are signed in to. Nothing is sent until you ask. A PDF
  is downloaded by the app itself, with the tab's cookies, so it can show and read it.
- Nothing else is collected. There is no telemetry and no account.

## Run from source

Needs a recent Node.js.

```bash
cp env.example .env
```

Put your key in `.env` as `NEBIUS_API_KEY`, then:

```bash
npm install
```

```bash
npm start
```

Add an address to open straight onto a page: `npm start -- https://example.com`.

`npm run test:smoke` launches the app, highlights a paragraph on Wikipedia and checks that
an answer streams back. It uses your key.

## Build the installers

All three platforms build from a Mac, into `dist/`.

```bash
npm run dist:win
```

```bash
npm run dist:linux
```

```bash
npm run dist:mac
```

Windows and Linux builds are unsigned. The Mac build needs a **Developer ID Application**
certificate in your keychain, or it will not open on other Macs. To sign and notarise it,
store your Apple credentials once:

```bash
xcrun notarytool store-credentials "reading-companion" --apple-id "<your Apple ID>" --team-id "<your team ID>"
```

Then build with that profile:

```bash
APPLE_KEYCHAIN_PROFILE=reading-companion npm run dist:mac
```

`npm run dist:mac:test` makes an ad-hoc signed build with debugging on, for your own
machine only.

## Settings

All optional. Set them in the settings file, or in `.env` when running from source.

| Variable | What it does | Default |
|---|---|---|
| `NEBIUS_MODEL` | Model that writes the explanations | `thinkingmachines/Inkling-2-Small` |
| `NEBIUS_BASE_URL` | Token Factory inference endpoint | `https://api.tokenfactory.nebius.com/v1/` |
| `NEBIUS_REASONING_EFFORT` | Reasoning effort; `default` leaves it to the model | `low` |
| `NEBIUS_MAX_TOKENS` | Cap on each answer, reasoning included | `1600` |
| `START_URL` | Page to open at launch | home screen |
| `COMPANION_MASCOT` | `quippy`, `snippy` or `tippy` | chosen in the app |
| `COMPANION_NAME` | Any name for the companion | the design's own name |

The model is checked against the live catalog at launch. Asking about pictures needs a
model with image input. Each note names the model that answered it.

## Shortcuts

| Keys | Action |
|---|---|
| Cmd+E | Explain the highlight |
| Cmd+Shift+S | Snip a region |
| Cmd+J | Ask about the page |
| Cmd+T / Cmd+W | New tab / close tab |
| Cmd+L | Address bar |
| Esc | Close the note or cancel a snip |

Use Ctrl in place of Cmd on Windows and Linux.

## How it works

```
src/main/    background process: window, menu, Token Factory client, settings file
src/page/    script injected into each page: reports highlights and tracks them
src/shell/   the app window: toolbar, notes, snip tool, companions, home screen
src/pdf/     the PDF page view, and a hidden window that reads a PDF's full text
```

Questions go to Chat Completions with streaming on. Web pages are treated as hostile: the
page view is sandboxed, the injected script only reacts to real mouse and keyboard input,
answers are rendered as sanitised Markdown, and the model has no tools. To restyle the
app, edit `src/shell/theme.css`.

## Known limits

- Windows and Linux builds have not been run by the author.
- There is no automatic update, so the browser engine only gets security fixes when you
  install a new version. Treat it as a reading tool, not your browser for banking or email.
- A page can tell which of its passages you asked about, and its wording can mislead the
  model. An answer is only as trustworthy as the page.
- Text inside frames from another site cannot be highlighted; snip it instead.
- The PDF view is for reading: links inside a PDF are not clickable, and there is no
  print, download or thumbnail strip. A scanned PDF has no text to highlight; snip it.
  A PDF the view cannot open (password-protected, for example) falls back to the
  browser's built-in viewer, where only Snip works.
- Downloads do not open. Tabs are not restored after a restart.

## Licence

The code is under the [MIT licence](LICENSE). Four things keep their own terms:

- PDFs are shown and read with Mozilla's [pdf.js](https://mozilla.github.io/pdf.js/),
  under the Apache License 2.0.
- The Nebius Token Factory logo in `assets/powered-by/` is a Nebius trademark and is not
  covered. Check with Nebius before keeping it in a fork.
- The icons are [Gravity UI](https://gravity-ui.com/icons)'s, MIT, with their notice in
  `assets/icons/`.
- The fonts, [Atkinson Hyperlegible Next](https://www.brailleinstitute.org/freefont/) and
  [Bricolage Grotesque](https://github.com/ateliertriay/bricolage), are under the SIL Open
  Font License.
