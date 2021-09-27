// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    AccessNode,
    DagreSDFG,
    GenericSdfgOverlay,
    NestedSDFG,
    SDFGElement,
    SDFGNode,
    SDFV,
    SimpleRect,
    State,
} from '@spcl/sdfv/out';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { createSingleUseModal } from '../utils/helpers';

declare const vscode: any;

export function sdfgEditContinueHide(socketNumber: number): void {
    VSCodeRenderer.getInstance()?.get_overlay_manager()?.deregister_overlay(
        CorrectnessOverlay
    );
    vscode.postMessage({
        type: 'dace_listener.sdfg_edit_continue',
        socketNumber: socketNumber
    });
    $('#sdfg-edit-continue-btn').hide();
    $('#sdfg-edit-diff-btn').hide();
}

export function sdfgEditContinueShow(socketNumber: number): void {
    $('#sdfg-edit-continue-btn').on('click', () => {
        sdfgEditContinueHide(socketNumber);
    });
    $('#sdfg-edit-continue-btn').show();
}

export function sdfgEditDifferenceShow(): void {
    const btn = $('#sdfg-edit-diff-btn');
    btn.on('click', () => {
        const ol =
            VSCodeRenderer.getInstance()?.get_overlay_manager()?.get_overlay(
                CorrectnessOverlay
            );
        if (ol && ol instanceof CorrectnessOverlay)
            changeDiffThreshold(ol.getDiffRange(), ol.getDiffText());
    });
    btn.show();
}

function changeDiffThreshold(diffRange: number, diffText: string): void {
    const modal = createSingleUseModal(
        'Change correctness threshold',
        true,
        ''
    );

    const diffInputRange = $('<input>', {
        type: 'range',
        min: 0,
        max: 10,
        value: diffRange,
    }).appendTo(modal.body);
    const diffInputText = $('<input>', {
        type: 'text',
        value: diffText,
        style: 'margin-left: 2rem;',
    }).appendTo(modal.body);

    diffInputRange.on('change', () => {
        const newVal = diffInputRange.val();
        if (newVal !== undefined && typeof newVal === 'number')
            diffInputText.val('1e-' + newVal.toString());
    });

    modal.confirmBtn?.on('click', () => {
        const valText = diffInputText.val();
        if (!valText || !(typeof valText === 'string'))
            return;
        const val = parseFloat(valText);
        const valRange = diffInputRange.val();

        const ol =
            VSCodeRenderer.getInstance()?.get_overlay_manager()?.get_overlay(
                CorrectnessOverlay
            );
        if (ol && ol instanceof CorrectnessOverlay) {
            ol.setDiffThreshold(val);
            ol.refresh();
        }

        if (diffRange !== valRange || diffText !== valText)
            vscode.postMessage({
                type: 'bp_handler.change_diff_threshold',
                diffRange: valRange,
                diffText: valText,
            });
        modal.modal.modal('hide');
    });
    modal.modal.modal('show');
}

export class CorrectnessOverlay extends GenericSdfgOverlay {

    private stateReports: Map<string, any[]> = new Map();
    private nodeReports: Map<string, { msg: string, diff: number }> = new Map();
    private diffThreshold: number = 0.0;
    private diffText: string = '1e-5';
    private diffRange: number = 5;

    constructor(renderer: VSCodeRenderer) {
        super(renderer);
    }

    public newReports(reports: any[]): void {
        this.stateReports.clear();
        this.nodeReports.clear();

        if (reports === null || reports === undefined)
            return;

        reports.forEach(report => {
            const stateId = `${report.sdfg_id}/${report.state_id}/-1`;
            const nodeId =
                `${report.sdfg_id}/${report.state_id}/${report.node_id}`;

            // If no report exists yet for this state, create a new one.
            let stateReport = this.stateReports.get(stateId);
            if (stateReport === undefined || stateReport === null)
                stateReport = [];
            report.diff = parseFloat(report.diff);
            stateReport.push(report);

            this.stateReports.set(stateId, stateReport);
            this.nodeReports.set(nodeId, {
                msg: report.msg,
                diff: report.diff
            });
        });

        this.refresh();
    }

    private getSDFGElementIdentifier(element: SDFGElement): string {
        const undefinedVal = -1;
        let sdfgId = undefinedVal;
        let stateId = undefinedVal;
        let nodeId = undefinedVal;

        if (element instanceof NestedSDFG) {
            sdfgId = element.data.node.attributes.sdfg.sdfg_list_id;
        } else if (element instanceof State) {
            sdfgId = element.sdfg.sdfg_list_id;
            stateId = element.id;
        } else if (element instanceof SDFGNode) {
            sdfgId = element.sdfg.sdfg_list_id;
            if (element.parent_id !== null)
                stateId = element.parent_id;
            else
                stateId = undefinedVal;
            nodeId = element.id;
        }

        return sdfgId + '/' + stateId + '/' + nodeId;
    }

