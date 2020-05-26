# SDFV in VS Code

This VS Code extension aims to provide a viewing panel for
[SDFGs](http://spcl.inf.ethz.ch/Research/DAPP/) inside of VS Code. It
serves as a wrapper for the SDFG Viewer SDFV, found in the current version
of [DaCe](https://github.com/spcl/dace).

## Features

Provides an SDFG viewing panel which:
- opens automatically, when you open up a valid SDFG file
  (file ending in `.sdfg`, JSON formatted).
- Auto-updates the SDFG Viewer when the file changed on disk.

You can switch between the custom SDFG viewer and a standard text editor
by clicking the option `Reopen with...` in the editor's three-dot-menu in
the top right.

## Release Notes

### 0.1.0

Initial release of SDFV for VS Code.

### 0.1.2

SDFG Viewer is now registered as a custom text editor for `.sdfg` files.

### 0.1.5

Added support for dark mode, added SDFG file icons, and made the border
between the graph and the info box a draggable border, such that you can
now decide how large the info box should be.