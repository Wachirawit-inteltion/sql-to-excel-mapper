/* ============================================================================
   sqlmap.flow — turns the parsed model into a 4-lane data-flow diagram.
   One layout drives both the on-page SVG preview and the draw.io (.drawio) XML,
   so what you see is exactly what draw.io opens.
   ========================================================================== */
(function (global) {
  'use strict';

  var LANES = [
    { key: 'src', title: '1. SOURCE TABLES', x: 40, w: 250 },
    { key: 'step', title: '2. CTE / SUB-QUERY', x: 340, w: 300 },
    { key: 'final', title: '3. FINAL SELECT', x: 690, w: 290 },
    { key: 'tgt', title: '4. TARGET TABLE', x: 1090, w: 260 }
  ];
  var TITLE_H = 44, PAD_TOP = 60, GAP = 26, LANE_PAD = 24;
  var H = { src: 66, step: 84, final: 118, tgt: 96 };

  function upper(s) { return String(s || '').toUpperCase(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }
  function slug(s) {
    return String(s || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').toUpperCase();
  }

  /* ------------------------------------------------------------------ layout */
  /* opts.fileIndex — draw only that script's flow; leave it out to draw all */
  function layout(model, opts) {
    var flows = (model && model.flows && model.flows.length) ? model.flows : null;
    if (!flows) return null;
    if (opts && opts.fileIndex !== undefined && opts.fileIndex !== null) {
      flows = flows.filter(function (f, i) {
        return (f.fileIndex === undefined ? i : f.fileIndex) === opts.fileIndex;
      });
      if (!flows.length) return null;
    }
    var multi = flows.length > 1;

    var nodes = [], byKey = {}, edges = [];
    function node(lane, key, label, sub, kind) {
      if (byKey[key]) return byKey[key];
      var n = {
        id: (lane + '_' + slug(key)).slice(0, 60) + '_' + nodes.length,
        lane: lane, key: key, label: label, sub: sub || '', kind: kind || lane
      };
      nodes.push(n); byKey[key] = n;
      return n;
    }
    function link(a, b, label) {
      if (!a || !b || a === b) return;
      var k = a.id + '>' + b.id;
      for (var i = 0; i < edges.length; i++) if (edges[i].k === k) return;
      edges.push({ k: k, from: a, to: b, label: label || '' });
    }

    flows.forEach(function (fl, fi) {
      var tag = multi ? (fl.label || fl.file) : '';
      // step keys are per file so two scripts can use the same CTE name
      function stepKey(name) { return 'step:' + fi + ':' + upper(name); }
      function tableKey(name) { return 'tbl:' + upper(name); }

      (fl.steps || []).forEach(function (st) {
        node('step', stepKey(st.name), (st.inline ? 'SUB-QUERY: ' : 'CTE: ') + st.name, tag, 'step');
      });

      var finalNode = node('final', 'final:' + fi,
        'FINAL SELECT', (multi ? fl.file : (fl.target || '')), 'final');
      finalNode.detail = (fl.columnCount ? fl.columnCount + ' columns' : '') +
        ((fl.main && fl.main.joins > 1) ? ' · ' + (fl.main.joins - 1) + ' joins' : '');

      var tgt = node('tgt', 'tgt:' + upper(fl.target || fl.file),
        fl.target || fl.file, 'Target table', 'tgt');

      (fl.steps || []).forEach(function (st) {
        var me = byKey[stepKey(st.name)];
        (st.inputs || []).forEach(function (inp) {
          if (inp.kind === 'step') {
            link(byKey[stepKey(inp.name)] || node('step', stepKey(inp.name), 'CTE: ' + inp.name, tag, 'step'), me);
          } else {
            link(node('src', tableKey(inp.name), inp.name, inp.schema, 'src'), me);
          }
        });
      });

      ((fl.main && fl.main.inputs) || []).forEach(function (inp) {
        if (inp.kind === 'step') {
          link(byKey[stepKey(inp.name)] || node('step', stepKey(inp.name), 'CTE: ' + inp.name, tag, 'step'), finalNode);
        } else {
          link(node('src', tableKey(inp.name), inp.name, inp.schema, 'src'), finalNode);
        }
      });

      link(finalNode, tgt, 'INSERT / OVERWRITE');
    });

    /* place the nodes lane by lane, each stack centred vertically */
    var byLane = {};
    LANES.forEach(function (l) { byLane[l.key] = []; });
    nodes.forEach(function (n) { byLane[n.lane].push(n); });

    var maxH = 0;
    LANES.forEach(function (l) {
      var list = byLane[l.key], h = H[l.key];
      var total = list.length ? list.length * h + (list.length - 1) * GAP : 0;
      maxH = Math.max(maxH, total);
    });
    var laneH = Math.max(maxH + PAD_TOP + LANE_PAD, 260);

    LANES.forEach(function (l) {
      var list = byLane[l.key], h = H[l.key];
      var total = list.length ? list.length * h + (list.length - 1) * GAP : 0;
      var y = PAD_TOP + Math.max(0, (laneH - PAD_TOP - LANE_PAD - total) / 2);
      list.forEach(function (n) {
        n.w = l.w - 2 * LANE_PAD;
        n.h = h;
        n.x = l.x + LANE_PAD;
        n.y = y;
        n.cx = n.x + n.w / 2;
        n.cy = n.y + n.h / 2;
        y += h + GAP;
      });
    });

    /* orthogonal routing: every edge entering a lane gets its own vertical
       corridor in the gap in front of that lane, so lines never overlap and
       never cut through the boxes of the lane in between */
    var laneIndex = {};
    LANES.forEach(function (l, i) { laneIndex[l.key] = i; });
    var byLaneIn = {};
    edges.forEach(function (e) {
      var k = e.to.lane;
      (byLaneIn[k] = byLaneIn[k] || []).push(e);
    });
    Object.keys(byLaneIn).forEach(function (k) {
      var list = byLaneIn[k];
      var di = laneIndex[k];
      var prev = di > 0 ? LANES[di - 1] : null;
      var corridorStart = prev ? prev.x + prev.w : LANES[di].x - 40;
      var corridorEnd = LANES[di].x;
      list.sort(function (a, b) { return a.to.cy - b.to.cy || a.from.cy - b.from.cy; });
      list.forEach(function (e, i) {
        var start = Math.max(corridorStart, e.from.x + e.from.w);
        var span = Math.max(corridorEnd - start, 16);
        var step = span / (list.length + 1);
        e.midX = Math.round(start + step * (i + 1));
        e.straight = Math.abs(e.from.cy - e.to.cy) < 2 && laneIndex[e.from.lane] === di - 1;
      });
    });

    var width = LANES[LANES.length - 1].x + LANES[LANES.length - 1].w + 40;
    return { lanes: LANES, nodes: nodes, edges: edges, width: width, laneH: laneH, height: laneH + 80 };
  }

  /* --------------------------------------------------------------------- svg */
  var SVG_THEME = {
    bg: 'transparent', lane: '#1B222A', laneLine: '#2E3843', laneText: '#8A968D',
    src: { fill: '#1E2C34', stroke: '#5EA3BE', text: '#CFE9F4' },
    step: { fill: '#2A2438', stroke: '#9C86C4', text: '#E6DDF6' },
    final: { fill: '#22301B', stroke: '#8FC34A', text: '#DCEFC2' },
    tgt: { fill: '#33261C', stroke: '#D9A441', text: '#F6E3C2' },
    edge: '#6E7A70', edgeHot: '#8FC34A', label: '#8A968D'
  };

  function path(e) {
    var x1 = e.from.x + e.from.w, y1 = e.from.cy, x2 = e.to.x, y2 = e.to.cy;
    if (e.straight) return 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2;
    var m = e.midX;
    return 'M' + x1 + ' ' + y1 + ' L' + m + ' ' + y1 + ' L' + m + ' ' + y2 + ' L' + x2 + ' ' + y2;
  }

  function toSvg(lay) {
    if (!lay) return '';
    var s = '<svg viewBox="0 0 ' + lay.width + ' ' + lay.height + '" xmlns="http://www.w3.org/2000/svg" ' +
      'font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">';
    s += '<defs><marker id="ar" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto">' +
      '<path d="M0,0 L8,3 L0,6 z" fill="' + SVG_THEME.edge + '"/></marker>' +
      '<marker id="arh" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto">' +
      '<path d="M0,0 L8,3 L0,6 z" fill="' + SVG_THEME.edgeHot + '"/></marker></defs>';

    lay.lanes.forEach(function (l) {
      s += '<rect x="' + l.x + '" y="20" width="' + l.w + '" height="' + lay.laneH +
        '" rx="4" fill="' + SVG_THEME.lane + '" stroke="' + SVG_THEME.laneLine + '"/>';
      s += '<line x1="' + l.x + '" y1="' + (20 + TITLE_H) + '" x2="' + (l.x + l.w) +
        '" y2="' + (20 + TITLE_H) + '" stroke="' + SVG_THEME.laneLine + '"/>';
      s += '<text x="' + (l.x + 14) + '" y="' + (20 + 27) + '" font-size="13" font-weight="600" fill="' +
        SVG_THEME.laneText + '" letter-spacing="0.08em">' + esc(l.title) + '</text>';
    });

    lay.edges.forEach(function (e) {
      var hot = e.from.lane === 'final';
      s += '<path d="' + path(e) + '" fill="none" stroke="' + (hot ? SVG_THEME.edgeHot : SVG_THEME.edge) +
        '" stroke-width="' + (hot ? 2 : 1.4) + '" marker-end="url(#' + (hot ? 'arh' : 'ar') + ')"/>';
      if (e.label) {
        var lx = (e.from.x + e.from.w + e.to.x) / 2;
        s += '<text x="' + lx + '" y="' + (e.to.cy - 10) + '" text-anchor="middle" font-size="10" fill="' +
          SVG_THEME.label + '">' + esc(e.label) + '</text>';
      }
    });

    lay.nodes.forEach(function (n) {
      var c = SVG_THEME[n.kind] || SVG_THEME.src;
      s += '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h +
        '" rx="4" fill="' + c.fill + '" stroke="' + c.stroke + '" stroke-width="1.5"/>';
      var lines = [];
      lines.push({ t: n.label, size: 12, weight: 600, fill: c.text });
      if (n.sub) lines.push({ t: n.sub, size: 10, weight: 400, fill: SVG_THEME.laneText });
      if (n.detail) lines.push({ t: n.detail, size: 10, weight: 400, fill: SVG_THEME.laneText });
      var startY = n.cy - ((lines.length - 1) * 14) / 2 + 4;
      lines.forEach(function (ln, i) {
        var t = ln.t.length > 30 ? ln.t.slice(0, 29) + '…' : ln.t;
        s += '<text x="' + n.cx + '" y="' + (startY + i * 14) + '" text-anchor="middle" font-size="' +
          ln.size + '" font-weight="' + ln.weight + '" fill="' + ln.fill + '">' + esc(t) + '</text>';
      });
    });
    return s + '</svg>';
  }

  /* ----------------------------------------------------------------- drawio */
  var XML_STYLE = {
    src: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=12;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;verticalAlign=middle;',
    step: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;align=center;verticalAlign=middle;',
    final: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;align=center;verticalAlign=middle;fontStyle=1;',
    tgt: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=12;fillColor=#e1d5e7;strokeColor=#9673a6;fontStyle=1;verticalAlign=middle;'
  };

  function toXml(lay, title) {
    if (!lay) return '';
    var cells = '';
    lay.lanes.forEach(function (l, i) {
      cells += '\n        <mxCell id="lane_' + i + '" value="' + esc(l.title) +
        '" style="swimlane;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#b1b1b1;fontStyle=1;fontSize=13;startSize=' +
        TITLE_H + ';horizontal=1;" vertex="1" parent="1">' +
        '\n          <mxGeometry x="' + l.x + '" y="20" width="' + l.w + '" height="' + lay.laneH + '" as="geometry" />' +
        '\n        </mxCell>';
    });

    lay.nodes.forEach(function (n) {
      var laneIdx = 0;
      lay.lanes.forEach(function (l, i) { if (l.key === n.lane) laneIdx = i; });
      var lane = lay.lanes[laneIdx];
      var label = esc(n.label);
      if (n.sub) label += '&#xa;' + esc(n.sub);
      if (n.detail) label += '&#xa;' + esc(n.detail);
      cells += '\n        <mxCell id="' + n.id + '" value="' + label + '" style="' +
        (XML_STYLE[n.kind] || XML_STYLE.src) + '" vertex="1" parent="lane_' + laneIdx + '">' +
        '\n          <mxGeometry x="' + (n.x - lane.x) + '" y="' + (n.y - 20) + '" width="' + n.w +
        '" height="' + n.h + '" as="geometry" />' +
        '\n        </mxCell>';
    });

    lay.edges.forEach(function (e, i) {
      var hot = e.from.lane === 'final';
      var style = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;' +
        'entryX=0;entryY=0.5;entryDx=0;entryDy=0;jumpStyle=arc;' +
        (hot ? 'strokeWidth=2;strokeColor=#82b366;' : 'strokeColor=#7f8c8d;');
      cells += '\n        <mxCell id="edge_' + i + '" value="' + esc(e.label) + '" style="' + style +
        '" edge="1" parent="1" source="' + e.from.id + '" target="' + e.to.id + '">' +
        '\n          <mxGeometry relative="1" as="geometry">' +
        '\n            <Array as="points"><mxPoint x="' + e.midX + '" y="' + e.from.cy + '" />' +
        '<mxPoint x="' + e.midX + '" y="' + e.to.cy + '" /></Array>' +
        '\n          </mxGeometry>' +
        '\n        </mxCell>';
    });

    return '<mxfile host="app.diagrams.net" modified="' + new Date().toISOString() +
      '" agent="sql-to-mapping" version="21.0.0" type="device">' +
      '\n  <diagram id="sql_data_flow" name="' + esc(title || 'Data Flow') + '">' +
      '\n    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1100" math="0" shadow="0">' +
      '\n      <root>' +
      '\n        <mxCell id="0" />' +
      '\n        <mxCell id="1" parent="0" />' + cells +
      '\n      </root>' +
      '\n    </mxGraphModel>' +
      '\n  </diagram>' +
      '\n</mxfile>';
  }

  var api = { layout: layout, toSvg: toSvg, toXml: toXml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SqlMapFlow = api;
})(typeof window !== 'undefined' ? window : globalThis);
