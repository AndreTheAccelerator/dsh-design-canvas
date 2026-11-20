    /* ------------------------------------------------------------------------------------------
     * Export to code
     *
     * Pure functions that turn the document into source text: HTML + CSS, React (JSX), SVG and a
     * standalone JSON snapshot, plus a raster fallback (SVG -> canvas -> PNG) that keeps the
     * artboard vector-crisp at any scale. No DOM writes here: the dialog component in
     * `44-export-ui.js` owns the UI, and the shell wires it through EXTENSIONS (00-core.js).
     *
     * Contract: every renderer takes (doc, options) and returns a string; unknown layer types
     * degrade to a neutral box instead of throwing.
     * ---------------------------------------------------------------------------------------- */
