# DaCe SDFG Viewer (SDFV) in VS Code

[![](http://vsmarketplacebadge.apphb.com/version-short/phschaad.sdfv.svg
)](https://marketplace.visualstudio.com/items?itemName=phschaad.sdfv)
[![](http://vsmarketplacebadge.apphb.com/installs-short/phschaad.sdfv.svg
)](https://marketplace.visualstudio.com/items?itemName=phschaad.sdfv)
[![](http://vsmarketplacebadge.apphb.com/downloads-short/phschaad.sdfv.svg
)](https://marketplace.visualstudio.com/items?itemName=phschaad.sdfv)
[![](http://vsmarketplacebadge.apphb.com/rating-short/phschaad.sdfv.svg
)](https://marketplace.visualstudio.com/items?itemName=phschaad.sdfv)

This VS Code extension aims to provide a viewing panel for
[SDFGs](http://spcl.inf.ethz.ch/Research/DAPP/) inside of VS Code. It
serves as a wrapper for the SDFG Viewer SDFV, found in the current version
of [DaCe](https://github.com/spcl/dace). Additionally, some features geared
towards working with and editing SDFGs are provided.

## Features

Provides an SDFG viewing panel which:
- opens automatically, when you open up a valid SDFG file
  (file ending in `.sdfg`, JSON formatted).
- Auto-updates the SDFG Viewer when the file changed on disk.

You can switch between the custom SDFG viewer and a standard text editor
by clicking the option `Reopen with...` in the editor's three-dot-menu in
the top right.

When viewing a tasklet referencing a piece of Python code, you can jump to the
corresponding lines of Python code with a button click.

A separate side panel is provided in which applicable transformations to the
currently open SDFG can be browsed, previewed, and directly applied. A history
of previously applied transformations is being kept, allowing you to preview
previous states of the SDFG as well as giving you the option to travel back in
time.