    private stateCheckCorrectness(
        state: State, ctx: CanvasRenderingContext2D
    ): void {
        const identifier = this.getSDFGElementIdentifier(state);
        const stateReport = this.stateReports.get(identifier);
        if (stateReport === null || stateReport === undefined)
            return;
        let errFraction = 1.;
        for (const report of stateReport) {
            if (report.diff > this.diffThreshold)
                errFraction /= 2.;
        }
        if (errFraction !== 1.)
            this.outlineState(state, ctx, 'red');
    }

    private nodeCheckCorrectness(
        node: SDFGNode, ctx: CanvasRenderingContext2D
    ): void {
        const identifier = this.getSDFGElementIdentifier(node);
        const nodeReport = this.nodeReports.get(identifier);
        if (nodeReport === null || nodeReport === undefined)
            return;
        this.drawTooltip(node, nodeReport.msg);
        node.shade(
            this.renderer, ctx,
            nodeReport.diff <= this.diffThreshold ? 'green' : 'red'
        );
    }

    public outlineState(
        state: State, ctx: CanvasRenderingContext2D, color: string
    ): void {
        const topleft = state.topleft();
        const oldLineWidth = ctx.lineWidth;
        ctx.lineWidth = Math.floor(state.width / 50);
        ctx.strokeStyle = color;
        ctx.strokeRect(topleft.x, topleft.y, state.width, state.height);
        ctx.lineWidth = oldLineWidth;
    }

    public draw(): void {
        const graph = this.renderer.get_graph();
        const ctx = this.renderer.get_context();
        const ppp = this.renderer.get_canvas_manager()?.points_per_pixel();
        const visibleRect = this.renderer.get_visible_rect();
        if (graph && ctx && ppp !== undefined && visibleRect)
            this.recursivelyShadeSDFG(graph, ctx, ppp, visibleRect);
    }

    public drawTooltip(node: SDFGNode, msg: string): void {
        const mousepos = this.renderer.get_mousepos();
        if (mousepos && node.intersect(mousepos.x, mousepos.y)) {
            if (msg !== '')
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
        graph: DagreSDFG,
        ctx: CanvasRenderingContext2D,
        ppp: number,
        visibleRect: SimpleRect
    ): void {
        // First go over visible states, skipping invisible ones. We only draw
        // something if the state is collapsed or we're zoomed out far enough.
        // If it's expanded or zoomed in close enough, we traverse inside.
        graph.nodes().forEach(v => {
            let state = graph.node(v);
            // If the node's invisible, we skip it.
            if ((ctx as any).lod && !state.intersect(
                visibleRect.x, visibleRect.y,
                visibleRect.w, visibleRect.h
            )) {
                return;
            }

            if (((ctx as any).lod && (ppp >= SDFV.STATE_LOD ||
                state.width / ppp <= SDFV.STATE_LOD)) ||
                state.data.state.attributes.is_collapsed) {
                // Currently we don't do anything.
            } else {
                this.stateCheckCorrectness(state, ctx) + '\n';
                const stateGraph = state.data.graph;
                if (stateGraph) {
                    stateGraph.nodes().forEach((v: string) => {
                        let node = stateGraph.node(v);

                        // Skip the node if it's not visible.
                        if ((ctx as any).lod && !node.intersect(
                            visibleRect.x, visibleRect.y,
                            visibleRect.w, visibleRect.h
                        )) {
                            return;
                        }

                        if (node instanceof AccessNode)
                            this.nodeCheckCorrectness(node, ctx);

                        // Check if the node is a NestedSDFG and if
                        // it should be visited
                        if (!(node.data.node.attributes.is_collapsed ||
                              ((ctx as any).lod && ppp >= SDFV.NODE_LOD)) &&
                            node instanceof NestedSDFG
                        ) {
                            this.recursivelyShadeSDFG(
                                node.data.graph, ctx, ppp, visibleRect
                            );
                        }
                    });
                }
            }
        });
    }

    public refresh(): void {
        this.draw();
        this.renderer.draw_async();
    }

    public getDiffText(): string {
        return this.diffText;
    }

    public getDiffRange(): number {
        return this.diffRange;
    }

    public setDiffThreshold(diffThreshold: number): void {
        this.diffThreshold = diffThreshold;
    }

    public setDiffText(diffText: string): void {
        this.diffText = diffText;
    }

    public setDiffRange(diffRange: number): void {
        this.diffRange = diffRange;
    }

}
