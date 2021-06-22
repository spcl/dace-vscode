# Change Log

## 0.3

### 0.3.3

- Allow editing of transformation properties before applying
- Support expansion of library nodes

### 0.3.2

- Fix various bugs regarding the editing of code properties.
- Allow language selection in code properties.
- Fix bugs regarding label updates upon property changes.

### 0.3.1

- Support custom transformations in transformation history.
- Support custom library nodes.
- Support custom enum properties (Schedules, Instrumentation, ...).

### 0.3.0

- Allow editing of SDFG properties.

## 0.2

### 0.2.16

- Switch to terminal mode by default for the dace daemon. This deprecates the
  subprocess mode.

### 0.2.12

- Remove annoying popup notifications if the SDFG optimization panel isn't
  open while viewing an SDFG.

### 0.2.11

- Various bugfixes and minor improvmenets.

### 0.2.10

- Provide interactive instrumentation of SDFGs.
- Provide visualization of instrumentation reports on SDFGs.
  - If a runtime report is generated, prompt the user to display it ontop of the 
    currently active SDFG.
- Provide running of SDFGs.
  - Run SDFGs normally, or run with profiling - this runs N times and reports
    the averate run-time (N is specified in the dace configurations).
  - If no wrapper script (Python) was detected, a popup asks to provide one.
    - Picked scripts are saved until the editor is disposed of.
- Prompt the user to auto-open an SDFG if one was generated with a linkfile
  (.sdfgl file).
- The DaCe interface now only is automatically started if the optimization
  pane is opened, not when only an editor is opened.
- Various smaller UI fixes and overhauls.
- Performance improvements.

### 0.2.9

- Provide a means to change the port on which the DaCe daemon listens.

### 0.2.8

- Provide a panel for static SDFG analysis.
- Various UI fixes and overhauls.
- Improved performance.

### 0.2.7

- Terminal mode for the DaCe backend.
  - The DaCe interface was moved in to the plugin itself.
  - The DaCe backend can now be started either silently in the background,
    or as a terminal process in a new terminal from within VSCode. This is
    configurable via the workspace settings.
- The SDFV can now be configured (workspace settings) to be split vertically
  instead of horizontally.
- Static analysis overlays:
  - A static analysis overlay to examine the memory volume in memlets was added.
    - This overlay visualizes memory movement and indicates hotspots on a color
      scale.
  - A static analysis overlay for FLOPS analysis was added.
    - This overlay visualizes compute time in the form of FLOPS on the graph.
  - Overlays can be toggled from the main menu inside the SDFV.
  - Overlays support the definition and subsequent resolution of symbols in
    symbolic expressions.
    - Unknown expressions are highlighted in grey, allowing the user to click on
      the element and define the missing symbols.

### 0.2.6

- Bugfixes.

### 0.2.5

- Added subgraph transformations.
  - Subgraph Transformations can be listed in the applicable transformations
    list when the corresponding subgraph is selected and the list is manually
    refreshed.
  - Subgraph Transformations get listed as selected transformations.
- Updated the icon pack.
- Updated to the latest version of the DaCe webclient.
  - For details please refer to
    [the DaCe webclient's github page](https://github.com/spcl/dace-webclient).
- The custom editor now interacts with the `TextDocument` API in the VSCode-way
  instead of directly writing to the filesystem.

### 0.2.4

- Improved error reporting for exceptions in DaCe.
- Allows multi-selection of elements (nodes / edges) in the graph view via
  Ctrl. + Click or box-select.
- Now grouping applicable transformations for relevance to the selected
  elements.

### 0.2.3

- Improved error reporting and recovery.
- Allows for a retry when the startup of the DaCe backend failed.
- Clears transformations when the document is changed.

### 0.2.2

- Fixes missing info contents in the info bar.

### 0.2.1

- Switched the renderer to a separate submodule with the DaCe webclient.
- Implemented a way to start and connect to a DaCe Python daemon running in the
  background.
- Give the user an option to download and install DaCe if it's missing on the
  system.
- Provide a list of appicable transformations when viewing an SDFG.
  - Auto sort the list with relevance to the current viewport, whenever a zoom
    or pan action is detected in the viewer.
  - Provide a means to manually update the list.
  - Provide a means to preview transformations on the graph by clicking them.
  - Provide a means of applying transformations by clicking the dedicated apply
    button next to a transformation.
  - List the transformation's description in the tooltip.
  - Provide a list of previously applied transformations to the SDFG.
  - Provide a means to preview previous states of the SDFG by clicking a
    transformation in the history.
  - Provide a means to jump back in time by clicking the apply button next to a
    transformation in the history.

## 0.1

### 0.1.11

- Updated the renderer with a new version as found in upstream DaCe.
- A number of improvements to the `Go to source` functionality:
  - `Go to source` buttons now show a tooltip on hovering, indicating what file
    and line the code is located at.
  - If the `Go to source` button fails to find the file referenced, it will now
    display an error notification as well as the expected file path.
  - The `Go to source` button can now handle absolute paths.

### 0.1.10

- Added back language support to automatically suggest the extension for SDFG
  files.

### 0.1.9

- Added jump to (Python) source functionality for tasklets.

### 0.1.8

- Made canvas resize correctly when VSCode window or editor is resized.

### 0.1.7

- Inherit SDFV button styles from VSCode
- Inter-State edges are now color friendlier
- Added DaCe to the plugin name for visibility and discoverability

### 0.1.6

- Translation and zoom is retained upon external reloading of the SDFG
- Draggable splitter behavior improvements w.r.t. snapping, minimum
  sizes, and dragging out of bounds

### 0.1.5

- Added draggable separator bar to resize canvas/info-box
- Removed obsolete scrollbars and changed layout to flexbox layout

### 0.1.4

- Added dark mode support (no canvas background)
- Added SDFG file (`.sdfg`) icons

### 0.1.0

Initial release of SDFV for VS Code