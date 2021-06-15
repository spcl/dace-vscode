class VSCodeRenderer extends daceSDFGRenderer {

    bpIndicator;

    constructor(sdfg, container, on_mouse_event = null, user_transform = null,
        debug_draw = false, background = null) {

        super(sdfg, container, on_mouse_event, user_transform,
            debug_draw, background);

        this.bpIndicator = new BreakpointIndicator(this);
    }

    draw(dt) {
        super.draw(dt);
        this.bpIndicator.draw();
    }

    on_mouse_event(event, comp_x_func, comp_y_func, evtype = "other") {
        super.on_mouse_event(event, comp_x_func, comp_y_func, evtype);
        this.bpIndicator.handle_mouse_event(event, comp_x_func,
            comp_y_func, evtype);
    }
}