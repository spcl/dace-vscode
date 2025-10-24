// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    ControlFlowBlock,
    Edge,
    GenericSdfgOverlay,
    NestedSDFG,
    SDFGElement,
    SDFGNode,
    State,
} from '@spcl/sdfv/src';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { SDFVComponent } from '../vscode_sdfv';

declare const vscode: any;

export function refreshBreakpoints(): void {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer !== null && vscode !== undefined) {
        for (const activeOverlay of renderer.overlayManager.overlays) {
            if (activeOverlay instanceof BreakpointIndicator) {
                activeOverlay.refresh();
                break;
            }
        }
    }
}

export enum BreakpointType {
    BOUND,
    UNBOUND,
};

interface NodeIdTuple {
    sdfgId: number;
    stateId: number;
    nodeId: number;
}

export class BreakpointIndicator extends GenericSdfgOverlay {

    private breakpoints = new Map<string, BreakpointType>();

    constructor(renderer: VSCodeRenderer) {
        super(renderer);

        SDFVComponent.getInstance().invoke(
            'getSavedNodes', [this.renderer.sdfg?.attributes?.name]
        ).then(() => {
            this.refresh();
        }).catch((err: unknown) => {
            console.error(
                'Error retrieving saved breakpoints: ', err
            );
        });

        this.renderer.canvas.addEventListener(
            'contextmenu', this.onCtxtMenuClicked.bind(this)
        );
    }

    public destroy(): void {
        this.renderer.canvas.removeEventListener(
            'contextmenu', this.onCtxtMenuClicked.bind(this)
        );
    }

    public getSDFGElement(element: SDFGElement): NodeIdTuple {
        const undefinedVal = -1;
        let sdfgId = undefinedVal;
        let stateId = undefinedVal;
        let nodeId = undefinedVal;

        if (element instanceof NestedSDFG) {
            sdfgId = element.attributes()?.sdfg?.cfg_list_id ?? undefinedVal;
        } else if (element instanceof State) {
            sdfgId = element.sdfg.cfg_list_id;
            stateId = element.id;
        } else if (element instanceof SDFGNode) {
            sdfgId = element.sdfg.cfg_list_id;
            stateId = element.parentStateId ?? undefinedVal;
            nodeId = element.id;
        }

        return {
            sdfgId: sdfgId,
            stateId: stateId,
            nodeId: nodeId,
        };
    }

    public draw(): void {
        this.shadeSDFG();
    }

    public onCtxtMenuClicked(): boolean {
        const mPos = this.renderer.getMousePos();
        if (!mPos)
            return false;
        const elements = this.renderer.findElementsUnderCursor(mPos.x, mPos.y);
        const foregroundElem = elements.foregroundElement;
        if (foregroundElem !== undefined && !(foregroundElem instanceof Edge)) {
            const sdfgElem = this.getSDFGElement(foregroundElem);

            const elemUUID = (
                sdfgElem.sdfgId.toString() + '/' +
                sdfgElem.stateId.toString() + '/' +
                sdfgElem.nodeId.toString()
            );
            if (this.breakpoints.has(elemUUID)) {
                this.breakpoints.delete(elemUUID);
                this.eraseBreakpoint(foregroundElem, this.renderer.ctx);
                SDFVComponent.getInstance().invoke(
                    'removeBreakpoint',
                    [sdfgElem, this.renderer.sdfg?.attributes?.name]
                ).then(() => {
                    this.renderer.drawAsync();
                }).catch((err: unknown) => {
                    console.error(
                        'Error removing breakpoint: ', err
                    );
                });
                return true;
            } else {
                this.breakpoints.set(elemUUID, BreakpointType.BOUND);
                this.drawBreakpoint(
                    foregroundElem, this.renderer.ctx,
                    BreakpointType.BOUND
                );
                SDFVComponent.getInstance().invoke(
                    'addBreakpoint',
                    [sdfgElem, this.renderer.sdfg?.attributes?.name]
                ).then(() => {
                    this.renderer.drawAsync();
                }).catch((err: unknown) => {
                    console.error(
                        'Error adding breakpoint: ', err
                    );
                });
                return true;
            }
        }
        return false;
    }

