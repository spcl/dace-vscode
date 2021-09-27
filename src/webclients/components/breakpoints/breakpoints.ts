// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as $ from 'jquery';
(window as any).jQuery = $;

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-icons/iconfont/material-icons.css';

import '@spcl/sdfv/sdfv.css';

import './breakpoints.css';

import { ISDFGDebugNodeInfo } from '../../../debugger/breakpoint_handler';

declare const vscode: any;

export function createBreakpoint(
    root: JQuery<HTMLElement>, node: ISDFGDebugNodeInfo, color: string
): void {
    const listElement = $('<div>', {
        'class': 'list-element',
        'label': node.sdfgPath,
        'title': node.sdfgPath,
    }).on('click', _ => {
        vscode.postMessage({
            type: 'sdfv.go_to_sdfg',
            sdfgName: node.sdfgName,
            path: node.sdfgPath,
            zoomTo: `${node.sdfgId}/${node.stateId}/-1/-1`,
            displayBps: true,
        });
    }).on('contextmenu', _ => {
        vscode.postMessage({
            type: 'sdfv.go_to_cpp',
            cachePath: node.cache,
            sdfgName: node.sdfgName,
            sdfgId: node.sdfgId,
            stateId: node.stateId,
            nodeId: node.nodeId,
        });
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
        vscode.postMessage({
            type: 'bp_handler.remove_breakpoint',
            node: node,
            sdfgName: node.sdfgName,
        });
        vscode.postMessage({
            type: 'sdfv.remove_breakpoint',
            node: node,
            sdfgName: node.sdfgName,
        });
        // Stops propagating the click 
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

$(() => {
    // Add a listener to receive messages from the extension.
    window.addEventListener('message', e => {
        const message = e.data;
        const rootList = $('#sdfg-debug-list');
        switch (message.type) {
            case 'refresh_sdfg_breakpoints':
                rootList.html('');
                if (message.nodes) {
                    for (const node of message.nodes)
                        createBreakpoint(rootList, node, '#dd0000');
                }
                rootList.show();
                break;
            case 'add_sdfg_breakpoint':
                createBreakpoint(rootList, message.node, '#dd0000');
                break;
            case 'unbound_sdfg_breakpoint':
                createBreakpoint(rootList, message.node, '#a3a3a3');
                break;
            default:
                break;
        }
    });

    if (vscode)
        vscode.postMessage({
            type: 'sdfgBreakpoints.refresh_sdfg_breakpoints',
        });
});
