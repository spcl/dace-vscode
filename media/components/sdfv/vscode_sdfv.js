function runSdfg() {
    if (vscode && renderer && renderer.sdfg && renderer.sdfg.attributes)
        vscode.postMessage({
            type: 'dace.run_sdfg',
            name: renderer.sdfg.attributes.name,
        });
}