    public removeBreakpoint(node: NodeIdTuple): void {
        const elemUUID = (
            node.sdfgId.toString() + '/' +
            node.stateId.toString() + '/' +
            node.nodeId.toString()
        );
        this.breakpoints.delete(elemUUID);
        this.draw();
        this.renderer.drawAsync();
    }

    public shadeNode(node: SDFGNode, ..._args: any[]): void {
        this.checkBreakpoint(node, this.renderer.ctx);
    }

    public shadeBlock(block: ControlFlowBlock, ..._args: any[]): void {
        this.checkBreakpoint(block, this.renderer.ctx);
    }

    public checkBreakpoint(
        node: SDFGElement, ctx: CanvasRenderingContext2D
    ): void {
        const nodeTuple = this.getSDFGElement(node);

        const elemUUID = (
            nodeTuple.sdfgId.toString() + '/' +
            nodeTuple.stateId.toString() + '/' +
            nodeTuple.nodeId.toString()
        );

        if (this.breakpoints.has(elemUUID)) {
            const breakpointType = this.breakpoints.get(elemUUID);
            if (breakpointType !== undefined) {
                const msg = (breakpointType === BreakpointType.BOUND) ?
                    'Right click to remove the Breakpoint' :
                    'The Breakpoint set on this node is unbounded';
                this.drawTooltip(node, msg);
                this.drawBreakpoint(node, ctx, breakpointType);
            }
        } else {
            this.drawTooltip(node, 'Right click to set a Breakpoint');
        }
    }

    public drawBreakpoint(
        node: SDFGElement,
        ctx: CanvasRenderingContext2D | null,
        type: BreakpointType
    ): void {
        if (!ctx)
            return;
        // Draw a red circle to indicate that a breakpoint is set
        const color = (type === BreakpointType.BOUND) ? 'red' : '#D3D3D3';
        this.drawBreakpointCircle(node, ctx, 'black', color);
    }

    public eraseBreakpoint(
        node: SDFGElement, ctx: CanvasRenderingContext2D | null
    ): void {
        if (!ctx)
            return;

        // Draw on top of the Breakpoint
        const background = node.getCssProperty(
            this.renderer, '--state-background-color'
        );
        this.drawBreakpointCircle(node, ctx, background, background);
    }

    public drawBreakpointCircle(
        node: SDFGElement,
        ctx: CanvasRenderingContext2D,
        strokeColor: string,
        fillColor: string
    ): void {
        // Draw the circle, if the node is a STATE, draw the BP at
        // the top left, otherwise draw the BP at the middle left
        const topleft = node.topleft();
        ctx.strokeStyle = strokeColor;
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        if (node instanceof State) {
            ctx.arc(topleft.x + 10, topleft.y + 20, 4, 0, 2 * Math.PI);
        } else {
            ctx.arc(topleft.x - 10, topleft.y + node.height / 2.0, 4, 0,
                2 * Math.PI);
        }
        ctx.stroke();
        ctx.fill();
    }

    public drawTooltip(node: SDFGElement, msg: string): void {
        const mousepos = this.renderer.getMousePos();
        if (mousepos && node.intersect(mousepos.x, mousepos.y))
            this.renderer.showTooltipAtMouse(msg);
    }

    public refresh(): void {
        this.renderer.drawAsync();
    }

    public unboundBreakpoint(node: NodeIdTuple): void {
        const elemUUID = (
            node.sdfgId.toString() + '/' +
            node.stateId.toString() + '/' +
            node.nodeId.toString()
        );

        if (this.breakpoints.has(elemUUID))
            this.breakpoints.set(elemUUID, BreakpointType.UNBOUND);

        this.renderer.drawAsync();
    }

    public setSavedNodes(nodes?: NodeIdTuple[]): void {
        nodes?.forEach(node => {
            const elemUUID = node.sdfgId.toString() + '/' +
                node.stateId.toString() + '/' +
                node.nodeId.toString();
            this.breakpoints.set(elemUUID, BreakpointType.BOUND);
        });
        this.refresh();
    }

}
