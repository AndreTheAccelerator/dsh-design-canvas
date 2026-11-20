    const CSS_TEXT = `
.dc-app { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; box-sizing: border-box; font-size: 12px; line-height: 1.3; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); overflow: hidden; }
.dc-app * { box-sizing: border-box; }
.dc-header { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; min-width: 0; padding: 5px 8px; background: var(--dsw-alias-bg-layer-1); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dc-head-main { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; overflow: hidden; }
.dc-board { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
.dc-version { flex: 0 0 auto; font-size: 10px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-radius: 4px; padding: 0 4px; }
.dc-status { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dc-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: var(--dsw-alias-state-idle-primary); }
.dc-dot-synced { background: var(--dsw-alias-state-success-primary); }
.dc-dot-saving { background: var(--dsw-alias-state-warn-primary); }
.dc-dot-offline { background: var(--dsw-alias-state-error-primary); }
.dc-dot-revising { background: var(--dsw-alias-brand-primary); }
.dc-retry { border: none; background: transparent; color: var(--dsw-alias-brand-primary); font-size: 10px; cursor: pointer; padding: 0 2px; text-decoration: underline; }
.dc-head-actions { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; }
.dc-zoom-group { display: inline-flex; align-items: center; gap: 1px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 1px; background: var(--dsw-alias-bg-base); }
.dc-zoom-label { border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10px; min-width: 30px; padding: 1px 2px; cursor: pointer; font-variant-numeric: tabular-nums; }
.dc-zoom-label:hover { color: var(--dsw-alias-label-primary); }
.dc-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; flex: 0 0 auto; padding: 3px 8px; background: var(--dsw-alias-bg-layer-1); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dc-tool-group { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }
.dc-spacer { flex: 1 1 auto; }
.dc-tool { display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; white-space: nowrap; }
.dc-tool:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dc-tool.dc-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-border-l1); }
.dc-tool:disabled { opacity: 0.4; cursor: default; }
.dc-ibtn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dc-ibtn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dc-ibtn.dc-active { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.dc-ibtn:disabled { opacity: 0.4; cursor: default; }
.dc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 22px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 11px; cursor: pointer; white-space: nowrap; }
.dc-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dc-btn:disabled { opacity: 0.45; cursor: default; }
.dc-btn-primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: var(--dsw-alias-bg-base); font-weight: 600; }
.dc-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); opacity: 0.88; }
.dc-btn-wide { width: 100%; }
.dc-banner { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; padding: 3px 8px; font-size: 11px; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dc-banner-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-banner-close { border: none; background: transparent; color: inherit; cursor: pointer; padding: 0 2px; }
.dc-body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.dc-left { display: flex; flex-direction: column; flex: 0 0 150px; width: 150px; min-height: 0; background: var(--dsw-alias-bg-layer-1); border-right: 1px solid var(--dsw-alias-border-l1); }
.dc-right { display: flex; flex-direction: column; flex: 0 0 172px; width: 172px; min-height: 0; background: var(--dsw-alias-bg-layer-1); border-left: 1px solid var(--dsw-alias-border-l1); overflow: auto; }
.dc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; flex: 0 0 auto; padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary); }
.dc-tree { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 3px; display: flex; flex-direction: column; gap: 1px; }
.dc-tree-group { display: flex; flex-direction: column; gap: 1px; margin-bottom: 4px; }
.dc-tree-ab { display: flex; align-items: center; gap: 4px; width: 100%; padding: 3px 4px; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 500; cursor: pointer; text-align: left; }
.dc-tree-ab:hover { background: var(--dsw-alias-bg-layer-2); }
.dc-tree-ab.dc-sel { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dc-tree-row { display: flex; align-items: center; gap: 3px; padding: 2px 3px 2px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dc-tree-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dc-tree-row.dc-sel { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dc-tree-row.dc-drop-into, .dc-tree-ab.dc-drop-into { outline: 1px dashed var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dc-tree-caret { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 14px; height: 14px; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dc-tree-caret:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.dc-tree-caret:disabled { opacity: 0.3; cursor: default; }
.dc-layer-frame { overflow: visible; }
.dc-layer-auto { cursor: grab; }
.dc-geo-note { font-size: 10px; line-height: 1.35; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dc-tree-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-tree-meta { flex: 0 0 auto; font-size: 9px; color: var(--dsw-alias-label-secondary); opacity: 0.8; }
.dc-tree-type { display: inline-flex; flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dc-eye { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 16px; height: 16px; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dc-eye:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.dc-eye.dc-off { opacity: 0.45; }
.dc-badge { flex: 0 0 auto; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; background: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-bg-base); font-size: 9px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.dc-panel-foot { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; padding: 3px 4px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dc-muted { color: var(--dsw-alias-label-secondary); font-size: 11px; opacity: 0.85; }
.dc-pad { padding: 8px; }
.dc-canvas { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base); touch-action: none; }
.dc-canvas.dc-gesture-active { user-select: none; }
.dc-canvas.dc-space-pan { cursor: grab; }
.dc-canvas.dc-panning { cursor: grabbing; user-select: none; }
.dc-canvas.dc-drag-over { outline: 2px dashed var(--dsw-alias-brand-primary); outline-offset: -3px; }
.dc-stage { position: absolute; left: 0; top: 0; min-width: 0; min-height: 0; transform-origin: 0 0; will-change: transform; pointer-events: none; }
.dc-board-wrap { position: absolute; display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
.dc-file-input { display: none; }
.dc-board-label { display: flex; align-items: baseline; gap: 8px; padding: 0 2px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dc-board-name { font-weight: 600; color: var(--dsw-alias-label-primary); }
.dc-board-size { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dc-board-frame { position: relative; background: #ffffff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--dsw-alias-border-l1); }
.dc-board-frame.dc-board-frame-selected { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14), 0 0 0 1px var(--dsw-alias-brand-primary); }
.dc-board-inner { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.dc-layer { position: absolute; margin: 0; padding: 0; overflow: hidden; user-select: none; }
.dc-layer-text { display: block; overflow: hidden; word-break: break-word; white-space: pre-wrap; }
.dc-comment-mode .dc-layer { cursor: crosshair; }
.dc-gesture-active .dc-layer { cursor: default; }
.dc-sel-box { position: absolute; z-index: 20; box-sizing: border-box; border: 1px solid var(--dsw-alias-brand-primary); pointer-events: none; }
.dc-sel-handle { position: absolute; z-index: 21; width: 8px; height: 8px; box-sizing: border-box; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-brand-primary); border-radius: 2px; pointer-events: auto; }
.dc-pin { position: absolute; z-index: 25; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; border: 1px solid var(--dsw-alias-bg-base); background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); font-size: 10px; font-weight: 700; line-height: 1; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; box-sizing: border-box; }
.dc-pin:hover { opacity: 0.9; }
.dc-composer { position: absolute; z-index: 40; width: 260px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); }
.dc-composer-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-composer-error { font-size: 10px; color: var(--dsw-alias-state-error-primary); }
.dc-composer-actions { display: flex; justify-content: flex-end; gap: 4px; }
.dc-textarea { width: 100%; min-height: 56px; resize: vertical; padding: 4px 5px; font: inherit; font-size: 11px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; box-sizing: border-box; }
.dc-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dc-section { display: flex; flex-direction: column; gap: 5px; padding: 6px 7px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dc-section-title { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dsw-alias-label-secondary); }
.dc-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.dc-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.dc-field { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1 1 auto; }
.dc-field-col { flex-direction: column; align-items: stretch; gap: 3px; }
.dc-field-label { flex: 0 0 auto; min-width: 12px; font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dc-input { width: 100%; min-width: 0; height: 20px; padding: 0 4px; font: inherit; font-size: 11px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; box-sizing: border-box; }
.dc-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dc-input::-webkit-outer-spin-button, .dc-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.dc-num { text-align: right; }
.dc-select { padding-right: 2px; }
.dc-swatch { flex: 0 0 auto; width: 20px; height: 20px; padding: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; background: transparent; cursor: pointer; }
.dc-swatch::-webkit-color-swatch-wrapper { padding: 1px; }
.dc-swatch::-webkit-color-swatch { border: none; border-radius: 2px; }
.dc-seg { display: flex; flex: 1 1 auto; min-width: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; }
.dc-seg-btn { flex: 1 1 0; min-width: 0; height: 19px; padding: 0; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10px; cursor: pointer; }
.dc-seg-btn.dc-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dc-comment { display: flex; flex-direction: column; gap: 3px; padding: 4px 5px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); }
.dc-comment.dc-resolved { opacity: 0.6; }
.dc-comment-text { font-size: 11px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; word-break: break-word; }
.dc-comment-meta { display: flex; align-items: center; gap: 5px; font-size: 9px; color: var(--dsw-alias-label-secondary); }
.dc-comment-status { text-transform: uppercase; letter-spacing: 0.04em; }
.dc-comment-actions { display: flex; align-items: center; gap: 6px; }
.dc-link { padding: 0; border: none; background: transparent; color: var(--dsw-alias-brand-primary); font-size: 10px; cursor: pointer; }
.dc-link:hover { text-decoration: underline; }
.dc-link.dc-danger { color: var(--dsw-alias-state-error-primary); }
.dc-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 16px; text-align: center; }
.dc-center-text { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); max-width: 260px; overflow-wrap: anywhere; }
.dc-center-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); max-width: 260px; overflow-wrap: anywhere; }
.dc-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); animation: dc-spin 0.9s linear infinite; }
@keyframes dc-spin { to { transform: rotate(360deg); } }
.dc-fallback { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; height: 100%; padding: 16px; box-sizing: border-box; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }
.dc-fallback-title { font-size: 13px; font-weight: 600; }
.dc-fallback-text { font-size: 11px; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
.dc-open-btn { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 24px; height: 24px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.dc-open-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dc-open-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
`

