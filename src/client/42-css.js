    const CSS_TEXT = `
.dc-app { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; box-sizing: border-box; container-type: inline-size; container-name: dcpane; font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-base, #ffffff); overflow: hidden; }
.dc-app * { box-sizing: border-box; }
.dc-app :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: 1px; }
.dc-app ::-webkit-scrollbar { width: 8px; height: 8px; }
.dc-app ::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2, #d4d6dc); border-radius: 4px; }
.dc-app ::-webkit-scrollbar-track { background: transparent; }

/* ------------------------------------------------------------------ header */
.dc-header { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; min-width: 0; height: 40px; padding: 0 8px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-head-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
.dc-head-actions { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.dc-name { flex: 0 1 auto; min-width: 40px; max-width: 220px; height: 26px; padding: 0 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary, #1a1c21); font: inherit; font-size: 13px; font-weight: 600; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
.dc-name-input { display: block; flex: 0 1 auto; width: 180px; max-width: 50%; height: 26px; padding: 0 8px; border: 1px solid var(--dsw-alias-brand-primary, #3b82f6); border-radius: 6px; background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1a1c21); font: inherit; font-size: 13px; font-weight: 600; }
.dc-version { flex: 0 0 auto; height: 18px; padding: 0 5px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-secondary, #6b7280); font-size: 11px; line-height: 18px; font-variant-numeric: tabular-nums; }
.dc-status { display: inline-flex; align-items: center; gap: 6px; flex: 0 1 auto; min-width: 0; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); white-space: nowrap; }
.dc-status-label { overflow: hidden; text-overflow: ellipsis; }
.dc-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex: 0 0 auto; background: var(--dsw-alias-state-idle-primary, #9ca3af); }
.dc-dot-synced { background: var(--dsw-alias-state-success-primary, #22c55e); }
.dc-dot-saving { background: var(--dsw-alias-state-warn-primary, #f59e0b); }
.dc-dot-offline { background: var(--dsw-alias-state-error-primary, #ef4444); }
.dc-dot-revising { background: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-retry { min-height: 20px; padding: 0 4px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-brand-primary, #3b82f6); font: inherit; font-size: 11px; cursor: pointer; text-decoration: underline; }
.dc-zoom-group { display: inline-flex; align-items: center; gap: 2px; padding: 1px; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 6px; background: var(--dsw-alias-bg-base, #ffffff); }
.dc-zoom-label { min-width: 44px; height: 22px; padding: 0 2px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px; font-variant-numeric: tabular-nums; cursor: pointer; }

/* ------------------------------------------------------------------ toolbar */
.dc-toolbar { display: flex; align-items: center; flex-wrap: nowrap; gap: 4px; flex: 0 0 auto; min-width: 0; height: 38px; padding: 0 8px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.dc-toolbar::-webkit-scrollbar { display: none; }
.dc-tool-group { display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; min-width: 0; }
.dc-toolbar-view { position: sticky; right: 0; flex: 0 0 auto; padding-left: 6px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); box-shadow: -8px 0 12px -8px rgba(15, 23, 42, 0.18); }
.dc-toolbar-divider { flex: 0 0 auto; width: 1px; height: 18px; margin: 0 4px; background: var(--dsw-alias-border-l1, #e3e4e8); }
.dc-spacer { flex: 1 1 auto; min-width: 4px; }
.dc-tool { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 26px; height: 26px; padding: 0 5px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.dc-tool-label { font-size: 11px; }
.dc-tool:active:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
.dc-tool.dc-active { background: var(--dsw-alias-bg-layer-2, #f0f0f2); border-color: var(--dsw-alias-border-l1, #e3e4e8); color: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-tool:disabled { opacity: 0.4; cursor: default; }
.dc-tool-caret { width: 10px; height: 10px; margin-left: -2px; opacity: 0.8; }
.dc-ibtn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; cursor: pointer; }
.dc-ibtn.dc-active { color: var(--dsw-alias-brand-primary, #3b82f6); background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
.dc-ibtn:disabled { opacity: 0.4; cursor: default; }

/* ------------------------------------------------------------------ buttons */
.dc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); color: var(--dsw-alias-label-primary, #1a1c21); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.dc-btn:disabled { opacity: 0.45; cursor: default; }
.dc-btn-primary { background: var(--dsw-alias-brand-primary, #3b82f6); border-color: transparent; color: var(--dsw-alias-bg-base, #ffffff); font-weight: 600; }
.dc-btn-wide { width: 100%; }
.dc-btn-sm { height: 24px; padding: 0 8px; font-size: 11px; }
.dc-btn-ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); }

/* ------------------------------------------------------------------ banner */
.dc-banner { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; min-height: 30px; padding: 4px 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #ef4444); background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-banner-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-banner-close { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }

/* ------------------------------------------------------------------ selection bar */
.dc-selection-bar { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; min-height: 34px; padding: 4px 8px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.dc-selection-bar::-webkit-scrollbar { display: none; }
.dc-sel-chip { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; max-width: 150px; height: 22px; padding: 0 8px; border-radius: 11px; background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); font-size: 11px; font-weight: 600; white-space: nowrap; }
.dc-sel-chip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dc-sel-sep { flex: 0 0 auto; width: 1px; height: 16px; margin: 0 2px; background: var(--dsw-alias-border-l1, #e3e4e8); }

/* ------------------------------------------------------------------ body / panels / splitters */
.dc-body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.dc-panel-slot { display: flex; flex-direction: column; flex: 0 0 auto; min-width: 0; min-height: 0; overflow: hidden; position: relative; }
.dc-panel-slot > .dc-left, .dc-panel-slot > .dc-right { flex: 1 1 auto; width: 100%; min-width: 0; min-height: 0; }
.dc-panel-slot > .dc-left { border-right: 0; }
.dc-panel-slot > .dc-right { border-left: 0; }
.dc-splitter { flex: 0 0 7px; width: 7px; position: relative; padding: 0; border: 0; background: transparent; cursor: col-resize; touch-action: none; align-self: stretch; }
.dc-splitter::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: var(--dsw-alias-border-l1, #e3e4e8); }
.dc-splitter.dc-splitter-active::after { left: 2px; width: 3px; border-radius: 2px; background: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-splitter:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -1px; }
.dc-app.dc-splitting, .dc-app.dc-splitting * { cursor: col-resize; user-select: none; -webkit-user-select: none; }
.dc-rail { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 0 0 28px; width: 28px; padding: 8px 0; background: var(--dsw-alias-bg-layer-1, #f7f7f8); }
.dc-rail-left { border-right: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-rail-right { border-left: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-rail-btn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; }

/* narrow layout: panels become overlay drawers so the canvas keeps the full width */
.dc-body { position: relative; }
.dc-drawer-scrim { position: absolute; inset: 0; z-index: 44; padding: 0; border: 0; background: rgba(15, 23, 42, 0.24); cursor: pointer; }
.dc-drawer { position: absolute; top: 0; bottom: 0; z-index: 45; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--dsw-alias-bg-layer-1, #f7f7f8); box-shadow: 0 0 40px rgba(15, 23, 42, 0.3); }
.dc-drawer-left { left: 0; border-right: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-drawer-right { right: 0; border-left: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-drawer > .dc-left, .dc-drawer > .dc-right { flex: 1 1 auto; width: 100%; min-width: 0; min-height: 0; border: 0; }
.dc-drawer > .dc-right { background: transparent; }

/* ------------------------------------------------------------------ layer tree */
.dc-left { display: flex; flex-direction: column; flex: 0 0 180px; width: 180px; min-height: 0; background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-right: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; flex: 0 0 auto; min-height: 32px; padding: 0 6px 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-panel-head > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-tree { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px; display: flex; flex-direction: column; gap: 1px; }
.dc-tree-group { display: flex; flex-direction: column; gap: 1px; margin-bottom: 6px; }
.dc-tree-ab { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 24px; padding: 3px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; text-align: left; }
.dc-tree-ab.dc-sel { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
.dc-tree-row { display: flex; align-items: center; gap: 4px; min-height: 24px; padding: 2px 4px; border-radius: 4px; cursor: pointer; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-tree-row.dc-sel { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary, #3b82f6); }
.dc-tree-row.dc-drop-into, .dc-tree-ab.dc-drop-into { outline: 1px dashed var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -1px; }
.dc-tree-caret { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; }
.dc-tree-caret:disabled { opacity: 0.3; cursor: default; }
.dc-tree-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-tree-meta { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); opacity: 0.9; font-variant-numeric: tabular-nums; }
.dc-tree-type { display: inline-flex; flex: 0 0 auto; color: var(--dsw-alias-label-secondary, #6b7280); opacity: 0.9; }
.dc-eye { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; }
.dc-eye.dc-off { opacity: 0.45; }
.dc-badge { flex: 0 0 auto; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--dsw-alias-state-warn-primary, #f59e0b); color: var(--dsw-alias-bg-base, #ffffff); font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.dc-panel-foot { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; padding: 4px 6px; border-top: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-muted { color: var(--dsw-alias-label-secondary, #6b7280); font-size: 12px; }
.dc-pad { padding: 8px; }

/* ------------------------------------------------------------------ inspector */
.dc-right { display: flex; flex-direction: column; flex: 0 0 240px; width: 240px; min-height: 0; background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-left: 1px solid var(--dsw-alias-border-l1, #e3e4e8); overflow: auto; }
.dc-section { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dc-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.dc-field { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
.dc-field-col { flex-direction: column; align-items: stretch; gap: 4px; }
.dc-field-label { flex: 0 0 auto; min-width: 14px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); white-space: nowrap; }
.dc-input { width: 100%; min-width: 0; height: 24px; padding: 0 6px; font: inherit; font-size: 11px; color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-base, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 4px; }
.dc-input:focus { border-color: var(--dsw-alias-brand-primary, #3b82f6); outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -1px; }
.dc-input:disabled { opacity: 0.5; }
.dc-input::-webkit-outer-spin-button, .dc-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.dc-num { text-align: right; font-variant-numeric: tabular-nums; }
.dc-select { padding-right: 2px; }
.dc-swatch { flex: 0 0 auto; width: 22px; height: 22px; padding: 0; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 4px; background: transparent; cursor: pointer; }
.dc-swatch::-webkit-color-swatch-wrapper { padding: 1px; }
.dc-swatch::-webkit-color-swatch { border: none; border-radius: 2px; }
.dc-seg { display: flex; flex: 1 1 auto; min-width: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 4px; }
.dc-seg-btn { flex: 1 1 0; min-width: 0; height: 22px; padding: 0 2px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px; cursor: pointer; }
.dc-seg-btn:disabled { opacity: 0.45; cursor: default; background: transparent; }
.dc-seg-btn.dc-active { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); font-weight: 600; }
.dc-geo-note { font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dc-textarea { width: 100%; min-height: 60px; resize: vertical; padding: 6px 7px; font: inherit; font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-base, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 4px; }
.dc-textarea:focus { border-color: var(--dsw-alias-brand-primary, #3b82f6); outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -1px; }

/* ------------------------------------------------------------------ comments */
.dc-comment { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 6px; background: var(--dsw-alias-bg-base, #ffffff); }
.dc-comment.dc-resolved { opacity: 0.6; }
.dc-comment-text { font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-primary, #1a1c21); white-space: pre-wrap; word-break: break-word; }
.dc-comment-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-comment-status { text-transform: uppercase; letter-spacing: 0.04em; }
.dc-comment-actions { display: flex; align-items: center; gap: 8px; }
.dc-link { padding: 0; border: 0; border-radius: 2px; background: transparent; color: var(--dsw-alias-brand-primary, #3b82f6); font: inherit; font-size: 11px; cursor: pointer; }
.dc-link.dc-danger { color: var(--dsw-alias-state-error-primary, #ef4444); }

/* ------------------------------------------------------------------ canvas / stage */
.dc-canvas { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base, #ffffff); touch-action: none; }
.dc-canvas.dc-gesture-active { user-select: none; }
.dc-canvas.dc-space-pan { cursor: grab; }
.dc-canvas.dc-panning { cursor: grabbing; user-select: none; }
.dc-canvas.dc-drag-over { outline: 2px dashed var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -3px; }
.dc-stage { position: absolute; left: 0; top: 0; min-width: 0; min-height: 0; pointer-events: none; }
.dc-board-wrap { position: absolute; display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
.dc-file-input { display: none; }
.dc-board-label { display: flex; align-items: baseline; gap: 8px; padding: 0 2px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-board-name { font-weight: 600; color: var(--dsw-alias-label-primary, #1a1c21); }
.dc-board-size { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; }
.dc-board-frame { position: relative; background: #ffffff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 0 0 1px var(--dsw-alias-border-l1, #e3e4e8); }
.dc-board-frame.dc-board-frame-selected { box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12), 0 0 0 1px var(--dsw-alias-brand-primary, #3b82f6); }
.dc-board-inner { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.dc-layer { position: absolute; margin: 0; padding: 0; overflow: hidden; user-select: none; }
.dc-layer-text { display: block; overflow: hidden; word-break: break-word; white-space: pre-wrap; }
.dc-layer-frame { overflow: visible; }
.dc-layer-auto { cursor: grab; }
.dc-comment-mode .dc-layer { cursor: crosshair; }
.dc-gesture-active .dc-layer { cursor: default; }
.dc-sel-box { position: absolute; z-index: 20; box-sizing: border-box; border: 1px solid var(--dsw-alias-brand-primary, #3b82f6); pointer-events: none; }
.dc-sel-handle { position: absolute; z-index: 21; width: 8px; height: 8px; box-sizing: border-box; background: var(--dsw-alias-bg-base, #ffffff); border: 1px solid var(--dsw-alias-brand-primary, #3b82f6); border-radius: 2px; pointer-events: auto; }
.dc-pin { position: absolute; z-index: 25; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; border: 1px solid var(--dsw-alias-bg-base, #ffffff); background: var(--dsw-alias-brand-primary, #3b82f6); color: var(--dsw-alias-bg-base, #ffffff); font-size: 10px; font-weight: 700; line-height: 1; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }

/* ------------------------------------------------------------------ composer */
.dc-composer { position: absolute; z-index: 40; width: 272px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-overlay, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 8px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2); }
.dc-composer-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1c21); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-cmt-chip-target { align-self: flex-start; max-width: 100%; height: 20px; padding: 0 7px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-secondary, #6b7280); font-size: 11px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-cmt-counter { margin-right: auto; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; }
.dc-cmt-counter-warn { color: var(--dsw-alias-state-warn-primary, #f59e0b); }
.dc-composer-text { min-height: 72px; }
.dc-composer-error { font-size: 11px; color: var(--dsw-alias-state-error-primary, #ef4444); }
.dc-composer-actions { display: flex; justify-content: flex-end; gap: 6px; }

/* ------------------------------------------------------------------ empty / loading / error */
.dc-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 20px; text-align: center; }
.dc-center-icon { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-center-text { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1c21); max-width: 280px; overflow-wrap: anywhere; }
.dc-center-hint { font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary, #6b7280); max-width: 280px; overflow-wrap: anywhere; }
.dc-center-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.dc-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2, #d4d6dc); border-top-color: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-fallback { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; height: 100%; padding: 16px; font-size: 12px; color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-base, #ffffff); }
.dc-fallback-title { font-size: 13px; font-weight: 600; }
.dc-fallback-text { font-size: 12px; color: var(--dsw-alias-state-error-primary, #ef4444); overflow-wrap: anywhere; }
.dc-open-btn { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }

/* ------------------------------------------------------------------ menus */
.dc-menu-host { position: absolute; inset: 0; z-index: 60; }
.dc-menu-scrim { position: absolute; inset: 0; }
.dc-menu { position: absolute; min-width: 204px; max-width: min(280px, calc(100cqw - 16px)); max-height: calc(100cqh - 16px); overflow: auto; padding: 4px; display: flex; flex-direction: column; gap: 1px; background: var(--dsw-alias-bg-overlay, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 8px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2), 0 2px 6px rgba(15, 23, 42, 0.08); }
.dc-menu-label { padding: 6px 8px 2px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 28px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-primary, #1a1c21); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.dc-menu-item:disabled { opacity: 0.45; cursor: default; }
.dc-menu-item.dc-danger { color: var(--dsw-alias-state-error-primary, #ef4444); }
.dc-menu-item-icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 16px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-menu-item.dc-danger .dc-menu-item-icon { color: inherit; }
.dc-menu-item-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-menu-item-hint { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; }
.dc-menu-item-check { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 14px; color: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-menu-sep { height: 1px; margin: 4px; background: var(--dsw-alias-border-l1, #e3e4e8); }
.dc-menu-form { display: flex; align-items: flex-end; gap: 6px; padding: 4px 8px 8px; }
.dc-menu-field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-menu-input { width: 62px; height: 26px; padding: 0 6px; font: inherit; font-size: 11px; color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-base, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 4px; font-variant-numeric: tabular-nums; }
.dc-menu-input:focus { border-color: var(--dsw-alias-brand-primary, #3b82f6); outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -1px; }

/* ------------------------------------------------------------------ dialogs */
.dc-modal-backdrop { position: absolute; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, 0.3); }
.dc-modal { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 340px; max-height: 100%; overflow: auto; padding: 14px; background: var(--dsw-alias-bg-overlay, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 8px; box-shadow: 0 24px 48px rgba(15, 23, 42, 0.28); }
.dc-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dc-modal-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1c21); }
.dc-shortcut-list { display: flex; flex-direction: column; gap: 6px; }
.dc-shortcut-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-shortcut-keys { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.dc-kbd { display: inline-flex; align-items: center; min-height: 18px; padding: 0 5px; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-bottom-width: 2px; border-radius: 4px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }

/* ------------------------------------------------------------------ narrow container adaptations */
@container dcpane (max-width: 560px) {
  .dc-name { max-width: 168px; }
}
@container dcpane (max-width: 500px) {
  .dc-status-label { display: none; }
  .dc-toolbar-secondary { display: none; }
  .dc-name { max-width: 150px; }
  .dc-version { display: none; }
}
@container dcpane (max-width: 380px) {
  .dc-name { max-width: 124px; }
  .dc-toolbar { gap: 2px; }
}

/* hover affordances are for devices that really hover (no sticky touch states) */
@media (hover: hover) and (pointer: fine) {
  .dc-name:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
  .dc-zoom-label:hover { color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
  .dc-tool:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-ibtn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
  .dc-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary, #3b82f6); filter: brightness(0.94); }
  .dc-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-banner-close:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
  .dc-splitter:hover::after { left: 2px; width: 3px; border-radius: 2px; background: var(--dsw-alias-brand-primary, #3b82f6); }
  .dc-rail-btn:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-tree-ab:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-tree-row:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-tree-caret:hover:not(:disabled) { background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-eye:hover { background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-input:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2, #d4d6dc); }
  .dc-seg-btn:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
  .dc-link:hover { text-decoration: underline; }
  .dc-pin:hover { filter: brightness(0.94); }
  .dc-open-btn:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-menu-item:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
}

/* ------------------------------------------------------------------ motion */
@media (prefers-reduced-motion: no-preference) {
  .dc-tool, .dc-ibtn, .dc-btn, .dc-link, .dc-menu-item, .dc-tree-row, .dc-tree-ab, .dc-tree-caret, .dc-eye, .dc-name, .dc-seg-btn, .dc-rail-btn, .dc-banner-close, .dc-zoom-label, .dc-retry, .dc-open-btn, .dc-pin { transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease, opacity 120ms ease; }
  .dc-spinner { animation: dc-spin 0.9s linear infinite; }
  .dc-app.dc-splitting .dc-splitter::after { transition: background-color 120ms ease; }
}
@keyframes dc-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .dc-spinner { animation: none; border-top-color: var(--dsw-alias-brand-primary, #3b82f6); }
}
`
