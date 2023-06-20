// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import $ = require('jquery');
(window as any).jQuery = $;

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-icons/iconfont/material-icons.css';

import '@spcl/sdfv/sdfv.css';

import './breakpoints.css';

import {
    ICPCRequest
} from '../../../common/messaging/icpc_messaging_component';
import { ISDFGDebugNodeInfo } from '../../../debugger/breakpoint_handler';
import {
    ICPCWebclientMessagingComponent
} from '../../messaging/icpc_webclient_messaging_component';
import { ComponentTarget } from '../../../components/components';

declare const vscode: any;

class BreakpointPanel extends ICPCWebclientMessagingComponent {

    private static readonly INSTANCE: BreakpointPanel = new BreakpointPanel();

    private constructor() {
        super(ComponentTarget.Breakpoints);
    }

    public static getInstance(): BreakpointPanel {
        return this.INSTANCE;
    }

    private rootList?: JQuery<HTMLElement>;

    public createBreakpoint(
        root: JQuery<HTMLElement>, node: ISDFGDebugNodeInfo, color: string
    ): void {
        const listElement = $('<div>', {
            'class': 'list-element',
            'label': node.sdfgPath,
            'title': node.sdfgPath,
        }).on('click', _ => {
            this.invoke('goToSDFG', [node]);
        }).on('contextmenu', _ => {
            this.invoke('goToCPP', [node]);
        });

        const breakpoint = $('<div>', {
            'class': 'breakpoint',
        });

        const circleContainer = $('<div>', {
            'class': 'bp-circle-container',
        });
        $('<div>', {
            'class': 'bp-circle',
        }).css({
            'background-color': color,
        }).appendTo(circleContainer);

        const sdfgNameContainer = $('<div>', {
            'class': 'sdfg-name-container',
        });
        $('<div>', {
            'class': 'sdfg-name',
        }).text(node.sdfgName ? node.sdfgName : '').appendTo(sdfgNameContainer);

        const removeBp = $('<div>', {
            'class': 'remove-bp',
        }).text('X');
        removeBp.on('click', () => {
            this.invoke('removeBreakpoint', [node]);
            return false;
        });

        const sdfgIdentifier = $('<div>', {
            'class': 'sdfg-identifier'
        }).text(`${node.sdfgId} : ${node.stateId} : ${node.nodeId}`);

        breakpoint.append(circleContainer);
        breakpoint.append(sdfgNameContainer);
        breakpoint.append(removeBp);
        breakpoint.append(sdfgIdentifier);
        listElement.append(breakpoint);
        root.append(listElement);
    }

    public init(): void {
        super.init(vscode, window);

        this.rootList = $('#sdfg-debug-list');

        this.invoke('refresh');
    }

    @ICPCRequest()
    public onRefresh(nodes?: ISDFGDebugNodeInfo[]): void {
        this.rootList?.html('');
        if (nodes && this.rootList) {
            for (const node of nodes)
                this.createBreakpoint(this.rootList, node, '#dd0000');
        }
        this.rootList?.show();
    }

    @ICPCRequest()
    public addSDFGBreakpoint(
        node: ISDFGDebugNodeInfo, unbounded: boolean = false
    ): void {
        if (this.rootList)
            this.createBreakpoint(
                this.rootList, node, unbounded ? '#a3a3a3' : '#dd0000'
            );
    }

}

$(() => {
    BreakpointPanel.getInstance().init();
});
