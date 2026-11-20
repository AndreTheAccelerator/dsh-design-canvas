    /* ------------------------------------------------------------------------------------------
     * Export UI
     *
     * Registers the export entry points in the shell:
     *   - toolbar button ("Export") through EXTENSIONS.toolbar
     *   - the export dialog through EXTENSIONS.appPanels
     *   - a keyboard shortcut (Ctrl/Cmd+Shift+E) through EXTENSIONS.keys
     *
     * A part may own CSS: keep a local `const EXPORT_CSS = \`...\`` here and render it with a
     * <style> element inside the dialog, so the shared 42-css.js stays one author's file.
     * ---------------------------------------------------------------------------------------- */
