// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as $ from 'jquery';
(window as any).jQuery = $;

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-icons/iconfont/material-icons.css';

import '@spcl/sdfv/sdfv.css';

import './breakpoints.css';

import { ISDFGDebugNodeInfo } from '../../../debugger/breakpoint_handler';
import {
    ICPCWebclientMessagingComponent
} from '../../messaging/icpc_webclient_messaging_component';

declare const vscode: any;

class BreakpointPanel {

    private static readonly INSTANCE: BreakpointPanel = new BreakpointPanel();

    private constructor() { }

    public static getInstance(): BreakpointPanel {
        return this.INSTANCE;
    }

    private messageHandler?: ICPCWebclientMessagingComponent;

    private rootList?: JQuery<HTMLElement>;

    public createBreakpoint(
        root: JQuery<HTMLElement>, node: ISDFGDebugNodeInfo, color: string
    ): void {
        const listElement = $('<div>', {
            'class': 'list-element',
            'label': node.sdfgPath,
            'title': node.sdfgPath,
        }).on('click', _ => {
            this.messageHandler?.invoke('goToSDFG', [node]);
        }).on('contextmenu', _ => {
            this.messageHandler?.invoke('goToCPP', [node]);
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
            this.messageHandler?.invoke('removeBreakpoint', [node]);
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
        this.messageHandler = new ICPCWebclientMessagingComponent(
            window, vscode
        );

        this.rootList = $('#sdfg-debug-list');

        this.messageHandler.register(this.onRefresh, this);
        this.messageHandler.register(this.addSDFGBreakpoint, this);

        this.messageHandler.invoke('refresh');
    }

    public onRefresh(nodes?: ISDFGDebugNodeInfo[]): void {
        this.rootList?.html('');
        if (nodes && this.rootList) {
            for (const node of nodes)
                this.createBreakpoint(this.rootList, node, '#dd0000');
        }
        this.rootList?.show();
    }

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
