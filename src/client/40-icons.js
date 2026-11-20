    const ICON_PATHS = {
      plus: ['M8 3v10', 'M3 8h10'],
      minus: ['M3 8h10'],
      fit: ['M3 6V3h3', 'M13 6V3h-3', 'M3 10v3h3', 'M13 10v3h-3'],
      comment: ['M2.5 3.5h11v7.5h-6l-3.5 2.5v-2.5h-1.5z'],
      close: ['M4 4l8 8', 'M12 4l-8 8'],
      trash: ['M3.5 4.5h9', 'M6.5 4.5V3h3v1.5', 'M5 4.5l.6 8h4.8l.6-8', 'M7 7v3.5', 'M9 7v3.5'],
      up: ['M8 12.5V4', 'M4.5 7.5L8 4l3.5 3.5'],
      down: ['M8 3.5V12', 'M4.5 8.5L8 12l3.5-3.5'],
      eye: ['M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z'],
      eyeOff: ['M2 2l12 12', 'M6.5 4.2A7.6 7.6 0 0 1 8 3.8c4 0 6.5 4.2 6.5 4.2a12 12 0 0 1-2.3 2.6', 'M4.2 5.1A12 12 0 0 0 1.5 8S4 12.2 8 12.2c.9 0 1.7-.2 2.4-.5'],
      chevronLeft: ['M10 4L6 8l4 4'],
      chevronRight: ['M6 4l4 4-4 4'],
      chevronDown: ['M4 6l4 4 4-4'],
      copy: ['M5.5 4.5h8v8h-8z', 'M2.5 11.5v-8h8'],
      undo: ['M5 6H10.5a3.5 3.5 0 1 1 0 7H7', 'M7.5 3.5L5 6l2.5 2.5'],
      redo: ['M11 6H5.5a3.5 3.5 0 1 0 0 7H9', 'M8.5 3.5L11 6 8.5 8.5'],
      layers: ['M8 2.5l5.5 3L8 8.5 2.5 5.5 8 2.5z', 'M2.5 8.5L8 11.5l5.5-3'],
      inspector: ['M2.5 5.5h11', 'M2.5 10.5h11', 'M6 3.5v4', 'M10 8.5v4'],
      frame: ['M4.5 2v12', 'M11.5 2v12', 'M2 4.5h12', 'M2 11.5h12'],
      canvas: ['M2.5 3.5h11v9h-11z', 'M2.5 7h11', 'M6 7v5.5'],
      rect: ['M2.5 3.5h11v9h-11z'],
      ellipse: ['M8 3.5c3.3 0 6 2 6 4.5s-2.7 4.5-6 4.5-6-2-6-4.5S4.7 3.5 8 3.5z'],
      text: ['M3.5 4h9', 'M8 4v9', 'M5.5 13h5'],
      image: ['M2.5 3.5h11v9h-11z', 'M2.5 10.5l3.2-3.2 2.3 2.3 2.5-2.5 3 3'],
      send: ['M14 2L2 7l4.5 2L9 13.5 14 2z', 'M6.5 9L14 2'],
      retry: ['M12.5 8a4.5 4.5 0 1 1-1.6-3.4', 'M12.5 3v3h-3'],
      dot: ['M8 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
    }

    function Glyph(props) {
      const spec = ICON_PATHS[props.name] || ICON_PATHS.dot
      return h(
        'svg',
        {
          width: props.size || 14,
          height: props.size || 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { flex: '0 0 auto', display: 'block' },
        },
        spec.map(function (path, index) {
          return h('path', { key: index, d: path })
        }),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Styles (chrome only; theme tokens only)
     * ---------------------------------------------------------------------------------------- */

