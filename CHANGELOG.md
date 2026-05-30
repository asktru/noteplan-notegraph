# What's changed in 🕸 Note Graph plugin?

## [1.0.1] 2026-04-12
### New
- **Mobile sidebar navigation**: hamburger button opens the sidebar as a slide-in overlay on small screens; backdrop and auto-close on note selection.

### Fixes
- Toolbar layout on narrow screens: depth buttons shorten to single digits below 550 px, toolbar margin clears the hamburger button.

## [1.0.0] 2026-04-05
- Initial release: **Note Graph** command — interactive force-directed graph of note connections via wiki links and backlinks.
- SVG rendering with pure-JS force simulation; draggable nodes, zoom, and 1/2/3-level depth toggle.
- Hashtag (#) and mention (@) overlay toggles with colour-coded dashed pill nodes.
- Left sidebar listing graph notes; click any node to open it in split view.
- **Add or remove note from graph** slash command to pin/unpin notes.
- Preferences (depth, tags, mentions) persisted in `DataStore.settings`; all depth × overlay combinations pre-built for instant switching.
- Light/dark theme support.
