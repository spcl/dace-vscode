// Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    DagreGraph,
    Edge,
    GenericSdfgOverlay,
    GraphElementInfo,
    NestedSDFG,
    Point2D,
    SDFGElement,
    SDFGElementGroup,
    SDFGNode,
    SDFV,
    SDFVSettings,
    SimpleRect,
    State,
} from '@spcl/sdfv/src';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { SDFVComponent } from '../vscode_sdfv';

declare const vscode: any;

export function refreshBreakpoints(): void {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer !== null && vscode !== undefined) {
        let isActive = false;
        const overlays = renderer.get_overlay_manager().get_overlays();
        for (const activeOverlay of overlays) {
            if (activeOverlay instanceof BreakpointIndicator) {
                isActive = true;
                break;
            }
        }
    }
}

export enum BreakpointType {
    BOUND,
    UNBOUND,
};

type NodeIdTuple = {
    sdfgId: number,
    stateId: number,
    nodeId: number,
};

export class BreakpointIndicator extends GenericSdfgOverlay {

    private breakpoints: Map<string, BreakpointType> = new Map();

    constructor(renderer: VSCodeRenderer) {
        super(renderer);

        SDFVComponent.getInstance().invoke(
            'getSavedNodes', [this.renderer.get_sdfg().attributes.name]
        ).then(() => {
            this.refresh();
        });
    }

    public getSDFGElement(element: SDFGElement): NodeIdTuple {
        const undefinedVal = -1;
        let sdfgId = undefinedVal;
        let stateId = undefinedVal;
        let nodeId = undefinedVal;

        if (element instanceof NestedSDFG) {
            sdfgId = element.data.node.attributes.sdfg.cfg_list_id;
        } else if (element instanceof State) {
            sdfgId = element.sdfg.cfg_list_id;
            stateId = element.id;
        } else if (element instanceof SDFGNode) {
            sdfgId = element.sdfg.cfg_list_id;
            if (element.parent_id === null)
                stateId = undefinedVal;
            else
                stateId = element.parent_id;
            nodeId = element.id;
        }

        return {
            sdfgId: sdfgId,
            stateId: stateId,
            nodeId: nodeId,
        };
    }

    public draw(): void {
        const graph  = this.renderer.get_graph();
        if (graph)
            this.recursivelyShadeSDFG(
                graph,
                this.renderer.get_context(),
                this.renderer.get_canvas_manager()?.points_per_pixel(),
                this.renderer.get_visible_rect()
            );
    }

    public on_mouse_event(
        type: string, ev: MouseEvent, mousepos: Point2D,
        elements: Record<SDFGElementGroup, GraphElementInfo[]>,
        foregroundElem: SDFGElement | null,
        endsDrag: boolean
    ): boolean {
        if (type === 'contextmenu') {
            if (
                foregroundElem !== undefined &&
                foregroundElem !== null &&
                !(foregroundElem instanceof Edge)
            ) {
                const sdfgElem = this.getSDFGElement(foregroundElem);

                const elemUUID = (
                    sdfgElem.sdfgId + '/' +
                    sdfgElem.stateId + '/' +
                    sdfgElem.nodeId
                );
                if (this.breakpoints.has(elemUUID)) {
                    this.breakpoints.delete(elemUUID);
                    this.eraseBreakpoint(
                        foregroundElem, this.renderer.get_context()
                    );
                    SDFVComponent.getInstance().invoke(
                        'removeBreakpoint',
                        [sdfgElem, this.renderer.get_sdfg().attributes.name]
                    );
                } else {
                    this.breakpoints.set(elemUUID, BreakpointType.BOUND);
                    this.drawBreakpoint(
                        foregroundElem, this.renderer.get_context(),
                        BreakpointType.BOUND
                    );
                    SDFVComponent.getInstance().invoke(
                        'addBreakpoint',
                        [sdfgElem, this.renderer.get_sdfg().attributes.name]
                    );
                }

                this.renderer.draw_async();
            }
        }

        return false;
    }

    public removeBreakpoint(node: NodeIdTuple): void {
        const elemUUID = (
            node.sdfgId + '/' +
            node.stateId + '/' +
            node.nodeId
        );
        this.breakpoints.delete(elemUUID);
        this.draw();
        this.renderer.draw_async();
    }

