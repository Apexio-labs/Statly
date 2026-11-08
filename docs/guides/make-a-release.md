# Make a release

The version lives in one place: `human_version` in `addon/src/statly/manifest.json`. The
`CHANGELOG.md` heading names the same number.

## Small and big updates

A big update raises the first or second number: 2.1 to 2.2, or 2.x to 3.0. The first time Statly
opens after one, it shows a short "New in Statly" window. A small update, 2.2.0 to 2.2.1, shows
nothing.

For a big update, write the window's lines in `packages/i18n/locales/en.json` and `de.json` under
`whatsNew.releases`, keyed by the first two numbers:

```json
"releases": {
  "2.2": ["New widgets for a closer look: ...", "A new calendar shows ..."]
}
```

Keep them few and short, and write what people will notice, not how it was built. The CHANGELOG
holds the details. `addon/tests/test_release_notes.py` fails while the manifest names a big
version without these lines, so a release cannot ship without them. Lines can be written ahead of
time: they only show once that version is installed.

Someone who skips versions sees every big version's lines since the last window, newest first. A
new install sees nothing, because the welcome explains Statly.

## One folder for every copy

The manifest's `package` is Statly's AnkiWeb number, `215470814`. A `.ankiaddon` file from GitHub
therefore installs into the same folder as AnkiWeb's copy and replaces it. Anki keeps checking
AnkiWeb for updates to it, once a day, and asks before installing one. `conflicts` names the
folder `statly`, where releases up to 2.1.1 from GitHub landed, so Anki turns that old copy off
instead of running two Statlys. Keep both values.
