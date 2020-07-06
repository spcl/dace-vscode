# Change Log

## 0.1.11

- Updated the renderer with a new version as found in upstream DaCe.
- A number of improvements to the `Go to source` functionality:
  - `Go to source` buttons now show a tooltip on hovering, indicating what file
    and line the code is located at.
  - If the `Go to source` button fails to find the file referenced, it will now
    display an error notification as well as the expected file path.
  - The `Go to source` button can now handle absolute paths.

## 0.1.10

- Added back language support to automatically suggest the extension for SDFG
  files.

## 0.1.9

- Added jump to (Python) source functionality for tasklets.

## 0.1.8

- Made canvas resize correctly when VSCode window or editor is resized.

## 0.1.7

- Inherit SDFV button styles from VSCode
- Inter-State edges are now color friendlier
- Added DaCe to the plugin name for visibility and discoverability

## 0.1.6

- Translation and zoom is retained upon external reloading of the SDFG
- Draggable splitter behavior improvements w.r.t. snapping, minimum
  sizes, and dragging out of bounds

## 0.1.5

- Added draggable separator bar to resize canvas/info-box
- Removed obsolete scrollbars and changed layout to flexbox layout

## 0.1.4

- Added dark mode support (no canvas background)
- Added SDFG file (`.sdfg`) icons

## 0.1.0

Initial release of SDFV for VS Code