    public checkBreakpoint(
        node: SDFGElement, ctx: CanvasRenderingContext2D
    ): void {
        const nodeTuple = this.getSDFGElement(node);

        const elemUUID = (
            nodeTuple.sdfgId + '/' +
            nodeTuple.stateId + '/' +
            nodeTuple.nodeId
        );

        if (this.breakpoints.has(elemUUID)) {
            const breakpointType = this.breakpoints.get(elemUUID);
            if (breakpointType !== undefined) {
                let msg = (breakpointType === BreakpointType.BOUND) ?
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
        node: SDFGNode, ctx: CanvasRenderingContext2D | null,
        type: BreakpointType
    ): void {
        if (!ctx)
            return;
        // Draw a red circle to indicate that a breakpoint is set
        let color = (type === BreakpointType.BOUND) ? 'red' : '#D3D3D3';
        this.drawBreakpointCircle(node, ctx, 'black', color);
    }

    public eraseBreakpoint(
        node: SDFGNode, ctx: CanvasRenderingContext2D | null
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
        node: SDFGNode, ctx: CanvasRenderingContext2D,
        strokeColor: string, fillColor: string
    ): void {
        // Draw the circle, if the node is a STATE, draw the BP at
        // the top left, otherwise draw the BP at the middle left
        const topleft = node.topleft();
        ctx.strokeStyle = strokeColor;
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        (node instanceof State) ?
            ctx.arc(topleft.x + 10, topleft.y + 20, 4, 0, 2 * Math.PI) :
            ctx.arc(topleft.x - 10, topleft.y + node.height / 2.0, 4, 0,
                2 * Math.PI);
        ctx.stroke();
        ctx.fill();
    }

    public drawTooltip(node: SDFGNode, msg: string): void {
        const mousepos = this.renderer.get_mousepos();
        if (mousepos && node.intersect(mousepos.x, mousepos.y)) {
            this.renderer.set_tooltip(() => {
                const container = this.renderer.get_tooltip_container();
                if (container) {
                    container.innerText = msg;
                    container.className = 'sdfvtooltip';
                }
            });
        }
    }

    public recursivelyShadeSDFG(
        graph: DagreGraph,
        ctx: CanvasRenderingContext2D | null,
        ppp: number | undefined,
        visibleRect: SimpleRect | null
    ): void {
        if (!ctx || ppp === undefined || visibleRect === null)
            return;

        // First go over visible states, skipping invisible ones. We only draw
        // something if the state is collapsed or we're zoomed out far enough.
        // If it's expanded or zoomed in close enough, we traverse inside.
        graph.nodes().forEach((v: string) => {
            let state = graph.node(v);
            // If the node's invisible, we skip it.
            if (this.renderer.viewportOnly && !state.intersect(
                visibleRect.x, visibleRect.y,
                visibleRect.w, visibleRect.h
            ))
                return;

            if (
                (this.renderer.adaptiveHiding &&
                 (ppp >= SDFVSettings.get<number>('nodeLOD') ||
                  state.width / ppp <= SDFVSettings.get<number>('nestedLOD'))) ||
                state.data.state.attributes.is_collapsed
            ) {
                // Currently we don't do anything
            } else {
                this.checkBreakpoint(state, ctx);
                const stateGraph = state.data.graph;
                if (stateGraph) {
                    stateGraph.nodes().forEach((v: string) => {
                        const node = stateGraph.node(v);

                        // Skip the node if it's not visible.
                        if (this.renderer.viewportOnly && !node.intersect(
                            visibleRect.x, visibleRect.y,
                            visibleRect.w, visibleRect.h
                        ))
                            return;

                        // Check if the node is a NestedSDFG and if
                        // it should be visited
                        if (!(node.data.node.attributes.is_collapsed ||
                              (this.renderer.adaptiveHiding &&
                               ppp >= SDFVSettings.get<number>('nodeLOD'))) &&
                            node instanceof NestedSDFG
                        ) {
                            this.recursivelyShadeSDFG(
                                node.data.graph, ctx, ppp, visibleRect
                            );
                        }

                        this.checkBreakpoint(node, ctx);
                    });
                }
            }
        });
    }

    public refresh(): void {
        this.draw();
        this.renderer.draw_async();
    }

    public unboundBreakpoint(node: NodeIdTuple): void {
        const elemUUID = (
            node.sdfgId + '/' +
            node.stateId + '/' +
            node.nodeId
        );

        if (this.breakpoints.has(elemUUID))
            this.breakpoints.set(elemUUID, BreakpointType.UNBOUND);

        this.draw();
        this.renderer.draw_async();
    }

    public setSavedNodes(nodes: NodeIdTuple[]): void {
        if (nodes === undefined || nodes === null)
            return;
        nodes.forEach(node => {
            const elemUUID = node.sdfgId + '/' +
                node.stateId + '/' +
                node.nodeId;
            this.breakpoints.set(elemUUID, BreakpointType.BOUND);
        });
        this.refresh();
    }

}
