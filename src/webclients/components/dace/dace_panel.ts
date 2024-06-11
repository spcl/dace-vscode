// Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as bootstrap from 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-symbols';

import './dace_panel.css';

import $ = require('jquery');
(window as any).jQuery = $;

import {
    ICPCWebclientMessagingComponent
} from '../../messaging/icpc_webclient_messaging_component';
import { ComponentTarget } from '../../../components/components';
import { ICPCRequest } from '../../../common/messaging/icpc_messaging_component';

declare const vscode: any;

class DaCePanel extends ICPCWebclientMessagingComponent {

    private static readonly INSTANCE: DaCePanel = new DaCePanel();

    private constructor() {
        super(ComponentTarget.DaCe);
    }

    public static getInstance(): DaCePanel {
        return this.INSTANCE;
    }

    private launchBtn?: JQuery<HTMLElement>;
    private connectBtn?: JQuery<HTMLElement>;
    private quitBtn?: JQuery<HTMLElement>;
    private portInput?: JQuery<HTMLInputElement>;

    public init(): void {
        super.init(vscode, window);

        this.launchBtn = $('#launch-btn');
        this.connectBtn = $('#connect-btn');
        this.quitBtn = $('#quit-btn');
        this.portInput = $('#inputPort');

        this.launchBtn.on('click', () => {
            this.launchDaemon();
        });
        this.connectBtn.on('click', () => {
            this.connectDaemon();
        });
        this.quitBtn.on('click', () => {
            this.quitDaemon();
        });

        this.invoke('onReady');
    }

    private getPort(): number | undefined {
        let port: string | number | undefined = this.portInput?.val();
        if (port && typeof port === 'string')
            port = parseInt(port);

        if (!port || typeof port !== 'number')
            port = undefined;
        return port;
    }

    public launchDaemon(): void {
        const port = this.getPort();
        this.invoke('startDaemonInTerminal', [port]);
    }

    public connectDaemon(): void {
        const port = this.getPort();
        if (port) {
            this.invoke('setPort', [port]).then(() => {
                this.invoke('pollDaemon');
            });
        } else {
            this.invoke('pollDaemon');
        }
    }

    public quitDaemon(): void {
        this.invoke('quitDaemon');
    }

    @ICPCRequest()
    public setPort(port: number): void {
        this.portInput?.val(port);
    }

    @ICPCRequest()
    public setStatus(running: boolean): void {
        const statusText = $('#status-text');
        if (running) {
            statusText.text('Connected');
            statusText.removeClass('not-connected');
            statusText.addClass('connected');

            this.quitBtn?.prop('disabled', null);
        } else {
            statusText.text('Not connected');
            statusText.removeClass('connected');
            statusText.addClass('not-connected');

            this.quitBtn?.prop('disabled', 'disabled');
        }
    }

    @ICPCRequest()
    public setVersion(
        version: string, versionOk: boolean, additionalInfo: string
    ): void {
        const versionText = $('#version-text');
        versionText.html();
        versionText.text(version);
        if (additionalInfo !== '') {
            const tooltip = $('<span>', {
                class: 'material-symbols-rounded',
                text: 'warning',
                css: {
                    'vertical-align': 'middle',
                    'font-size': '1rem',
                },
                'data-bs-toggle': 'tooltip',
                'data-bs-placement': 'bottom',
                'data-bs-custom-class': 'version-warning-tooltip',
                'data-bs-title': additionalInfo,
            }).appendTo(versionText);
            new bootstrap.Tooltip(tooltip[0], {
                placement: 'bottom',
                trigger: 'click hover focus',
            });
        }
        if (versionOk)
            versionText.addClass('version-ok');
        else
            versionText.addClass('version-problem');
    }

}

$(() => {
    DaCePanel.getInstance().init();
});
