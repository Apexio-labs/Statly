# 1. One web view in a separate window

## Decision

All of Statly's interface is a single React app, shown in one `AnkiWebView` inside a separate
window. It is served from Anki's `/_addons/` route. Anki's main window stays untouched.

## Why

- Everything can be built, tested and themed with one toolset, without any Qt interface code.
- Serving files instead of inlining them allows code splitting, so features load on demand.
- A separate window cannot disturb Anki's own screens and state.

## Consequences

- `set_open_links_externally(False)` is required, or Anki opens the app in the system browser.
  External links go through `system.openExternal`.
- `onEsc` is overridden, or Esc would close the whole window.
- The build target follows the oldest supported Anki: Chromium 122 in Anki 25.09.
