import { EventEmitter } from 'events';

export class SdfgPythonDebuggerRuntime extends EventEmitter {

    private fileAccessor?: FileAccessor;

    public constructor(fileAccessor: FileAccessor) {
        super();

        this.fileAccessor = fileAccessor;
    }

    public start(program: string) {
        console.log('Starting the run with file accessor:');
        console.log(this.fileAccessor);
        console.log(this.fileAccessor?.readFile('tst'));

        this.sendEvent('output', 'Running SDFG:', 'file1', 'line1', 'col1');
        this.sendEvent('output', program, 'file1', 'line1', 'col1');

        this.run();
    }

    private run() {
        this.sendEvent('output', 'Terminating', 'file1', 'line1', 'col1');
        this.sendEvent('end');
    }

    private sendEvent(event: string, ...args: any[]) {
        setImmediate(_ => {
            this.emit(event, ...args);
        });
    }

}

export interface FileAccessor {

    readFile(path: string): Promise<string>;

}