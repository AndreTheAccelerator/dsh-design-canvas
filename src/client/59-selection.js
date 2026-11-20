    /* ------------------------------------------------------------------------------------------
     * Selection tools (multi-select UI)
     *
     * Marquee overlay, measurement readout while dragging, and the selection bar buttons
     * (group / ungroup / align / distribute / arrange) registered through EXTENSIONS.selection.
     * The selection state itself lives in `useEditor` (70-editor.js); these entries read it from
     * the extension context and emit ops through `editor.actions`.
     * ---------------------------------------------------------------------------------------- */
