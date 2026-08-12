/* ============================================================================
   sqlmap.builder — renders the parsed model into the mapping workbook
   (Document Control / Data Flow / Summary / V1 / TGT-Sample Data)
   ========================================================================== */
(function (global) {
  'use strict';

  var C = {
    banner: 'FF92D050', bannerDark: 'FF00B050', colHead: 'FFCCFF99',
    purple: 'FFB3A2C7', purpleDeep: 'FF604A7B', purpleSoft: 'FFCCC1DA',
    grey: 'FFD9D9D9', blueSoft: 'FFB9CDE5', cyan: 'FF93CDDD', cyanSoft: 'FFDBEEF3',
    peach: 'FFFDEADA', rose: 'FFE6B9B8', white: 'FFFFFFFF', black: 'FF000000',
    link: 'FF0000FF', teal: 'FF388194'
  };

  function bd(style) {
    return { top: { style: style }, left: { style: style }, right: { style: style }, bottom: { style: style } };
  }

  function put(ws, addr, value, st) {
    var cell = ws.getCell(addr);
    if (value !== undefined && value !== null && value !== '') cell.value = value;
    st = st || {};
    cell.font = {
      name: 'Calibri', size: st.size || 9, bold: !!st.bold,
      color: { argb: st.color || C.black }
    };
    if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
    cell.alignment = {
      horizontal: st.h || 'left', vertical: st.v || 'top', wrapText: st.wrap !== false
    };
    if (st.border) cell.border = bd(st.border);
    if (st.numFmt) cell.numFmt = st.numFmt;
    return cell;
  }

  function fillRange(ws, row, c1, c2, argb) {
    for (var c = c1; c <= c2; c++) {
      ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } };
    }
  }

  function widths(ws, spec) {
    Object.keys(spec).forEach(function (k) { ws.getColumn(k).width = spec[k]; });
  }

  function A(n) { // 1 -> A
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }

  function toDate(v) {
    if (!v) return null;
    var p = String(v).split('-');
    if (p.length !== 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0);
  }

  var DFMT = 'd-mmm-yy';

  /* ------------------------------------------------------------------ 1 */
  function sheetDocControl(wb, meta) {
    var ws = wb.addWorksheet('Document Control');
    widths(ws, { A: 9, B: 18.63, C: 29.38, D: 24.38, E: 28.13, F: 27.88, G: 29.25, H: 8.38 });
    ws.getRow(1).height = 26.25; ws.getRow(3).height = 39.75;
    ws.getRow(4).height = 26.25; ws.getRow(5).height = 26.25; ws.getRow(6).height = 26.25;

    var head = { size: 20, fill: C.purple, color: C.white, border: 'thin', h: 'center', v: 'center' };
    var body = { size: 10, fill: C.grey, border: 'thin' };

    ws.mergeCells('A1:C1'); ws.mergeCells('D1:F1');
    put(ws, 'A1', 'Work Sheet Name', head);
    put(ws, 'D1', 'Description', Object.assign({}, head, { h: 'left' }));

    ws.mergeCells('A2:C2'); ws.mergeCells('D2:F2');
    put(ws, 'A2', 'Document Control', body);
    put(ws, 'D2', 'For record document change history', body);

    ws.mergeCells('A3:C3'); ws.mergeCells('D3:F3');
    put(ws, 'A3', 'Summary', body);
    put(ws, 'D3', 'Contain : \n1. Data Source Summary \n2. Target Table data loading method\n3. Data Flow Diagram', body);

    ws.mergeCells('A4:G4');
    put(ws, 'A4', 'Change History', { size: 20, h: 'center', v: 'center', border: 'thin' });

    ws.mergeCells('A5:A6'); ws.mergeCells('B5:C5'); ws.mergeCells('D5:D6');
    ws.mergeCells('F5:F6'); ws.mergeCells('G5:G6');
    put(ws, 'A5', 'No.', head);
    put(ws, 'B5', 'Work Sheet', head);
    put(ws, 'B6', 'Name', head);
    put(ws, 'C6', 'Description', head);
    put(ws, 'D5', 'Designer Name', head);
    put(ws, 'E5', 'Project', head);
    put(ws, 'E6', 'Description', head);
    put(ws, 'F5', 'UCR# or Defect#', head);
    put(ws, 'G5', 'Last Updated Date', head);

    var line = { size: 10, border: 'hair' };
    (meta.history || []).forEach(function (h, i) {
      var r = 7 + i;
      put(ws, 'A' + r, i + 1, Object.assign({}, line, { h: 'center' }));
      put(ws, 'B' + r, h.sheet || 'All', line);
      put(ws, 'C' + r, h.description || 'Initial Version', line);
      put(ws, 'D' + r, h.designer || meta.designer, line);
      put(ws, 'E' + r, h.project || meta.project, line);
      put(ws, 'F' + r, h.ucr || meta.ucr, line);
      put(ws, 'G' + r, toDate(h.date || meta.updatedDate), Object.assign({}, line, { numFmt: DFMT }));
    });
    return ws;
  }

  /* ------------------------------------------------------------------ 2 */
  function sheetDataFlow(wb, meta) {
    var ws = wb.addWorksheet('Data Flow');
    ws.getColumn('A').width = 1.25;
    for (var c = 2; c <= 44; c++) ws.getColumn(c).width = 8.88;
    ws.mergeCells('A1:AR1');
    put(ws, 'A1', 'Data Flow Diagram', { size: 22, bold: true, fill: C.bannerDark, color: C.white, h: 'left' });
    put(ws, 'B3', 'วางรูป Data Flow Diagram ที่นี่  /  paste the data-flow diagram here',
      { size: 10, color: 'FF7F7F7F' });
    return ws;
  }

  /* ------------------------------------------------------------------ 3 */
  function sheetSummary(wb, model, meta) {
    var ws = wb.addWorksheet('Summary');
    widths(ws, {
      A: 3.13, B: 6.25, C: 11.88, D: 9.13, E: 19.63, F: 12.63, G: 13.13, H: 17.38,
      I: 13.63, J: 10.13, K: 28.75, L: 34.13, M: 27, N: 17.13, O: 13, P: 16.25,
      Q: 14.75, R: 14.75, S: 22.25
    });
    var banner = { size: 16, bold: true, fill: C.banner, color: C.white };
    var th = { size: 8, bold: true, fill: C.colHead, border: 'hair', h: 'center', v: 'center' };
    var td = { size: 8, border: 'hair' };
    var date = toDate(meta.updatedDate);
    var r = 1;

    put(ws, 'A1', 'Table Name : ' + (meta.tableName || ''), Object.assign({}, banner, { wrap: false }));
    ws.getRow(1).height = 22.15;
    fillRange(ws, 1, 1, 15, C.banner);
    r = 2;
    ws.getRow(2).height = 21.75;
    ws.mergeCells('A2:O2');
    put(ws, 'A2', 'Data Source Summary', banner);

    r = 3;
    ws.mergeCells('D3:E3'); ws.mergeCells('H3:I3'); ws.mergeCells('J3:K3'); ws.mergeCells('L3:M3');
    put(ws, 'A3', 'No.', th); put(ws, 'B3', 'System', th);
    put(ws, 'C3', 'Schema Name/\nPath Name', th);
    put(ws, 'D3', 'Table Name/\nFile Name', th);
    put(ws, 'F3', 'Table Type', th); put(ws, 'G3', 'Selection Method', th);
    put(ws, 'H3', 'Delta Criteria', th); put(ws, 'J3', 'Filtering Criteria', th);
    put(ws, 'L3', 'Remark', th); put(ws, 'N3', 'Created Date', th); put(ws, 'O3', 'Updated Date', th);
    for (var cc = 1; cc <= 15; cc++) if (!ws.getCell(3, cc).fill || !ws.getCell(3, cc).fill.fgColor) {
      ws.getCell(3, cc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.colHead } };
      ws.getCell(3, cc).border = bd('hair');
    }

    r = 4;
    var sections = (model.sourceSections && model.sourceSections.length)
      ? model.sourceSections
      : [{ label: '', sources: model.sources }];
    var multi = sections.length > 1;

    sections.forEach(function (sec) {
      if (multi) {
        ws.mergeCells('A' + r + ':P' + r);
        put(ws, 'A' + r, sec.label, { size: 11, bold: true, fill: C.rose, border: 'hair', wrap: false });
        r++;
      }
      var bySchema = {};
      (sec.sources || []).forEach(function (s) {
        var key = s.schema || '(no schema)';
        (bySchema[key] = bySchema[key] || []).push(s);
      });
      var n = 0;
      Object.keys(bySchema).forEach(function (schema) {
        ws.mergeCells('A' + r + ':C' + r);
        put(ws, 'A' + r, schema, { size: 8, bold: true, fill: C.peach, h: 'center', v: 'center', border: 'hair' });
        fillRange(ws, r, 1, 15, C.peach);
        r++;
        bySchema[schema].forEach(function (s) {
          n++;
          ws.mergeCells('D' + r + ':E' + r); ws.mergeCells('H' + r + ':I' + r);
          ws.mergeCells('J' + r + ':K' + r); ws.mergeCells('L' + r + ':M' + r);
          put(ws, 'A' + r, n, Object.assign({}, td, { h: 'center' }));
          put(ws, 'B' + r, s.system, td);
          put(ws, 'C' + r, s.schema, td);
          put(ws, 'D' + r, s.table, td);
          put(ws, 'F' + r, s.tableType, td);
          put(ws, 'G' + r, s.selection, td);
          put(ws, 'H' + r, s.delta, td);
          put(ws, 'J' + r, s.filter, td);
          put(ws, 'L' + r, s.remark, td);
          put(ws, 'N' + r, date, Object.assign({}, td, { numFmt: DFMT }));
          put(ws, 'O' + r, null, Object.assign({}, td, { numFmt: DFMT }));
          r++;
        });
      });
    });

    r++;
    ws.mergeCells('A' + r + ':P' + r);
    put(ws, 'A' + r, 'Tables Relationship', Object.assign({}, banner, { wrap: false }));
    ws.getRow(r).height = 21.75;
    r++;

    var hr = r;
    ws.mergeCells('B' + hr + ':D' + hr); ws.mergeCells('E' + hr + ':F' + hr);
    ws.mergeCells('G' + hr + ':H' + hr); ws.mergeCells('K' + hr + ':L' + hr);
    ws.mergeCells('M' + hr + ':N' + hr); ws.mergeCells('O' + hr + ':P' + hr);
    put(ws, 'A' + hr, 'No.', th); put(ws, 'B' + hr, 'Table A', th);
    put(ws, 'E' + hr, 'Table A Alias', th); put(ws, 'G' + hr, 'Table B', th);
    put(ws, 'I' + hr, 'Table B Alias', th); put(ws, 'J' + hr, 'Join Type', th);
    put(ws, 'K' + hr, 'Join Condition', th); put(ws, 'M' + hr, 'Condition', th);
    put(ws, 'O' + hr, 'Remark', th);
    put(ws, 'Q' + hr, 'Created Date', th); put(ws, 'R' + hr, 'Updated Date', th);
    put(ws, 'S' + hr, 'Script reference', th);
    for (var c2 = 1; c2 <= 19; c2++) if (!ws.getCell(hr, c2).fill || !ws.getCell(hr, c2).fill.fgColor) {
      ws.getCell(hr, c2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.colHead } };
      ws.getCell(hr, c2).border = bd('hair');
    }
    r++;

    model.groups.forEach(function (g) {
      ws.mergeCells('A' + r + ':S' + r);
      put(ws, 'A' + r, g.name, {
        size: g.isCte ? 8 : 11, bold: true, fill: g.isCte ? C.cyan : C.rose, border: 'hair'
      });
      r++;
      g.rows.forEach(function (row, idx) {
        ws.mergeCells('B' + r + ':D' + r); ws.mergeCells('E' + r + ':F' + r);
        ws.mergeCells('G' + r + ':H' + r); ws.mergeCells('K' + r + ':L' + r);
        ws.mergeCells('M' + r + ':N' + r); ws.mergeCells('O' + r + ':P' + r);
        put(ws, 'A' + r, row.no, Object.assign({}, td, { h: 'center' }));
        put(ws, 'B' + r, row.tableA, Object.assign({}, td, { color: /^Subsquery/.test(row.tableA) ? C.teal : C.black }));
        put(ws, 'E' + r, row.aliasA, td);
        put(ws, 'G' + r, row.tableB, Object.assign({}, td, { color: /^Subsquery/.test(row.tableB) ? C.teal : C.black }));
        put(ws, 'I' + r, row.aliasB, td);
        put(ws, 'J' + r, row.joinType, td);
        put(ws, 'K' + r, row.condition, td);
        put(ws, 'M' + r, row.condWhere || '', td);
        put(ws, 'O' + r, row.remark || '', td);
        put(ws, 'Q' + r, date, Object.assign({}, td, { numFmt: DFMT }));
        put(ws, 'R' + r, null, Object.assign({}, td, { numFmt: DFMT }));
        put(ws, 'S' + r, idx === 0 && g.sql ? g.sql : '', Object.assign({}, td, { size: 8, fill: C.cyan }));
        r++;
      });
    });

    r++;
    ws.mergeCells('A' + r + ':J' + r);
    put(ws, 'A' + r, 'Target Table Summary', Object.assign({}, banner, { wrap: false }));
    ws.getRow(r).height = 21.75;
    r++;
    var hr2 = r;
    ws.mergeCells('B' + hr2 + ':E' + hr2); ws.mergeCells('G' + hr2 + ':H' + hr2);
    put(ws, 'A' + hr2, 'No.', th); put(ws, 'B' + hr2, 'Option', th);
    put(ws, 'F' + hr2, 'Detail', th); put(ws, 'G' + hr2, 'Remark', th);
    put(ws, 'I' + hr2, 'Created Date', th); put(ws, 'J' + hr2, 'Updated Date', th);
    for (var c3 = 1; c3 <= 10; c3++) if (!ws.getCell(hr2, c3).fill || !ws.getCell(hr2, c3).fill.fgColor) {
      ws.getCell(hr2, c3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.colHead } };
      ws.getCell(hr2, c3).border = bd('hair');
    }
    r++;

    var opts = [
      ['Data retention', meta.retention],
      ['Loading Option \n(Append Only Or Insert/Update)', meta.loadingOption],
      ['Truncate Option (Y/N)', meta.truncateOption],
      ['Target Table Surrogate Key \n ( Sequence Key (Y/N) )', meta.surrogateKey],
      ['Target Table Primary Key\n ( Single Key Or Compound Key )', meta.primaryKey],
      ['List of PK Fileds \n( For compound key , listfield by ordering )', meta.pkFields]
    ];
    opts.forEach(function (o, i) {
      ws.mergeCells('B' + r + ':E' + r); ws.mergeCells('G' + r + ':H' + r);
      put(ws, 'A' + r, i + 1, Object.assign({}, td, { h: 'center' }));
      put(ws, 'B' + r, o[0], td);
      put(ws, 'F' + r, null, td);
      put(ws, 'G' + r, o[1] || '', td);
      put(ws, 'I' + r, date, Object.assign({}, td, { numFmt: DFMT }));
      put(ws, 'J' + r, null, Object.assign({}, td, { numFmt: DFMT }));
      r++;
    });
    return ws;
  }

  /* ------------------------------------------------------------------ 4 */
  var SRC_HEAD = ['Schema Name', 'Table or File Name', 'Column Name', 'Table Alias', 'Tranformation Rule', 'Remark', 'Updated Date'];
  var SRC_WIDTH = [12.25, 42, 25, 20.63, 33.13, 9.13, 11.88];
  var SRC_KEYS = ['schema', 'table', 'column', 'alias', 'transform', 'remark'];
  var SRC_SPAN = SRC_HEAD.length;      // 7 columns per source block
  var SRC_GAP = 1;                     // one spacer column between blocks
  var SRC_FIRST = 13;                  // column M

  function blockStart(i) { return SRC_FIRST + i * (SRC_SPAN + SRC_GAP); }

  function sourceBlocks(model) {
    var b = (model.sourceBlocks || []).slice();
    if (!b.length) b = [{ name: 'SOURCE: NAME 1' }];
    return b;
  }

  function colSources(col, count) {
    var list = (col.sources || []).slice();
    if (!list.length) {
      list = [{
        schema: col.schema || '', table: col.sourceTable || '', column: col.sourceColumn || '',
        alias: col.sourceAlias || '', transform: col.transform || '', remark: col.sourceRemark || ''
      }];
    }
    while (list.length < count) list.push({});
    return list;
  }

  function sheetMapping(wb, model, meta) {
    var ws = wb.addWorksheet(meta.sheetName || 'V1');
    var blocks = sourceBlocks(model);
    widths(ws, {
      A: 21, B: 23.63, C: 14.88, D: 5.75, E: 6.5, F: 6.5, G: 14, H: 57, I: 32.75,
      J: 8.13, K: 11.25, L: 3.13
    });
    blocks.forEach(function (b, bi) {
      var s = blockStart(bi);
      SRC_WIDTH.forEach(function (w, k) { ws.getColumn(s + k).width = w; });
      ws.getColumn(s + SRC_SPAN).width = 4.13;
    });
    var lastCol = blockStart(blocks.length - 1) + SRC_SPAN - 1;
    ws.getRow(1).height = 23.45;
    var date = toDate(meta.updatedDate);

    put(ws, 'A1', 'Table Name : ', { size: 16, bold: true, fill: C.banner, color: C.white, wrap: false });
    put(ws, 'B1', meta.tableName || '', { size: 16, bold: true, fill: C.banner, color: C.white, wrap: false });
    fillRange(ws, 1, 1, lastCol + 1, C.banner);

    var props = [
      ['Table Name (Logical)', meta.logicalName || meta.tableName, false],
      ['Business Objectives (BRD)', meta.businessObjective, false],
      ['Business Measure (Report)', meta.businessMeasure || '-', false],
      ['Data Flow (Location)', meta.dataFlowLocation || 'Data Flow sheet', true],
      ['Data Flow (File Name)', meta.dataFlowFile || 'Data Flow sheet', true],
      ['Table Description', meta.tableDescription, false]
    ];
    props.forEach(function (p, i) {
      var r = 2 + i;
      ws.getRow(r).height = 12;
      ws.mergeCells('B' + r + ':K' + r);
      put(ws, 'A' + r, p[0], { size: 9, bold: true, fill: C.blueSoft, border: 'thin' });
      put(ws, 'B' + r, p[1] || '', { size: 9, fill: C.blueSoft, border: 'thin', color: p[2] ? C.link : C.black });
    });

    ws.getRow(8).height = 21;
    ws.mergeCells('A8:K8');
    put(ws, 'A8', 'Target Table Information', { size: 16, bold: true, fill: C.bannerDark, color: C.white, h: 'center', border: 'thin', wrap: false });
    blocks.forEach(function (b, bi) {
      var s = blockStart(bi);
      ws.mergeCells(8, s, 8, s + SRC_SPAN - 1);
      put(ws, A(s) + '8', b.name || ('SOURCE: NAME ' + (bi + 1)),
        { size: 16, bold: true, fill: C.purpleDeep, color: C.white, h: 'center', border: 'thin', wrap: false });
    });

    ws.getRow(9).height = 23.25;
    var th = { size: 8, bold: true, fill: C.colHead, border: 'hair', h: 'center', v: 'center' };
    var ths = Object.assign({}, th, { fill: C.purpleSoft });
    var tgt = ['No.', 'Column Name', 'Datatype', 'PK', 'Index', 'PII', 'PII Type', 'Description', 'Sample', 'Remark', 'Add-On Date'];
    tgt.forEach(function (t, i) { put(ws, A(i + 1) + '9', t, th); });
    blocks.forEach(function (b, bi) {
      var s = blockStart(bi);
      SRC_HEAD.forEach(function (t, i) { put(ws, A(s + i) + '9', t, ths); });
    });

    var tdT = { size: 9, border: 'hair', fill: C.white };
    var tdS = { size: 9, border: 'hair', fill: C.cyanSoft };
    model.columns.forEach(function (col, i) {
      var r = 10 + i;
      put(ws, 'A' + r, i + 1, Object.assign({}, tdT, { bold: true, h: 'center' }));
      put(ws, 'B' + r, col.name, tdT);
      put(ws, 'C' + r, col.datatype, tdT);
      put(ws, 'D' + r, col.pk ? 'Y' : '', Object.assign({}, tdT, { h: 'center' }));
      put(ws, 'E' + r, col.index ? 'Y' : '', Object.assign({}, tdT, { h: 'center' }));
      put(ws, 'F' + r, col.pii ? 'Y' : '', Object.assign({}, tdT, { h: 'center' }));
      put(ws, 'G' + r, col.piiType || '', tdT);
      put(ws, 'H' + r, col.description || '', tdT);
      put(ws, 'I' + r, col.sample || '', tdT);
      put(ws, 'J' + r, col.remark || '', tdT);
      put(ws, 'K' + r, null, Object.assign({}, tdT, { numFmt: DFMT }));
      put(ws, 'L' + r, null, { size: 9, fill: C.white });
      var srcs = colSources(col, blocks.length);
      blocks.forEach(function (b, bi) {
        var s = blockStart(bi), v = srcs[bi] || {};
        SRC_KEYS.forEach(function (k, j) { put(ws, A(s + j) + r, v[k] || '', tdS); });
        put(ws, A(s + SRC_SPAN - 1) + r, date, Object.assign({}, tdS, { numFmt: DFMT }));
        if (bi < blocks.length - 1) put(ws, A(s + SRC_SPAN) + r, null, { size: 9, fill: C.white });
      });
    });

    ws.views = [{ state: 'frozen', xSplit: 11, ySplit: 9 }];
    if (model.columns.length) {
      ws.autoFilter = { from: 'A9', to: A(lastCol) + (9 + model.columns.length) };
    }
    return ws;
  }

  /* ------------------------------------------------------------------ 5 */
  function sheetSample(wb, model) {
    var ws = wb.addWorksheet('TGT-Sample Data');
    model.columns.forEach(function (col, i) {
      var letter = A(i + 1);
      ws.getColumn(i + 1).width = Math.max(14, Math.min(45, col.name.length + 8));
      put(ws, letter + '1', col.name, {
        size: 11, bold: true, fill: C.cyanSoft, border: 'thin', h: 'left'
      });
      for (var r = 2; r <= 6; r++) {
        var cell = ws.getCell(letter + r);
        cell.numFmt = '@';
        cell.border = bd('thin');
        cell.font = { name: 'Calibri', size: 11 };
      }
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
  }

  /* ------------------------------------------------------------------ */
  function build(ExcelJS, model, meta) {
    var wb = new ExcelJS.Workbook();
    wb.creator = meta.designer || 'SQL mapping generator';
    wb.created = new Date();
    sheetDocControl(wb, meta);
    sheetDataFlow(wb, meta);
    sheetSummary(wb, model, meta);
    sheetMapping(wb, model, meta);
    if (meta.includeSample !== false) sheetSample(wb, model);
    return wb;
  }

  var api = { build: build, COLORS: C };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SqlMapBuilder = api;
})(typeof window !== 'undefined' ? window : globalThis);
