function wrapperFileInputChanged(el) {
    if (el.files.length < 1)
        return;
    wrapper_file = el.files[0];
    runSdfg(wrapper_file);
}

function runSdfg(file) {
    if (vscode)
        vscode.postMessage({
            type: 'dace.run_sdfg',
            path: file.path,
            filename: file.name,
        });
}