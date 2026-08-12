/* ============================================================================
   sqlmap.app — UI glue
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DESIGNER_KEY = 'sqlmap.designer';
  var DEFAULT_DESIGNER = 'Wachirawit';

  var state = {
    model: null,
    edits: newEdits(),   // ค่าที่ผู้ใช้พิมพ์แก้เอง (ล็อกไว้ไม่ให้ถูกทับ)
    files: [],          // [{ name, sql }] in dependency order
    active: 0,          // which file the editor is showing
    targetIndex: -1,    // -1 = last file
    meta: {
      tableName: '', logicalName: '', businessObjective: '', businessMeasure: '-',
      tableDescription: '', designer: savedDesigner(), project: '', ucr: '',
      updatedDate: today(), retention: '3 Month', loadingOption: 'INSERT OVERWRITE',
      truncateOption: '', surrogateKey: '', primaryKey: '', pkFields: '',
      sheetName: 'V1', suffix: '', version: 'v1',
      includeSample: true, history: [{ sheet: 'All', description: 'Initial Version' }]
    }
  };

  function savedDesigner() {
    try { return localStorage.getItem(DESIGNER_KEY) || DEFAULT_DESIGNER; }
    catch (e) { return DEFAULT_DESIGNER; }
  }
  function saveDesigner(name) {
    try { localStorage.setItem(DESIGNER_KEY, name); return true; }
    catch (e) { return false; }
  }

  /* ------------------------------------------------------- source blocks */
  function blankSource() {
    return { schema: '', table: '', column: '', alias: '', transform: '', remark: '' };
  }

  function normaliseSources(model) {
    if (!model.sourceBlocks || !model.sourceBlocks.length) {
      model.sourceBlocks = [{ name: 'SOURCE: NAME 1' }];
    }
    var n = model.sourceBlocks.length;
    model.columns.forEach(function (c) {
      if (!c.sources || !c.sources.length) {
        c.sources = [{
          schema: c.schema || '', table: c.sourceTable || '', column: c.sourceColumn || '',
          alias: c.sourceAlias || '', transform: c.transform || '', remark: c.sourceRemark || ''
        }];
      }
      while (c.sources.length < n) c.sources.push(blankSource());
      c.sources.length = n;
    });
  }

  function setBlockName(bi, value) {
    var model = state.model;
    if (!model || !model.sourceBlocks[bi]) return;
    model.sourceBlocks[bi].name = value;
    noteLabelEdit(model.sourceBlocks[bi], bi);
    markRefreshButtons();
    var blk = model.sourceBlocks[bi];
    if (blk.manual) {
      (model.sourceSections || []).forEach(function (sec) {
        if (sec.blockKey === blk._key) sec.label = value;
      });
      (model.groups || []).forEach(function (g) {
        if (g.blockKey === blk._key && g.isFileHead) g.name = value;
      });
      $$('[data-blockkey="' + blk._key + '"]').forEach(function (el) {
        if (el.value !== value) el.value = value;
      });
      return;
    }
    var fi = blk.fileIndex;
    if (fi === undefined) return;
    (model.sourceSections || []).forEach(function (sec) {
      if (sec.fileIndex === fi) sec.label = value;
    });
    (model.groups || []).forEach(function (g) {
      if (g.isFileHead && g.fileIndex === fi) g.name = value;
    });
    $$('[data-labelfor="' + fi + '"]').forEach(function (el) {
      if (el.value !== value) el.value = value;
    });
  }

  function blockIndexOfFile(fi) {
    var b = state.model.sourceBlocks;
    for (var i = 0; i < b.length; i++) if (b[i].fileIndex === fi) return i;
    return -1;
  }

  /* =====================================================================
     จำค่าที่ผู้ใช้ "พิมพ์แก้เอง"
     - Column mapping / Data source summary / Tables relationship
       ทุกช่องที่พิมพ์แก้จะถูกจดไว้ที่ state.edits
     - กด "วิเคราะห์สคริปต์" ใหม่ => parser อ่านใหม่ทั้งหมด แล้วเอาค่าที่จด
       ไว้ทับกลับลงไป ช่องที่ไม่เคยแก้จึงรีเฟรชตามปกติ
     - ค่าที่ล็อกไว้จะกลับไปใช้ค่าจากสคริปต์ ก็ต่อเมื่อกดปุ่ม refresh
       ของ source นั้น (หรือ refresh ทั้งหัวข้อ)
     ===================================================================== */

  function newEdits() {
    return {
      cols: {},           // colKey -> { t:{field:val}, s:{ blockKey:{field:val} } }
      srcs: {},           // sectionKey -> { rowKey:{field:val} }
      rels: {},           // groupKey -> { rowKey:{field:val} }
      labels: {},         // blockKey -> ชื่อ source ที่พิมพ์เอง
      addedCols: [],      // คอลัมน์ที่กดเพิ่มเอง
      removedCols: {},    // colKey ที่กดลบ
      extraBlocks: [],    // source block ที่กดเพิ่มเอง
      removedBlocks: {},  // blockKey ที่กดลบ
      newSrcRows: {},     // sectionKey -> [row] แถวที่กดเพิ่มใน Data source summary
      newRelRows: {},     // groupKey   -> [row] แถวที่กดเพิ่มใน Tables relationship
      newGroups: {}       // ownerKey   -> [group] Subsquery ที่กดเพิ่มเอง
    };
  }

  var keySeq = 0;
  function upperKey(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  /* แถว/กลุ่มที่ผู้ใช้กดเพิ่มเอง — รูปแบบเดียวกับที่ parser สร้าง แต่ค่าว่าง */
  function blankSrcRow() {
    return {
      _key: 'NSRC#' + (++keySeq), manual: true,
      no: 0, system: 'ORACLE', schema: '', table: '',
      tableType: 'Transaction', selection: 'Full load',
      delta: '', filter: '', remark: ''
    };
  }
  function blankRelRow() {
    return {
      _key: 'NREL#' + (++keySeq), manual: true,
      no: 0, tableA: '', aliasA: '', tableB: '', aliasB: '',
      joinType: '', condition: '', condWhere: '', remark: ''
    };
  }
  function blankGroup(name) {
    return {
      _key: 'NGRP#' + (++keySeq), manual: true, isCte: true,
      name: name || 'Subsquery: NEW_SUBQUERY', rows: [], sql: ''
    };
  }
  function ownerKeyOf(o, fallback) {
    if (o && o.blockKey) return o.blockKey;
    return fileKeyOf(o, fallback);
  }

  function fileKeyOf(o, fallback) {
    if (o && o.file) return 'F:' + upperKey(o.file);
    if (o && o.fileIndex !== undefined && o.fileIndex !== null) return 'f' + o.fileIndex;
    return fallback;
  }
  function blockKeyOf(b, bi) {
    if (b && b._key) return b._key;
    return fileKeyOf(b, 'b' + bi);
  }
  function sectionKeyOf(sec, si) {
    if (sec && sec._key) return sec._key;
    return fileKeyOf(sec, 's' + si);
  }
  function groupKeyOf(g, gi) {
    return fileKeyOf(g, 'g') + '::' + (g.isFileHead ? '__main__' : (upperKey(g.name) || ('#' + gi)));
  }
  function srcSig(s2) { return upperKey(s2.schema) + '.' + upperKey(s2.table); }
  function relSig(r) {
    return upperKey(r.tableA) + '|' + upperKey(r.aliasA) + '|' + upperKey(r.tableB) + '|' + upperKey(r.aliasB);
  }
  function stampRowKeys(list, sig) {
    var seen = {};
    (list || []).forEach(function (x, i) {
      var k = sig(x) || ('#' + i);
      seen[k] = (seen[k] || 0) + 1;
      x._key = k + '#' + seen[k];
    });
  }

  /* ให้ทุกชิ้นในโมเดลมีกุญแจที่คงที่ข้ามการวิเคราะห์รอบใหม่ */
  function stampModel(model) {
    (model.columns || []).forEach(function (c) { c._key = upperKey(c.name) || ('COL#' + (++keySeq)); });
    (model.sourceBlocks || []).forEach(function (b, bi) { b._key = blockKeyOf(b, bi); });
    (model.sourceSections || []).forEach(function (sec, si) {
      sec._key = sectionKeyOf(sec, si);
      stampRowKeys(sec.sources, srcSig);
    });
    (model.groups || []).forEach(function (g, gi) {
      g._key = groupKeyOf(g, gi);
      stampRowKeys(g.rows, relSig);
    });
  }

  function syncLabels(model) {
    (model.sourceBlocks || []).forEach(function (b) {
      if (b.manual) {
        (model.sourceSections || []).forEach(function (sec) { if (sec.blockKey === b._key) sec.label = b.name; });
        (model.groups || []).forEach(function (g) {
          if (g.blockKey === b._key && g.isFileHead) g.name = b.name;
        });
        return;
      }
      var fi = b.fileIndex;
      if (fi === undefined || fi === null) return;
      (model.sourceSections || []).forEach(function (sec) { if (sec.fileIndex === fi) sec.label = b.name; });
      (model.groups || []).forEach(function (g) { if (g.isFileHead && g.fileIndex === fi) g.name = b.name; });
    });
  }

  function mirrorFirstSource(model) {
    (model.columns || []).forEach(function (c) {
      for (var j = 0; j < (c.sources || []).length; j++) {
        var sv = c.sources[j];
        if (sv && (sv.table || sv.column)) {
          c.schema = sv.schema; c.sourceTable = sv.table; c.sourceColumn = sv.column;
          c.sourceAlias = sv.alias; c.transform = sv.transform; c.sourceRemark = sv.remark;
          return;
        }
      }
    });
  }

  /* เอาค่าที่ล็อกไว้ทับลงบนโมเดลที่เพิ่งวิเคราะห์ใหม่ */
  function applyEdits(model) {
    var E = state.edits;

    for (var bi = model.sourceBlocks.length - 1; bi >= 0; bi--) {
      if (E.removedBlocks[model.sourceBlocks[bi]._key]) {
        (function (idx) {
          model.sourceBlocks.splice(idx, 1);
          model.columns.forEach(function (c) { if (c.sources) c.sources.splice(idx, 1); });
        })(bi);
      }
    }
    /* source ที่กดเพิ่มเอง: ได้ทั้งบล็อกใน Column mapping,
       section ใน Data source summary และกลุ่มใน Tables relationship */
    E.extraBlocks.forEach(function (b) {
      model.sourceBlocks.push({ name: b.name, _key: b._key, manual: true });
      model.sourceSections = model.sourceSections || [];
      model.sourceSections.push({
        label: b.name, file: '', manual: true, blockKey: b._key,
        _key: b._key + '::sec', table: '', sources: []
      });
      model.groups = model.groups || [];
      model.groups.push({
        name: b.name, isCte: false, isFileHead: true, manual: true,
        blockKey: b._key, _key: b._key + '::main', rows: [], sql: ''
      });
    });
    normaliseSources(model);

    model.sourceBlocks.forEach(function (b) {
      if (E.labels[b._key] !== undefined) b.name = E.labels[b._key];
    });
    syncLabels(model);

    model.columns = model.columns.filter(function (c) { return !E.removedCols[c._key]; });
    model.columns.forEach(function (c) {
      var e = E.cols[c._key];
      if (!e) return;
      Object.keys(e.t || {}).forEach(function (f) { c[f] = e.t[f]; });
      model.sourceBlocks.forEach(function (b, i) {
        var se = e.s && e.s[b._key];
        if (!se) return;
        if (!c.sources[i]) c.sources[i] = blankSource();
        Object.keys(se).forEach(function (f) { c.sources[i][f] = se[f]; });
      });
    });
    E.addedCols.forEach(function (c) {
      if (model.columns.indexOf(c) < 0) model.columns.push(c);
    });
    normaliseSources(model);
    mirrorFirstSource(model);

    (model.sourceSections || []).forEach(function (sec) {
      var m = E.srcs[sec._key];
      if (!m) return;
      (sec.sources || []).forEach(function (s2) {
        var e = m[s2._key];
        if (e) Object.keys(e).forEach(function (f) { s2[f] = e[f]; });
      });
    });
    (model.groups || []).forEach(function (g) {
      var m = E.rels[g._key];
      if (!m) return;
      (g.rows || []).forEach(function (r) {
        var e = m[r._key];
        if (e) Object.keys(e).forEach(function (f) { r[f] = e[f]; });
      });
    });

    /* Subsquery ที่กดเพิ่มเอง — แทรกต่อท้ายกลุ่มของ source เดียวกัน */
    var out = [], seenOwner = {};
    (model.groups || []).forEach(function (g, gi) {
      out.push(g);
      var ok = ownerKeyOf(g, 'g' + gi);
      var next = (model.groups[gi + 1] && ownerKeyOf(model.groups[gi + 1], 'g')) || null;
      if (next === ok) return;
      if (seenOwner[ok]) return;
      seenOwner[ok] = 1;
      (E.newGroups[ok] || []).forEach(function (ng) { out.push(ng); });
    });
    Object.keys(E.newGroups).forEach(function (ok) {
      if (seenOwner[ok]) return;
      seenOwner[ok] = 1;
      (E.newGroups[ok] || []).forEach(function (ng) { out.push(ng); });
    });
    model.groups = out;

    /* แถวที่กดเพิ่มเอง — ต่อท้ายของแต่ละ section / group */
    (model.sourceSections || []).forEach(function (sec) {
      var extra = E.newSrcRows[sec._key];
      if (!extra || !extra.length) return;
      sec.sources = (sec.sources || []).slice();
      extra.forEach(function (r) { if (sec.sources.indexOf(r) < 0) sec.sources.push(r); });
    });
    (model.groups || []).forEach(function (g) {
      var extra = E.newRelRows[g._key];
      if (!extra || !extra.length) return;
      g.rows = (g.rows || []).slice();
      extra.forEach(function (r) { if (g.rows.indexOf(r) < 0) g.rows.push(r); });
    });
    renumberRows(model);
  }

  function renumberRows(model) {
    (model.groups || []).forEach(function (g) {
      (g.rows || []).forEach(function (r, i) { r.no = i + 1; });
    });
    var flat = [], seen = {};
    (model.sourceSections || []).forEach(function (sec) {
      (sec.sources || []).forEach(function (s2, i) {
        s2.no = i + 1;
        var k = upperKey(s2.schema) + '.' + upperKey(s2.table);
        if (!s2.table || seen[k]) return;
        seen[k] = 1; flat.push(s2);
      });
    });
    if (flat.length) model.sources = flat;
  }

  /* ---------------------------------------------------------- จด/อ่าน lock */
  function noteColEdit(col, bi, field, value) {
    var k = col._key || (col._key = upperKey(col.name) || ('COL#' + (++keySeq)));
    var e = state.edits.cols[k] || (state.edits.cols[k] = { t: {}, s: {} });
    if (bi === null || bi === undefined) { e.t[field] = value; return; }
    var bk = blockKeyOf(state.model.sourceBlocks[bi], bi);
    (e.s[bk] || (e.s[bk] = {}))[field] = value;
  }
  function isColEdited(col, bi, field) {
    var e = state.edits.cols[col._key];
    if (!e) return false;
    if (bi === null || bi === undefined) return !!(e.t && e.t[field] !== undefined);
    var bk = blockKeyOf(state.model.sourceBlocks[bi], bi);
    return !!(e.s && e.s[bk] && e.s[bk][field] !== undefined);
  }
  function noteSrcEdit(sec, s2, field, value) {
    if (!sec._key) sec._key = sectionKeyOf(sec, 0);
    if (!s2._key) s2._key = srcSig(s2) + '#1';
    var m = state.edits.srcs[sec._key] || (state.edits.srcs[sec._key] = {});
    (m[s2._key] || (m[s2._key] = {}))[field] = value;
  }
  function isSrcEdited(sec, s2, field) {
    var m = state.edits.srcs[sec._key];
    return !!(m && m[s2._key] && m[s2._key][field] !== undefined);
  }
  function noteRelEdit(g, r, field, value) {
    if (!g._key) g._key = groupKeyOf(g, 0);
    if (!r._key) r._key = relSig(r) + '#1';
    var m = state.edits.rels[g._key] || (state.edits.rels[g._key] = {});
    (m[r._key] || (m[r._key] = {}))[field] = value;
  }
  function isRelEdited(g, r, field) {
    var m = state.edits.rels[g._key];
    return !!(m && m[r._key] && m[r._key][field] !== undefined);
  }
  function noteLabelEdit(b, bi) {
    state.edits.labels[blockKeyOf(b, bi)] = b.name;
  }

  /* ------------------------------------------------------------- นับจำนวน */
  function targetEditCount() {
    var E = state.edits, n = E.addedCols.length + Object.keys(E.removedCols).length;
    Object.keys(E.cols).forEach(function (k) { n += Object.keys(E.cols[k].t || {}).length; });
    return n;
  }
  function blockEditCount(bk) {
    var E = state.edits, n = E.labels[bk] !== undefined ? 1 : 0;
    Object.keys(E.cols).forEach(function (k) {
      var sMap = E.cols[k].s || {};
      if (sMap[bk]) n += Object.keys(sMap[bk]).length;
    });
    return n;
  }
  function srcEditCount(sk) {
    var m = state.edits.srcs[sk], n = (state.edits.newSrcRows[sk] || []).length;
    if (!m) return n;
    Object.keys(m).forEach(function (rk) { n += Object.keys(m[rk]).length; });
    return n;
  }
  function relEditCount(fk) {
    var E = state.edits, n = 0;
    function mine(gk) { return !fk || gk.indexOf(fk + '::') === 0 || gk === fk; }
    Object.keys(E.rels).forEach(function (gk) {
      if (!mine(gk)) return;
      Object.keys(E.rels[gk]).forEach(function (rk) { n += Object.keys(E.rels[gk][rk]).length; });
    });
    Object.keys(E.newRelRows).forEach(function (gk) {
      if (mine(gk)) n += E.newRelRows[gk].length;
    });
    Object.keys(E.newGroups).forEach(function (ok) {
      if (!fk || ok === fk) {
        E.newGroups[ok].forEach(function (g) { n += 1 + (g.rows || []).length; });
      }
    });
    return n;
  }
  function ledgerEditCount() {
    var n = targetEditCount();
    ((state.model && state.model.sourceBlocks) || []).forEach(function (b, bi) {
      n += blockEditCount(blockKeyOf(b, bi));
    });
    return n;
  }
  function srcEditTotal() {
    var n = 0, seen = {};
    Object.keys(state.edits.srcs).forEach(function (sk) { seen[sk] = 1; });
    Object.keys(state.edits.newSrcRows).forEach(function (sk) { seen[sk] = 1; });
    Object.keys(seen).forEach(function (sk) { n += srcEditCount(sk); });
    return n;
  }

  function badge(el, n) {
    if (!el) return;
    el.textContent = n ? ('แก้เอง ' + n + ' ช่อง') : '';
  }
  function markRefreshButtons() {
    badge($('#ledgerEdits'), ledgerEditCount());
    badge($('#sourceEdits'), srcEditTotal());
    badge($('#joinEdits'), relEditCount(''));
    var tb = $('[data-rfrtarget]');
    if (tb) tb.classList.toggle('has-edit', targetEditCount() > 0);
    $$('[data-rfrblock]').forEach(function (b) {
      var bi = +b.dataset.rfrblock;
      b.classList.toggle('has-edit', blockEditCount(blockKeyOf(state.model.sourceBlocks[bi], bi)) > 0);
    });
    $$('[data-rfrsec]').forEach(function (b) {
      b.classList.toggle('has-edit', srcEditCount(b.dataset.seckey) > 0);
    });
    $$('[data-rfrrel]').forEach(function (b) {
      b.classList.toggle('has-edit', relEditCount(b.dataset.filekey) > 0);
    });
    $$('#rfrLedgerAll').forEach(function (b) { b.classList.toggle('has-edit', ledgerEditCount() > 0); });
    $$('#rfrSourceAll').forEach(function (b) { b.classList.toggle('has-edit', srcEditTotal() > 0); });
    $$('#rfrJoinAll').forEach(function (b) { b.classList.toggle('has-edit', relEditCount('') > 0); });
  }

  /* ------------------------------------------------------------ ปุ่ม refresh */
  function clearTargetEdits() {
    var E = state.edits;
    Object.keys(E.cols).forEach(function (k) { E.cols[k].t = {}; });
    E.addedCols = [];
    E.removedCols = {};
  }
  function clearBlockEdits(bk) {
    var E = state.edits;
    Object.keys(E.cols).forEach(function (k) { if (E.cols[k].s) delete E.cols[k].s[bk]; });
    delete E.labels[bk];
  }
  function refreshScope(kind, key, title) {
    var E = state.edits;
    if (kind === 'target') clearTargetEdits();
    else if (kind === 'block') clearBlockEdits(key);
    else if (kind === 'ledger') {
      clearTargetEdits();
      Object.keys(E.cols).forEach(function (k) { E.cols[k].s = {}; });
      E.labels = {};
      E.extraBlocks = [];
      E.removedBlocks = {};
      Object.keys(E.newSrcRows).forEach(function (sk) { if (sk.indexOf('::sec') >= 0) delete E.newSrcRows[sk]; });
      Object.keys(E.newRelRows).forEach(function (gk) { if (gk.indexOf('::main') >= 0) delete E.newRelRows[gk]; });
      Object.keys(E.newGroups).forEach(function (ok) { if (ok.indexOf('X#') === 0) delete E.newGroups[ok]; });
    } else if (kind === 'sec') {
      delete E.srcs[key];
      delete E.newSrcRows[key];
    } else if (kind === 'srcAll') {
      E.srcs = {};
      Object.keys(E.newSrcRows).forEach(function (sk) {
        if (sk.indexOf('::sec') < 0) delete E.newSrcRows[sk];
      });
    } else if (kind === 'rel') {
      Object.keys(E.rels).forEach(function (gk) { if (gk.indexOf(key + '::') === 0) delete E.rels[gk]; });
      Object.keys(E.newRelRows).forEach(function (gk) { if (gk.indexOf(key + '::') === 0) delete E.newRelRows[gk]; });
      delete E.newGroups[key];
    } else if (kind === 'relAll') {
      E.rels = {};
      Object.keys(E.newRelRows).forEach(function (gk) {
        if (gk.indexOf('::main') < 0) delete E.newRelRows[gk];
      });
      Object.keys(E.newGroups).forEach(function (ok) {
        if (ok.indexOf('X#') !== 0) delete E.newGroups[ok];
      });
    }
    analyze({ quiet: true });
    toast('รีเฟรช ' + title + ' จากสคริปต์แล้ว');
  }

  function syncPrimaryKey() {
    if (!state.model) return;
    var pk = state.model.columns.filter(function (c) { return c.pk; })
      .map(function (c) { return c.name; }).filter(Boolean);
    state.meta.primaryKey = pk.join(', ');
    var el = $('#meta [data-meta="primaryKey"]');
    if (el) el.value = state.meta.primaryKey;
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------------------------------------------- intake */
  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var pending = files.length;
    files.forEach(function (file, order) {
      var fr = new FileReader();
      fr.onload = function () {
        state.files.push({ name: file.name, sql: fr.result });
        if (--pending === 0) afterAdd();
      };
      fr.onerror = function () {
        toast('อ่านไฟล์ ' + file.name + ' ไม่ได้');
        if (--pending === 0) afterAdd();
      };
      fr.readAsText(file, 'utf-8');
    });
  }

  function afterAdd() {
    state.files.sort(function (a, b) { return 0; });
    state.active = state.files.length - 1;
    if (state.targetIndex < 0 || state.targetIndex >= state.files.length) state.targetIndex = state.files.length - 1;
    syncEditorFromFile();
    renderFiles();
    analyze();
  }

  function targetIdx() {
    return (state.targetIndex >= 0 && state.targetIndex < state.files.length)
      ? state.targetIndex : state.files.length - 1;
  }

  function syncEditorFromFile() {
    var f = state.files[state.active];
    $('#sql').value = f ? f.sql : '';
    renderFiles();
  }

  function renderFiles() {
    var box = $('#fileList');
    if (!state.files.length) {
      box.innerHTML = '<p class="filename">ยังไม่ได้เลือกไฟล์ — วางสคริปต์ในช่องด้านล่างก็ได้</p>';
      return;
    }
    var ti = targetIdx();
    box.innerHTML = '<ol class="files">' + state.files.map(function (f, i) {
      return '<li class="file' + (i === state.active ? ' is-active' : '') + (i === ti ? ' is-target' : '') + '">' +
        '<button class="fname" data-open="' + i + '" title="แก้ไขสคริปต์นี้">' + esc(f.name) + '</button>' +
        (i === ti ? '<span class="badge">ปลายทาง</span>'
                  : '<button class="pick" data-target="' + i + '" title="ตั้งเป็นตารางปลายทาง">ตั้งเป็นปลายทาง</button>') +
        '<span class="ord">' +
        '<button class="icon" data-up="' + i + '" title="เลื่อนขึ้น"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
        '<button class="icon" data-down="' + i + '" title="เลื่อนลง"' + (i === state.files.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
        '<button class="icon" data-rm="' + i + '" title="เอาออก">&times;</button>' +
        '</span></li>';
    }).join('') + '</ol>' +
      (state.files.length > 1
        ? '<p class="hint">ลำดับ = ทิศทางการไหลของข้อมูล ไฟล์บนคือต้นน้ำ ไฟล์ที่ตั้งเป็น “ปลายทาง” คือตารางที่เอกสารนี้อธิบาย</p>'
        : '');

    $$('#fileList [data-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        saveEditorToFile();
        state.active = +b.dataset.open;
        syncEditorFromFile();
      });
    });
    $$('#fileList [data-target]').forEach(function (b) {
      b.addEventListener('click', function () {
        saveEditorToFile();
        state.targetIndex = +b.dataset.target;
        renderFiles(); analyze();
      });
    });
    $$('#fileList [data-up]').forEach(function (b) {
      b.addEventListener('click', function () { moveFile(+b.dataset.up, -1); });
    });
    $$('#fileList [data-down]').forEach(function (b) {
      b.addEventListener('click', function () { moveFile(+b.dataset.down, 1); });
    });
    $$('#fileList [data-rm]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.dataset.rm;
        var wasTarget = i === targetIdx();
        state.files.splice(i, 1);
        if (state.active >= state.files.length) state.active = state.files.length - 1;
        if (wasTarget || state.targetIndex > i) state.targetIndex = state.files.length - 1;
        syncEditorFromFile();
        if (state.files.length) analyze(); else { state.model = null; $('#result').hidden = true; }
      });
    });
  }

  function moveFile(i, dir) {
    var j = i + dir;
    if (j < 0 || j >= state.files.length) return;
    saveEditorToFile();
    var tmp = state.files[i]; state.files[i] = state.files[j]; state.files[j] = tmp;
    if (state.active === i) state.active = j; else if (state.active === j) state.active = i;
    if (state.targetIndex === i) state.targetIndex = j; else if (state.targetIndex === j) state.targetIndex = i;
    syncEditorFromFile();
    analyze();
  }

  function saveEditorToFile() {
    if (state.files[state.active]) state.files[state.active].sql = $('#sql').value;
  }

  function setupIntake() {
    var zone = $('#drop'), input = $('#file');
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
  }

  /* --------------------------------------------------------------- analyse */
  function analyze(opts) {
    opts = opts || {};
    saveEditorToFile();
    if (!state.files.length) {
      var pasted = $('#sql').value;
      if (!pasted.trim()) { toast('ยังไม่มีสคริปต์ให้อ่าน — วางโค้ดหรือลากไฟล์ .sql เข้ามาก่อน'); return; }
      state.files = [{ name: 'pasted.sql', sql: pasted }];
      state.active = 0; state.targetIndex = 0;
      renderFiles();
    }
    var model;
    try {
      model = SqlMapParser.parseSqlSet(state.files, targetIdx());
    } catch (err) {
      toast('อ่านสคริปต์ไม่สำเร็จ: ' + err.message);
      return;
    }
    if (!model.ok) { toast(model.error); return; }

    /* วิเคราะห์ใหม่ทั้งหมด แล้วเอาค่าที่ผู้ใช้พิมพ์แก้เองทับกลับลงไป */
    stampModel(model);
    normaliseSources(model);
    applyEdits(model);

    state.model = model;
    var m = state.meta;
    var tf = state.files[targetIdx()];
    var fromName = tf ? tf.name.replace(/\.[A-Za-z0-9]+$/, '').trim() : '';
    if (fromName && fromName !== 'pasted') { m.tableName = fromName; m.logicalName = fromName; }
    else if (model.targetTable && !m.tableName) { m.tableName = model.targetTable; }
    if (!m.logicalName) m.logicalName = m.tableName;
    normaliseSources(model);
    syncPrimaryKey();

    $('#result').hidden = false;
    renderMeta();
    renderStats();
    renderLedger();
    renderSources();
    renderJoins();
    renderWarnings();
    if (state.ddl && state.ddl.entries) recheckDdl();
    markRefreshButtons();
    if (opts.quiet) return;
    var panel = $('#result');
    if (panel && typeof panel.scrollIntoView === 'function') {
      try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { }
    }
  }

  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(Math.max(el.scrollHeight + 2, 24), 170) + 'px';
  }

  /* ---------------------------------------------------------------- render */
  function renderStats() {
    var m = state.model;
    var cells = [
      ['คอลัมน์ปลายทาง', m.columns.length],
      ['ตารางต้นทาง', m.sources.length],
      [m.files && m.files.length > 1 ? 'สคริปต์' : 'subquery',
        m.files && m.files.length > 1 ? m.files.length : m.cteNames.length],
      ['ความสัมพันธ์', m.groups.reduce(function (a, g) { return a + g.rows.length; }, 0)]
    ];
    $('#stats').innerHTML = cells.map(function (c) {
      return '<div class="stat"><b>' + c[1] + '</b><span>' + c[0] + '</span></div>';
    }).join('');
  }

  var META_FIELDS = [
    ['tableName', 'Table name', 'text'],
    ['logicalName', 'Table name (logical)', 'text'],
    ['businessObjective', 'Business objectives (BRD)', 'text'],
    ['businessMeasure', 'Business measure (report)', 'text'],
    ['tableDescription', 'Table description', 'text'],
    ['designer', 'Designer name', 'text'],
    ['project', 'Project', 'text'],
    ['ucr', 'UCR# / Defect#', 'text'],
    ['updatedDate', 'Last updated date', 'date'],
    ['sheetName', 'ชื่อชีท mapping', 'text'],
    ['retention', 'Data retention', 'text'],
    ['loadingOption', 'Loading option', 'text'],
    ['truncateOption', 'Truncate option (Y/N)', 'text'],
    ['surrogateKey', 'Surrogate key (Y/N)', 'text'],
    ['primaryKey', 'Primary key', 'text'],
    ['pkFields', 'List of PK fields', 'text'],
    ['suffix', 'ส่วนต่อท้ายชื่อไฟล์', 'text'],
    ['version', 'Version', 'text']
  ];

  function renderMeta() {
    var html = META_FIELDS.map(function (f) {
      var extra = f[0] === 'designer'
        ? '<button class="save" id="saveDesigner" type="button" title="จำชื่อนี้ไว้ใช้ครั้งต่อไป">เซฟ</button>' : '';
      return '<label class="field' + (extra ? ' has-save' : '') + '"><span>' + esc(f[1]) + '</span>' +
        '<span class="inputline"><input type="' + f[2] + '" data-meta="' + f[0] + '" value="' +
        esc(state.meta[f[0]]) + '">' + extra + '</span></label>';
    }).join('');
    $('#meta').innerHTML = html;
    $$('#meta input').forEach(function (el) {
      el.addEventListener('input', function () {
        state.meta[el.dataset.meta] = el.value;
        renderFileName();
      });
    });
    var sd = $('#saveDesigner');
    if (sd) sd.addEventListener('click', function () {
      var name = (state.meta.designer || '').trim();
      if (!name) { toast('ใส่ชื่อ designer ก่อนกดเซฟ'); return; }
      toast(saveDesigner(name)
        ? 'เซฟชื่อ "' + name + '" แล้ว ครั้งต่อไปจะเติมให้อัตโนมัติ'
        : 'เบราว์เซอร์นี้ไม่ให้บันทึกค่าไว้ — ต้องพิมพ์ชื่อใหม่ทุกครั้ง');
    });
    renderFileName();
  }

  function renderFileName() {
    var m = state.meta;
    var parts = [m.tableName || 'MAPPING'];
    if (m.suffix) parts.push(m.suffix);
    if (m.version) parts.push(m.version);
    $('#outName').textContent = parts.join('_') + '.xlsx';
  }

  var PII_TYPES = ['PII_UNICODE', 'PII_NUMBER', 'PII_STRING'];

  function renderLedgerHead() {
    var blocks = state.model.sourceBlocks;
    var band = '<tr class="band"><th class="t" colspan="9"><span class="bandbar">Target table' +
      '<button class="rfr inv" data-rfrtarget="1" title="ดึงชื่อคอลัมน์ / datatype / ฝั่งซ้ายทั้งหมดใหม่จากสคริปต์ (ทับค่าที่พิมพ์เอง)">&#8635; refresh</button>' +
      '</span></th>';
    var head = '<tr><th>#</th><th>Column name</th><th>Datatype</th><th>PK</th><th>Index</th>' +
      '<th>PII</th><th>PII type</th><th>Description</th><th>Sample</th>';
    blocks.forEach(function (b, bi) {
      band += '<th class="gap"></th>' +
        '<th class="s" colspan="4">' +
        '<span class="bandbar">' +
        '<input class="blockname" data-block="' + bi + '" value="' + esc(b.name) + '" ' +
        (b.fileIndex === undefined ? '' : 'data-labelfor="' + b.fileIndex + '" ') +
        'aria-label="ชื่อ source ' + (bi + 1) + '">' +
        '<button class="rfr inv" data-rfrblock="' + bi + '" title="ดึงคอลัมน์ฝั่ง source นี้ใหม่จากสคริปต์ (ทับค่าที่พิมพ์เอง)">&#8635;</button>' +
        (blocks.length > 1 ? '<button class="icon inv" data-delblock="' + bi + '" title="ลบ source นี้">&times;</button>' : '') +
        '</span>' +
        (b.file ? '<em class="fromfile">' + esc(b.file) + '</em>' : '') +
        '</th>';
      head += '<th class="seam"></th>' +
        '<th class="src">Table / subquery</th><th class="src">Column</th>' +
        '<th class="src">Alias</th><th class="src">Transformation</th>';
    });
    band += '<th class="gap"></th></tr>';
    head += '<th class="src"></th></tr>';
    $('#ledgerHead').innerHTML = band + head;

    $$('#ledgerHead .blockname').forEach(function (el) {
      el.addEventListener('input', function () {
        setBlockName(+el.dataset.block, el.value);
      });
    });
    $$('#ledgerHead [data-rfrtarget]').forEach(function (b) {
      b.addEventListener('click', function () {
        refreshScope('target', null, 'Column mapping (ฝั่ง target table)');
      });
    });
    $$('#ledgerHead [data-rfrblock]').forEach(function (b) {
      b.addEventListener('click', function () {
        var bi = +b.dataset.rfrblock;
        var blk = state.model.sourceBlocks[bi];
        refreshScope('block', blockKeyOf(blk, bi), 'Column mapping ของ ' + (blk.name || ('source ' + (bi + 1))));
      });
    });
    $$('#ledgerHead [data-delblock]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.dataset.delblock;
        var blk = state.model.sourceBlocks[i];
        var key = blockKeyOf(blk, i);
        if (blk.manual) {
          var xs = state.edits.extraBlocks;
          for (var k = xs.length - 1; k >= 0; k--) if (xs[k]._key === key) xs.splice(k, 1);
          delete state.edits.newSrcRows[key + '::sec'];
          delete state.edits.newRelRows[key + '::main'];
          delete state.edits.newGroups[key];
          state.model.sourceSections = (state.model.sourceSections || []).filter(function (sec) {
            return sec.blockKey !== key;
          });
          state.model.groups = (state.model.groups || []).filter(function (g) {
            return g.blockKey !== key;
          });
        } else {
          state.edits.removedBlocks[key] = true;
        }
        state.model.sourceBlocks.splice(i, 1);
        state.model.columns.forEach(function (c) { c.sources.splice(i, 1); });
        renderLedger(); renderSources(); renderJoins();
        markRefreshButtons();
      });
    });
  }

  function renderLedger() {
    normaliseSources(state.model);
    renderLedgerHead();
    var blocks = state.model.sourceBlocks;
    var cols = state.model.columns;
    var rows = cols.map(function (c, i) {
      function lk(f) { return isColEdited(c, null, f) ? ' edited' : ''; }
      function sk(bi, f) { return isColEdited(c, bi, f) ? ' edited' : ''; }
      var html = '<tr data-i="' + i + '">' +
        '<td class="no">' + (i + 1) + '</td>' +
        '<td class="' + nameCellClass(c) + '"><input class="mono strong' + lk('name') + '" data-f="name" value="' +
          esc(c.name) + '">' + nameDiffHtml(c, i) + '</td>' +
        '<td class="' + typeCellClass(c) + '"><input class="mono' + lk('datatype') + '" data-f="datatype" value="' +
          esc(c.datatype) + '"></td>' +
        '<td class="tick"><input type="checkbox" class="' + lk('pk').trim() + '" data-f="pk"' + (c.pk ? ' checked' : '') + '></td>' +
        '<td class="tick"><input type="checkbox" class="' + lk('index').trim() + '" data-f="index"' + (c.index ? ' checked' : '') + '></td>' +
        '<td class="tick"><input type="checkbox" class="' + lk('pii').trim() + '" data-f="pii"' + (c.pii ? ' checked' : '') + '></td>' +
        '<td><input class="mono' + lk('piiType') + '" list="piiTypes" data-f="piiType" value="' + esc(c.piiType) + '" placeholder="—"></td>' +
        '<td><input class="' + lk('description').trim() + '" data-f="description" value="' + esc(c.description) + '" placeholder="คำอธิบาย"></td>' +
        '<td><input class="' + lk('sample').trim() + '" data-f="sample" value="' + esc(c.sample) + '" placeholder="ตัวอย่าง"></td>';
      blocks.forEach(function (b, bi) {
        var sv = c.sources[bi] || {};
        html += '<td class="seam" aria-hidden="true"></td>' +
          '<td><input class="mono' + sk(bi, 'table') + '" data-s="' + bi + '" data-f="table" value="' + esc(sv.table) + '"></td>' +
          '<td><input class="mono' + sk(bi, 'column') + '" data-s="' + bi + '" data-f="column" value="' + esc(sv.column) + '"></td>' +
          '<td><input class="mono' + sk(bi, 'alias') + '" data-s="' + bi + '" data-f="alias" value="' + esc(sv.alias) + '"></td>' +
          '<td><input class="mono' + sk(bi, 'transform') + '" data-s="' + bi + '" data-f="transform" value="' + esc(sv.transform) + '" placeholder="—"></td>';
      });
      html += '<td class="tick"><button class="icon" data-del="' + i + '" title="ลบแถว">&times;</button></td></tr>';
      return html;
    }).join('');
    $('#ledgerBody').innerHTML = rows;

    $$('#ledgerBody input').forEach(function (el) {
      var ev = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(ev, function () {
        var i = +el.closest('tr').dataset.i;
        var col = state.model.columns[i];
        if (el.dataset.s !== undefined) {
          var bi = +el.dataset.s;
          col.sources[bi][el.dataset.f] = el.value;
          noteColEdit(col, bi, el.dataset.f, el.value);
          el.classList.add('edited');
          if (bi === 0) {
            var map = { table: 'sourceTable', column: 'sourceColumn', alias: 'sourceAlias', transform: 'transform' };
            if (map[el.dataset.f]) col[map[el.dataset.f]] = el.value;
          }
          markRefreshButtons();
          return;
        }
        var val = el.type === 'checkbox' ? el.checked : el.value;
        col[el.dataset.f] = val;
        noteColEdit(col, null, el.dataset.f, val);
        el.classList.add('edited');
        if (el.dataset.f === 'pk' || el.dataset.f === 'name') syncPrimaryKey();
        if (el.dataset.f === 'name' || el.dataset.f === 'datatype') scheduleDdlRecheck();
        markRefreshButtons();
      });
    });
    $$('#ledgerBody [data-usename]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.dataset.usename;
        var col = state.model.columns[i];
        if (!col.ddl || !col.ddl.expectedName) return;
        col.name = col.ddl.expectedName;
        noteColEdit(col, null, 'name', col.name);
        recheckDdl();
        syncPrimaryKey();
        markRefreshButtons();
      });
    });
    $$('#ledgerBody [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var col = state.model.columns[+b.dataset.del];
        if (col) {
          if (col._key) state.edits.removedCols[col._key] = true;
          var ai = state.edits.addedCols.indexOf(col);
          if (ai >= 0) state.edits.addedCols.splice(ai, 1);
        }
        state.model.columns.splice(+b.dataset.del, 1);
        renderLedger(); renderStats(); syncPrimaryKey(); markRefreshButtons();
      });
    });

    var hasKeyDay = state.model.columns.some(function (c) { return /_TM_KEY_DAY$/i.test(c.name); });
    var hasPar = state.model.columns.some(function (c) { return /^PAR_KEY$/i.test(c.name); });
    $('#addPar').hidden = !(hasKeyDay && !hasPar);
    markRefreshButtons();
  }

  function blankColumn(name) {
    var n = state.model && state.model.sourceBlocks ? state.model.sourceBlocks.length : 1;
    var srcs = [];
    for (var i = 0; i < n; i++) srcs.push(blankSource());
    return {
      _key: 'NEW#' + (++keySeq),
      name: name || '', datatype: 'VARCHAR2(50)', pk: false, index: false, pii: false,
      piiType: '', description: '', sample: '', remark: '', schema: '',
      sourceTable: '', sourceColumn: '', sourceAlias: '', transform: '', sources: srcs
    };
  }

  function renderSources() {
    var types = ['Transaction', 'Master', 'Reference', 'Snapshot'];
    var sel = ['Delta load', 'Full load'];
    var model = state.model;
    var sections = (model.sourceSections && model.sourceSections.length)
      ? model.sourceSections : [{ label: '', file: '', sources: model.sources }];

    var html = '';
    sections.forEach(function (sec, si) {
      if (!sec._key) sec._key = sectionKeyOf(sec, si);
      var head;
      if (sec.manual) {
        head = '<input class="labelin" data-blockkey="' + esc(sec.blockKey) + '" value="' + esc(sec.label) +
          '" aria-label="ชื่อ source ที่เพิ่มเอง"><em>เพิ่มเอง</em>';
      } else if (sec.fileIndex === undefined) {
        head = '<em>ทุก source</em>';
      } else {
        head = '<input class="labelin" data-labelfor="' + sec.fileIndex + '" value="' + esc(sec.label) +
          '" aria-label="ชื่อ source ของ ' + esc(sec.file) + '"><em>' + esc(sec.file) + '</em>';
      }
      html += '<tr class="filerow"><td colspan="9"><span class="secbar">' + head +
        '<button class="addbtn" data-addsrc="' + si + '" title="เพิ่มแถวว่างใน source นี้">+ แถว</button>' +
        (sec.manual ? ''
          : '<button class="rfr" data-rfrsec="' + si + '" data-seckey="' + esc(sec._key) + '" ' +
            'title="ดึง Data source summary ของ source นี้ใหม่จากสคริปต์ (ทับค่าที่พิมพ์เอง และลบแถวที่เพิ่มเอง)">&#8635; refresh</button>') +
        '</span></td></tr>';
      (sec.sources || []).forEach(function (s, i) {
        function lk(f) { return isSrcEdited(sec, s, f) ? ' edited' : ''; }
        html += '<tr data-sec="' + si + '" data-i="' + i + '"' + (s.manual ? ' class="manualrow"' : '') + '>' +
          '<td class="no">' + (i + 1) + '</td>' +
          '<td><input data-f="system" value="' + esc(s.system) + '" class="mono' + lk('system') + '"></td>' +
          '<td><input data-f="schema" value="' + esc(s.schema) + '" class="mono' + lk('schema') + '"></td>' +
          '<td><input data-f="table" value="' + esc(s.table) + '" class="mono strong' + lk('table') + '"></td>' +
          '<td><select data-f="tableType" class="' + lk('tableType').trim() + '">' + types.map(function (t) {
            return '<option' + (t === s.tableType ? ' selected' : '') + '>' + t + '</option>';
          }).join('') + '</select></td>' +
          '<td><select data-f="selection" class="' + lk('selection').trim() + '">' + sel.map(function (t) {
            return '<option' + (t === s.selection ? ' selected' : '') + '>' + t + '</option>';
          }).join('') + '</select></td>' +
          '<td><textarea class="cellarea' + lk('delta') + '" data-f="delta" rows="1" placeholder="—">' + esc(s.delta || '') + '</textarea></td>' +
          '<td><textarea class="cellarea' + lk('filter') + '" data-f="filter" rows="1" placeholder="—">' + esc(s.filter || '') + '</textarea></td>' +
          '<td class="tick">' + (s.manual
            ? '<button class="icon" data-delsrc="' + si + '" data-row="' + i + '" title="ลบแถวนี้">&times;</button>'
            : '') + '</td>' +
          '</tr>';
      });
    });
    $('#sourceBody').innerHTML = html;

    $$('#sourceBody .labelin').forEach(function (el) {
      el.addEventListener('input', function () {
        var bi = el.dataset.blockkey
          ? blockIndexOfKey(el.dataset.blockkey)
          : blockIndexOfFile(+el.dataset.labelfor);
        if (bi >= 0) setBlockName(bi, el.value);
      });
    });
    $$('#sourceBody [data-rfrsec]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sec = sections[+b.dataset.rfrsec];
        refreshScope('sec', sec._key, 'Data source summary ของ ' + (sec.label || sec.file || 'source นี้'));
      });
    });
    $$('#sourceBody [data-addsrc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sec = sections[+b.dataset.addsrc];
        var row = blankSrcRow();
        (state.edits.newSrcRows[sec._key] = state.edits.newSrcRows[sec._key] || []).push(row);
        sec.sources = sec.sources || [];
        sec.sources.push(row);
        renderSources();
        focusRow('#sourceBody tr[data-sec="' + b.dataset.addsrc + '"][data-i="' + (sec.sources.length - 1) + '"]');
      });
    });
    $$('#sourceBody [data-delsrc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sec = sections[+b.dataset.delsrc];
        var row = sec.sources[+b.dataset.row];
        sec.sources.splice(+b.dataset.row, 1);
        var list = state.edits.newSrcRows[sec._key] || [];
        var k = list.indexOf(row);
        if (k >= 0) list.splice(k, 1);
        renderSources(); markRefreshButtons();
      });
    });
    $$('#sourceBody [data-f]').forEach(function (el) {
      if (el.tagName === 'TEXTAREA') autoGrow(el);
      el.addEventListener('input', function () {
        var tr = el.closest('tr');
        var sec = sections[+tr.dataset.sec];
        var s = sec.sources[+tr.dataset.i];
        s[el.dataset.f] = el.value;
        if (!s.manual) noteSrcEdit(sec, s, el.dataset.f, el.value);
        if (!s.manual) el.classList.add('edited');
        if (el.tagName === 'TEXTAREA') autoGrow(el);
        markRefreshButtons();
      });
    });
    markRefreshButtons();
  }

  function focusRow(sel) {
    var tr = $(sel);
    if (!tr) return;
    var el = tr.querySelector('input,textarea,select');
    if (el) { try { el.focus(); } catch (e) { } }
    try { tr.scrollIntoView({ block: 'nearest' }); } catch (e) { }
  }

  function blockIndexOfKey(key) {
    var b = (state.model && state.model.sourceBlocks) || [];
    for (var i = 0; i < b.length; i++) if (b[i]._key === key) return i;
    return -1;
  }

  function renderJoins() {
    var groups = state.model.groups || [];
    $('#joins').innerHTML = groups.map(function (g, gi) {
      if (!g._key) g._key = groupKeyOf(g, gi);
      var rows = (g.rows || []).map(function (r, ri) {
        function fld(f, label, cls) {
          return '<label class="fl' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' +
            '<input data-rf="' + f + '" class="' + (isRelEdited(g, r, f) ? 'edited' : '') + '" value="' + esc(r[f]) + '"></label>';
        }
        function area(f, label, cls) {
          return '<label class="fl' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' +
            '<textarea data-rf="' + f + '" rows="1" class="' + (isRelEdited(g, r, f) ? 'edited' : '') +
            '" placeholder="—">' + esc(r[f] || '') + '</textarea></label>';
        }
        return '<li class="rel' + (r.manual ? ' is-manual' : '') + '" data-g="' + gi + '" data-r="' + ri + '">' +
          (r.manual ? '<div class="relhead"><button class="icon" data-delrel="' + gi + '" data-row="' + ri +
            '" title="ลบแถวนี้">&times;</button></div>' : '') +
          '<div class="relline">' +
            '<span class="fl narrow"><span>No.</span><b class="no">' + (r.no || (ri + 1)) + '</b></span>' +
            fld('tableA', 'Table A') + fld('aliasA', 'Alias A', 'narrow') +
            fld('joinType', 'Join type', 'narrow') +
            fld('tableB', 'Table B') + fld('aliasB', 'Alias B', 'narrow') +
          '</div>' +
          '<div class="relline">' + area('condition', 'Join condition', 'wide') + '</div>' +
          '<div class="relline">' + area('condWhere', 'Condition') + area('remark', 'Remark') + '</div>' +
          '</li>';
      }).join('');

      var ok = ownerKeyOf(g, 'g' + gi);
      var actions =
        '<button class="addbtn" data-addrel="' + gi + '" title="เพิ่มแถวว่างในกลุ่มนี้">+ แถว</button>' +
        (g.isFileHead
          ? '<button class="addbtn" data-addgrp="' + gi + '" data-owner="' + esc(ok) +
            '" title="เพิ่มกลุ่ม Subsquery ใหม่ใน source นี้">+ Subsquery</button>'
          : '') +
        (g.manual && g.isCte
          ? '<button class="icon" data-delgrp="' + gi + '" data-owner="' + esc(ok) + '" title="ลบ Subsquery นี้">&times;</button>'
          : '') +
        (g.isFileHead && !g.manual
          ? '<button class="rfr" data-rfrrel="' + gi + '" data-filekey="' + esc(ok) + '" ' +
            'title="ดึง Tables relationship ของ source นี้ใหม่จากสคริปต์ (ทับค่าที่พิมพ์เอง และลบแถว/Subsquery ที่เพิ่มเอง)">&#8635; refresh</button>'
          : '');

      var title;
      if (g.isFileHead && g.manual) {
        title = '<input class="labelin" data-blockkey="' + esc(g.blockKey) + '" value="' + esc(g.name) +
          '" aria-label="ชื่อ source ที่เพิ่มเอง"><em>เพิ่มเอง</em>';
      } else if (g.isFileHead) {
        title = '<input class="labelin" data-labelfor="' + g.fileIndex + '" value="' + esc(g.name) +
          '" aria-label="ชื่อ source ของ ' + esc(g.file || '') + '"><em>' + esc(g.file || '') + '</em>';
      } else if (g.manual) {
        title = '<input class="gname" data-gname="' + gi + '" value="' + esc(g.name) +
          '" aria-label="ชื่อ Subsquery"><em>เพิ่มเอง</em>';
      } else {
        title = esc(g.name);
      }

      return '<div class="group ' + (g.isCte ? 'is-cte' : 'is-main') + (g.manual ? ' is-manual' : '') + '">' +
        '<h4>' + title + actions + '</h4>' +
        '<ul>' + rows + '</ul>' +
        '<div class="grpfoot"><button class="addbtn" data-addrel="' + gi + '">+ แถวในกลุ่มนี้</button></div>' +
        '</div>';
    }).join('');

    $$('#joins .labelin').forEach(function (el) {
      el.addEventListener('input', function () {
        var bi = el.dataset.blockkey
          ? blockIndexOfKey(el.dataset.blockkey)
          : blockIndexOfFile(+el.dataset.labelfor);
        if (bi >= 0) setBlockName(bi, el.value);
      });
    });
    $$('#joins [data-gname]').forEach(function (el) {
      el.addEventListener('input', function () {
        groups[+el.dataset.gname].name = el.value;
      });
    });
    $$('#joins [data-rfrrel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var g = groups[+b.dataset.rfrrel];
        refreshScope('rel', b.dataset.filekey, 'Tables relationship ของ ' + (g.name || g.file || 'source นี้'));
      });
    });
    $$('#joins [data-addrel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var g = groups[+b.dataset.addrel];
        var row = blankRelRow();
        if (!g._key) g._key = groupKeyOf(g, +b.dataset.addrel);
        (state.edits.newRelRows[g._key] = state.edits.newRelRows[g._key] || []).push(row);
        g.rows = g.rows || [];
        g.rows.push(row);
        renumberRows(state.model);
        renderJoins();
        focusRow('#joins li[data-g="' + b.dataset.addrel + '"][data-r="' + (g.rows.length - 1) + '"]');
      });
    });
    $$('#joins [data-delrel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var g = groups[+b.dataset.delrel];
        var row = g.rows[+b.dataset.row];
        g.rows.splice(+b.dataset.row, 1);
        var list = state.edits.newRelRows[g._key] || [];
        var k = list.indexOf(row);
        if (k >= 0) list.splice(k, 1);
        renumberRows(state.model);
        renderJoins(); markRefreshButtons();
      });
    });
    $$('#joins [data-addgrp]').forEach(function (b) {
      b.addEventListener('click', function () {
        var owner = b.dataset.owner;
        var list = state.edits.newGroups[owner] = state.edits.newGroups[owner] || [];
        var ng = blankGroup('Subsquery: NEW_SUBQUERY_' + (list.length + 1));
        ng.rows.push(blankRelRow());
        list.push(ng);
        var at = +b.dataset.addgrp;
        while (at + 1 < groups.length && ownerKeyOf(groups[at + 1], 'g') === owner) at++;
        state.model.groups.splice(at + 1, 0, ng);
        renumberRows(state.model);
        renderJoins();
        focusRow('#joins li[data-g="' + (at + 1) + '"][data-r="0"]');
      });
    });
    $$('#joins [data-delgrp]').forEach(function (b) {
      b.addEventListener('click', function () {
        var gi = +b.dataset.delgrp;
        var g = groups[gi];
        state.model.groups.splice(gi, 1);
        var list = state.edits.newGroups[b.dataset.owner] || [];
        var k = list.indexOf(g);
        if (k >= 0) list.splice(k, 1);
        renderJoins(); markRefreshButtons();
      });
    });
    $$('#joins [data-rf]').forEach(function (el) {
      if (el.tagName === 'TEXTAREA') autoGrow(el);
      el.addEventListener('input', function () {
        var li = el.closest('li');
        var g = groups[+li.dataset.g];
        var r = g.rows[+li.dataset.r];
        r[el.dataset.rf] = el.value;
        if (!r.manual) { noteRelEdit(g, r, el.dataset.rf, el.value); el.classList.add('edited'); }
        if (el.tagName === 'TEXTAREA') autoGrow(el);
        markRefreshButtons();
      });
    });
    markRefreshButtons();
  }

  function renderWarnings() {
    var w = state.model.warnings || [];
    var box = $('#warn');
    if (!w.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<b>ตรวจสอบก่อนส่ง</b><ul>' + w.map(function (x) {
      return '<li>' + esc(x) + '</li>';
    }).join('') + '</ul>';
  }

  /* ------------------------------------------------------------------- DDL */
  /* Expected order: Column name → # → Datatype. Accepts a single pasted run,
     one triple per line, or a CREATE TABLE statement.                        */
  var TYPE_WORD = /^(VARCHAR2?|NVARCHAR2?|CHAR|NCHAR|NUMBER|NUMERIC|DECIMAL|DEC|INT|INTEGER|SMALLINT|BIGINT|FLOAT|REAL|DOUBLE|DATE|TIMESTAMP|INTERVAL|CLOB|NCLOB|BLOB|RAW|LONG|BOOLEAN|BINARY_FLOAT|BINARY_DOUBLE|STRING|TEXT)\b/i;

  function parseDdl(text) {
    var src = String(text || '').trim();
    if (!src) return { entries: [], error: 'ยังไม่ได้ใส่ DDL' };
    var entries = [];

    var ct = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:GLOBAL\s+TEMPORARY\s+|EXTERNAL\s+)?TABLE\b/i.exec(src);
    if (ct) {
      var open = src.indexOf('(', ct.index);
      if (open > -1) {
        var depth = 0, close = -1;
        for (var i = open; i < src.length; i++) {
          if (src[i] === '(') depth++;
          else if (src[i] === ')') { depth--; if (!depth) { close = i; break; } }
        }
        var body = src.slice(open + 1, close > -1 ? close : src.length);
        var parts = [], d = 0, cur = '';
        for (var j = 0; j < body.length; j++) {
          var ch = body[j];
          if (ch === '(') d++;
          if (ch === ')') d--;
          if (ch === ',' && d === 0) { parts.push(cur); cur = ''; continue; }
          cur += ch;
        }
        if (cur.trim()) parts.push(cur);
        parts.forEach(function (line) {
          var t = line.trim().replace(/^"|"$/g, '');
          if (!t || /^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK|PARTITION|KEY)\b/i.test(t)) return;
          var m = /^([A-Za-z_][\w$#]*)\s+([\s\S]+)$/.exec(t.replace(/"/g, ''));
          if (!m) return;
          var type = m[2].replace(/\s+(NOT\s+NULL|NULL|DEFAULT[\s\S]*|PRIMARY\s+KEY|UNIQUE|ENABLE|CHECK[\s\S]*)$/i, '').trim();
          entries.push({ name: m[1], no: entries.length + 1, type: type.replace(/\s*,\s*/g, ',').toUpperCase() });
        });
        if (entries.length) return { entries: entries, mode: 'CREATE TABLE' };
      }
    }

    /* triples: NAME  #  TYPE — tokens keep their own parentheses intact */
    var toks = src.replace(/\s+/g, ' ').trim().split(' ');
    var k = 0, skipped = 0;
    while (k < toks.length) {
      var name = toks[k], no = toks[k + 1], type = toks[k + 2];
      if (!/^[A-Za-z_][\w$#]*$/.test(name) || !/^\d+$/.test(no || '') || !type) {
        k++; skipped++; continue;
      }
      if (/^\(/.test(toks[k + 3] || '')) { type += toks[k + 3]; k++; }   // "NUMBER (18,4)"
      entries.push({ name: name, no: parseInt(no, 10), type: type.toUpperCase().replace(/,$/, '') });
      k += 3;
    }
    if (!entries.length) {
      return { entries: [], error: 'อ่าน DDL ไม่ออก — ต้องเรียงเป็น ชื่อคอลัมน์ / เลขลำดับ / datatype' };
    }
    return { entries: entries, mode: 'triples', skipped: skipped };
  }

  function normType(t) {
    return String(t || '').toUpperCase().replace(/\s+/g, '').replace(/;$/, '');
  }

  function applyDdl(entries) {
    var model = state.model;
    if (!model) return null;
    var byName = {};
    entries.forEach(function (e, i) { byName[e.name.toUpperCase()] = e; e.idx = i; });

    var used = {}, fixed = 0, renamed = 0, offNo = 0, missing = [];
    model.columns.forEach(function (col, i) {
      var e = byName[String(col.name).toUpperCase()];
      var st = { checked: true };
      if (e && e.name === col.name) {
        st.nameStatus = (e.no === i + 1) ? 'ok' : 'ord';
        if (st.nameStatus === 'ord') offNo++;
      } else {
        e = e || entries[i];
        st.nameStatus = 'bad';
        renamed++;
      }
      if (e) {
        used[e.name.toUpperCase()] = 1;
        st.expectedName = e.name;
        st.expectedNo = e.no;
        st.expectedType = e.type;
        if (normType(col.datatype) === normType(e.type)) st.typeStatus = 'ok';
        else if (isColEdited(col, null, 'datatype')) st.typeStatus = 'fix';
        else { col.datatype = e.type; st.typeStatus = 'fix'; fixed++; }
      } else {
        st.nameStatus = 'bad';
        st.expectedName = '';
        st.typeStatus = null;
      }
      col.ddl = st;
    });

    entries.forEach(function (e) { if (!used[e.name.toUpperCase()]) missing.push(e); });
    state.ddl = { entries: entries, missing: missing };
    return { fixed: fixed, renamed: renamed, offNo: offNo, missing: missing, total: entries.length };
  }

  function recheckDdl() {
    if (!state.ddl || !state.ddl.entries) return;
    var res = applyDdl(state.ddl.entries);
    renderLedger();
    renderDdlReport(res);
  }

  var ddlTimer = null;
  function scheduleDdlRecheck() {
    if (!state.ddl || !state.ddl.entries) return;
    clearTimeout(ddlTimer);
    ddlTimer = setTimeout(recheckDdl, 500);
  }

  function nameCellClass(c) {
    if (!c.ddl || !c.ddl.checked) return '';
    return c.ddl.nameStatus === 'ok' ? 'dn-ok' : (c.ddl.nameStatus === 'ord' ? 'dn-ord' : 'dn-bad');
  }
  function typeCellClass(c) {
    if (!c.ddl || !c.ddl.checked || !c.ddl.typeStatus) return '';
    return c.ddl.typeStatus === 'ok' ? 'dt-ok' : 'dt-fix';
  }

  /* character-by-character view of what the DDL expects */
  function nameDiffHtml(c, i) {
    if (!c.ddl || !c.ddl.checked || c.ddl.nameStatus !== 'bad') return '';
    var want = c.ddl.expectedName || '';
    if (!want) return '<span class="namediff">ไม่มีคอลัมน์นี้ใน DDL</span>';
    var have = String(c.name || ''), out = '';
    for (var k = 0; k < want.length; k++) {
      var ch = esc(want[k]);
      out += (want[k] === have[k]) ? ch : '<b>' + ch + '</b>';
    }
    if (have.length > want.length) out += '<b>' + esc('…เกิน ' + (have.length - want.length) + ' ตัว') + '</b>';
    return '<span class="namediff">DDL: ' + out +
      '<button type="button" data-usename="' + i + '">ใช้ชื่อนี้</button></span>';
  }

  function renderDdlReport(res) {
    var box = $('#ddlReport');
    if (!res) { box.innerHTML = ''; box.className = ''; return; }
    box.className = 'ddlreport';
    var legend = '<div class="legend">' +
      '<span><i class="chip" style="border-color:var(--green)"></i>ตรงกันทั้ง # และชื่อ / datatype เดิมถูกอยู่แล้ว</span>' +
      '<span><i class="chip" style="border-color:#5EA3BE"></i>ชื่อตรง แต่ # ไม่ตรง</span>' +
      '<span><i class="chip" style="border-color:#E4705A"></i>ชื่อคอลัมน์ไม่ตรง</span>' +
      '<span><i class="chip" style="border-color:var(--amber)"></i>แก้ datatype ตาม DDL แล้ว</span>' +
      '</div>';
    var lines = '<p>DDL มี <code>' + res.total + '</code> คอลัมน์ · แก้ datatype ให้ <code>' + res.fixed +
      '</code> ช่อง · ชื่อไม่ตรง <code>' + res.renamed + '</code> ช่อง · # ไม่ตรง <code>' + res.offNo + '</code> ช่อง</p>';
    if (res.missing.length) {
      lines += '<p>มีใน DDL แต่ไม่มีใน mapping <code>' + res.missing.length + '</code> คอลัมน์:</p><ul><li>' +
        res.missing.map(function (e) { return esc(e.name) + ' — ' + esc(e.type); }).join('</li><li>') +
        '</li></ul><div class="row"><button class="ghost" id="ddlAddMissing">เพิ่ม ' +
        res.missing.length + ' คอลัมน์นี้เข้า mapping</button></div>';
    }
    box.innerHTML = legend + lines;
    var add = $('#ddlAddMissing');
    if (add) add.addEventListener('click', function () {
      state.ddl.missing.forEach(function (e) {
        var col = blankColumn(e.name);
        col.datatype = e.type;
        state.model.columns.push(col);
      });
      toast('เพิ่ม ' + state.ddl.missing.length + ' คอลัมน์แล้ว');
      recheckDdl();
      renderStats();
    });
  }

  function clearDdl() {
    state.ddl = null;
    if (state.model) state.model.columns.forEach(function (c) { delete c.ddl; });
    renderLedger();
    renderDdlReport(null);
  }

  function setupDdl() {
    $('#addDdl').addEventListener('click', function () {
      var p = $('#ddlPanel');
      p.hidden = !p.hidden;
      if (!p.hidden && typeof p.scrollIntoView === 'function') {
        try { p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { }
      }
    });
    $('#ddlClose').addEventListener('click', function () { $('#ddlPanel').hidden = true; });
    $('#ddlReset').addEventListener('click', function () {
      clearDdl();
      toast('ล้างผลตรวจ DDL แล้ว (datatype ที่แก้ไปแล้วยังอยู่)');
    });
    $('#ddlPick').addEventListener('click', function () { $('#ddlFile').click(); });
    $('#ddlFile').addEventListener('change', function () {
      var f = $('#ddlFile').files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        $('#ddlText').value = fr.result;
        $('#ddlFileName').textContent = f.name;
        $('#ddlApply').click();
      };
      fr.readAsText(f, 'utf-8');
      $('#ddlFile').value = '';
    });
    $('#ddlApply').addEventListener('click', function () {
      if (!state.model) { toast('วิเคราะห์สคริปต์ก่อน แล้วค่อยเทียบ DDL'); return; }
      var out = parseDdl($('#ddlText').value);
      if (out.error) { toast(out.error); return; }
      var res = applyDdl(out.entries);
      renderLedger();
      renderDdlReport(res);
      toast('เทียบ DDL ' + out.entries.length + ' คอลัมน์ — แก้ datatype ' + res.fixed + ' ช่อง');
    });
  }

  /* ------------------------------------------------------------- data flow */
  /* one diagram per script; edits made in the draw.io editor are kept per tab */
  var flowState = { active: null, xml: {}, edited: {} };

  function showView(which) {
    var flow = which === 'flow', er = which === 'er', doc = !flow && !er;
    $('#viewDoc').hidden = !doc;
    $('#viewFlow').hidden = !flow;
    $('#viewEr').hidden = !er;
    $('#navDoc').classList.toggle('is-on', doc);
    $('#navFlow').classList.toggle('is-on', flow);
    $('#navEr').classList.toggle('is-on', er);
    $('#navDoc').setAttribute('aria-selected', String(doc));
    $('#navFlow').setAttribute('aria-selected', String(flow));
    $('#navEr').setAttribute('aria-selected', String(er));
    document.querySelector('.bar').hidden = !doc;
    if (flow) renderFlow();
    if (er) renderEr();
  }

  /* ------------------------------------------------------------ ER diagram */
  var erState = { active: null, code: {} };

  function erList() {
    if (!state.model || !state.model.files) return [];
    return state.model.files.map(function (f, i) {
      var flow = (state.model.flows || []).filter(function (x) { return x.fileIndex === i; })[0];
      return {
        key: 'f' + i, fileIndex: i, file: f.name,
        title: (flow && flow.target) || f.table || f.name
      };
    });
  }

  function activeEr() {
    var list = erList();
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) if (list[i].key === erState.active) return list[i];
    return list[list.length - 1];
  }

  function renderErTabs() {
    var list = erList(), box = $('#erTabs');
    if (list.length < 2) {
      box.hidden = true; box.innerHTML = '';
      $('#erAll').hidden = true; $('#erAllXml').hidden = true;
      return;
    }
    box.hidden = false;
    $('#erAll').hidden = false;
    $('#erAllXml').hidden = false;
    var cur = activeEr();
    box.innerHTML = list.map(function (f) {
      return '<button class="vbtn' + (cur && cur.key === f.key ? ' is-on' : '') + '" data-er="' + f.key + '">' +
        esc(f.title) + '<em>' + esc(f.file) + '</em></button>';
    }).join('');
    $$('#erTabs [data-er]').forEach(function (b) {
      b.addEventListener('click', function () {
        erState.active = b.dataset.er;
        renderEr();
      });
    });
  }

  function erOpts() {
    return {
      showTarget: $('#erShowTarget').checked,
      keysOnly: $('#erKeysOnly').checked
    };
  }

  function renderEr() {
    var box = $('#erCode');
    if (!state.model || !state.model.files || !state.model.files.length) {
      $('#erTabs').hidden = true;
      $('#erStat').innerHTML = '';
      box.value = '';
      box.placeholder = 'ยังไม่มีสคริปต์ — กลับไปหน้าแรก อัพไฟล์ .sql หรือวางโค้ด แล้วกด “วิเคราะห์สคริปต์” ก่อน';
      $('#erNote').textContent = '';
      return;
    }
    renderErTabs();
    var cur = activeEr();
    if (!cur) return;
    erState.active = cur.key;

    var o = erOpts();
    var res;
    try {
      res = SqlMapEr.build(state.model, {
        fileIndex: cur.fileIndex, showTarget: o.showTarget, keysOnly: o.keysOnly
      });
    } catch (e) {
      box.value = '';
      $('#erStat').innerHTML = '';
      toast('สร้าง ER diagram ไม่สำเร็จ: ' + e.message);
      return;
    }
    erState.code[cur.key] = res.text;
    box.value = res.text;
    $('#erStat').innerHTML =
      '<span>' + res.entities + ' ตาราง</span>' +
      '<span>' + res.columns + ' คอลัมน์</span>' +
      '<span>' + res.relations + ' เส้นความสัมพันธ์</span>' +
      '<span>' + esc(cur.file) + '</span>';
    $('#erNote').innerHTML = '<b>ข้อมูลนี้เตรียมไว้สำหรับนำไปวางในหน้า (Page) ใหม่ของ draw.io ' +
      'โดยแยกจากหน้า Data Flow Diagram อย่างชัดเจน</b>' +
      (erList().length > 1 ? ' — และแยกอีก 1 หน้าต่อ 1 สคริปต์ รวม ' + erList().length + ' หน้า' : '');
  }

  function erFileName(f) {
    return (f && f.title ? f.title : (state.meta.tableName || 'er_diagram')) + '_ER.mmd';
  }

  function saveTextFile(text, name, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function downloadEr() {
    var cur = activeEr();
    var code = $('#erCode').value;
    if (!code.trim()) { toast('ยังไม่มีโค้ดให้ดาวน์โหลด'); return; }
    saveTextFile(code, erFileName(cur), 'text/plain');
    toast('ดาวน์โหลดแล้ว: ' + erFileName(cur));
  }

  function downloadAllEr() {
    var list = erList();
    if (!list.length) return;
    var o = erOpts();
    list.forEach(function (f, i) {
      var res = SqlMapEr.build(state.model, {
        fileIndex: f.fileIndex, showTarget: o.showTarget, keysOnly: o.keysOnly
      });
      if (res.text) setTimeout(function () { saveTextFile(res.text, erFileName(f), 'text/plain'); }, i * 400);
    });
    toast('กำลังดาวน์โหลด ' + list.length + ' ไฟล์ .mmd — 1 ไฟล์ = 1 หน้าใน draw.io');
  }

  function erXml() {
    var cur = activeEr();
    if (!cur || !state.model) return '';
    if (erState.xmlEdited && erState.xmlEdited[cur.key]) return erState.xmlEdited[cur.key];
    var o = erOpts();
    try {
      return SqlMapEr.toXml(state.model, {
        fileIndex: cur.fileIndex, showTarget: o.showTarget, keysOnly: o.keysOnly
      });
    } catch (e) {
      toast('สร้าง XML ไม่สำเร็จ: ' + e.message);
      return '';
    }
  }

  function erXmlName(f) {
    return (f && f.title ? f.title : (state.meta.tableName || 'er_diagram')) + '_ER.drawio';
  }

  function openErInDrawio() {
    var xml = erXml();
    if (!xml) { toast('ยังไม่มีไดอะแกรม — วิเคราะห์สคริปต์ก่อน'); return; }
    var cur = activeEr();
    $('#erEditorCard').hidden = false;
    $('#erEditorTitle').textContent = 'draw.io editor — ER: ' + (cur ? cur.title : '');
    var frame = $('#erDrawioFrame');
    frame.src = 'https://embed.diagrams.net/?embed=1&ui=dark&spin=1&proto=json&libraries=1';
    toast('กำลังเปิด draw.io — ต้องต่ออินเทอร์เน็ต ถ้าไม่ขึ้นให้ใช้ปุ่มดาวน์โหลด .drawio');
    try { $('#erEditorCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { }
  }

  function downloadErXml() {
    var xml = erXml();
    if (!xml) { toast('ยังไม่มีไดอะแกรมให้ดาวน์โหลด'); return; }
    var cur = activeEr();
    saveTextFile(xml, erXmlName(cur), 'application/xml');
    toast('ดาวน์โหลดแล้ว: ' + erXmlName(cur));
  }

  function downloadAllErXml() {
    var list = erList();
    if (!list.length) return;
    var o = erOpts();
    list.forEach(function (f, i) {
      var xml = (erState.xmlEdited && erState.xmlEdited[f.key]) || SqlMapEr.toXml(state.model, {
        fileIndex: f.fileIndex, showTarget: o.showTarget, keysOnly: o.keysOnly
      });
      if (xml) setTimeout(function () { saveTextFile(xml, erXmlName(f), 'application/xml'); }, i * 400);
    });
    toast('กำลังดาวน์โหลด ' + list.length + ' ไฟล์ .drawio — 1 ไฟล์ = 1 หน้าใน draw.io');
  }

  function copyErXml() {
    var xml = erXml();
    if (!xml) { toast('ยังไม่มีไดอะแกรมให้คัดลอก'); return; }
    copyText(xml, 'คัดลอก XML แล้ว — ใน draw.io เปิดหน้าใหม่ แล้ว Extras → Edit Diagram → วางทับ');
  }

  function copyText(text, msg) {
    var done = function () { toast(msg); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { toast('คัดลอกไม่สำเร็จ — ใช้ปุ่มดาวน์โหลดแทน'); }
      ta.remove();
    }
  }

  function copyEr() {
    var code = $('#erCode').value;
    if (!code.trim()) { toast('ยังไม่มีโค้ดให้คัดลอก'); return; }
    var done = function () { toast('คัดลอกแล้ว — ใน draw.io เปิดหน้าใหม่ แล้วใช้ + Insert → Advanced → Mermaid'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = $('#erCode');
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { toast('คัดลอกไม่สำเร็จ — ใช้ปุ่มดาวน์โหลด .mmd แทน'); }
    }
  }

  function flowList() {
    if (!state.model || !state.model.flows) return [];
    return state.model.flows.map(function (f, i) {
      return {
        key: 'f' + i, fileIndex: i, file: f.file,
        title: f.target || f.file, label: f.label || f.file
      };
    });
  }

  function activeFlow() {
    var list = flowList();
    if (!list.length) return null;
    if (flowState.active === 'all' && list.length > 1) return { key: 'all', fileIndex: null, title: 'ทุกไฟล์รวมกัน', file: '' };
    var hit = null;
    list.forEach(function (f) { if (f.key === flowState.active) hit = f; });
    return hit || list[0];
  }

  function renderFlowTabs() {
    var list = flowList(), box = $('#flowTabs');
    if (list.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    var cur = activeFlow();
    box.innerHTML = list.map(function (f) {
      return '<button class="vbtn' + (cur && cur.key === f.key ? ' is-on' : '') + '" data-flow="' + f.key + '">' +
        esc(f.title) + (flowState.edited[f.key] ? '<i class="dot" title="แก้ไขแล้ว"></i>' : '') +
        '<em>' + esc(f.file) + '</em></button>';
    }).join('') +
      '<button class="vbtn' + (cur && cur.key === 'all' ? ' is-on' : '') + '" data-flow="all">ทุกไฟล์รวมกัน</button>';

    $$('#flowTabs [data-flow]').forEach(function (b) {
      b.addEventListener('click', function () {
        flowState.active = b.dataset.flow;
        renderFlow();
      });
    });
  }

  function renderFlow() {
    var box = $('#flowPreview');
    if (!state.model || !state.model.flows || !state.model.flows.length) {
      $('#flowTabs').hidden = true;
      box.innerHTML = '<p class="flowempty">ยังไม่มีสคริปต์ — กลับไปหน้าแรก อัพไฟล์ .sql หรือวางโค้ด แล้วกด “วิเคราะห์สคริปต์” ก่อน</p>';
      $('#flowNote').textContent = 'ไดอะแกรมสร้างจากสคริปต์ที่อัพไว้ในหน้าแรก';
      $('#flowAll').hidden = true;
      return;
    }
    renderFlowTabs();
    var cur = activeFlow();
    if (!cur) return;
    flowState.active = cur.key;

    var lay = SqlMapFlow.layout(state.model, { fileIndex: cur.fileIndex });
    if (!lay || !lay.nodes.length) {
      box.innerHTML = '<p class="flowempty">อ่านโครงสร้างจากสคริปต์นี้ไม่ได้</p>';
      return;
    }
    box.innerHTML = SqlMapFlow.toSvg(lay);
    if (!flowState.edited[cur.key]) {
      flowState.xml[cur.key] = SqlMapFlow.toXml(lay, cur.title);
    }

    var srcs = lay.nodes.filter(function (n) { return n.lane === 'src'; }).length;
    var steps = lay.nodes.filter(function (n) { return n.lane === 'step'; }).length;
    $('#flowNote').textContent = cur.title + ' — ' + srcs + ' ตารางต้นทาง · ' + steps +
      ' subquery · ' + lay.edges.length + ' เส้น' +
      (flowState.edited[cur.key] ? ' · มีการแก้ไขใน editor แล้ว' : '');
    $('#flowAll').hidden = flowList().length < 2;
  }

  function currentXml() {
    var cur = activeFlow();
    return cur ? (flowState.xml[cur.key] || '') : '';
  }

  function saveXmlFile(xml, name) {
    var blob = new Blob([xml], { type: 'application/xml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function flowFileName(f) {
    return (f && f.title ? f.title : (state.meta.tableName || 'data_flow')) + '.drawio';
  }

  function downloadFlow() {
    var cur = activeFlow(), xml = currentXml();
    if (!xml) { toast('ยังไม่มีไดอะแกรมให้ดาวน์โหลด'); return; }
    saveXmlFile(xml, flowFileName(cur));
    toast('ดาวน์โหลดแล้ว: ' + flowFileName(cur));
  }

  function downloadAllFlows() {
    var list = flowList();
    if (!list.length) return;
    list.forEach(function (f, i) {
      var xml = flowState.xml[f.key];
      if (!xml) {
        var lay = SqlMapFlow.layout(state.model, { fileIndex: f.fileIndex });
        xml = lay ? SqlMapFlow.toXml(lay, f.title) : '';
        flowState.xml[f.key] = xml;
      }
      if (xml) setTimeout(function () { saveXmlFile(xml, flowFileName(f)); }, i * 400);
    });
    toast('กำลังดาวน์โหลด ' + list.length + ' ไฟล์ .drawio');
  }

  function copyFlow() {
    var xml = currentXml();
    if (!xml) { toast('ยังไม่มีไดอะแกรมให้คัดลอก'); return; }
    var done = function () { toast('คัดลอก XML แล้ว — วางใน draw.io ด้วย Extras → Edit Diagram'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(xml).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = xml; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { toast('คัดลอกไม่สำเร็จ — ใช้ปุ่มดาวน์โหลด .drawio แทน'); }
      ta.remove();
    }
  }

  function resetFlow() {
    var cur = activeFlow();
    if (!cur) return;
    delete flowState.edited[cur.key];
    delete flowState.xml[cur.key];
    renderFlow();
    toast('คืนค่าไดอะแกรมของ ' + cur.title + ' กลับเป็นที่สร้างจากสคริปต์แล้ว');
  }

  function openInDrawio() {
    var cur = activeFlow();
    if (!currentXml()) { toast('ยังไม่มีไดอะแกรม'); return; }
    $('#flowEditorCard').hidden = false;
    $('#flowEditorTitle').textContent = 'draw.io editor — ' + (cur ? cur.title : '');
    var frame = $('#drawioFrame');
    frame.src = 'https://embed.diagrams.net/?embed=1&ui=dark&spin=1&proto=json';
    toast('กำลังเปิด draw.io — ต้องต่ออินเทอร์เน็ต ถ้าไม่ขึ้นให้ใช้ปุ่มดาวน์โหลด .drawio');
  }

  window.addEventListener('message', function (ev) {
    if (ev.origin !== 'https://embed.diagrams.net' && ev.origin !== 'https://app.diagrams.net') return;
    var msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }

    /* กรอบ ER มีของตัวเอง — แยกจากกรอบ Data flow */
    var erFrame = $('#erDrawioFrame');
    if (erFrame && ev.source && erFrame.contentWindow === ev.source) {
      var erCur = activeEr();
      if (msg.event === 'init') {
        erFrame.contentWindow.postMessage(JSON.stringify({ action: 'load', autosave: 1, xml: erXml() }), '*');
      } else if (msg.event === 'save' && msg.xml && erCur) {
        erState.xmlEdited = erState.xmlEdited || {};
        erState.xmlEdited[erCur.key] = msg.xml;
        toast('เก็บงานแก้ ER ของ ' + erCur.title + ' แล้ว — กดดาวน์โหลด .drawio เพื่อเซฟไฟล์');
      }
      return;
    }

    var frame = $('#drawioFrame');
    var cur = activeFlow();
    if (msg.event === 'init' && frame && frame.contentWindow) {
      frame.contentWindow.postMessage(JSON.stringify({ action: 'load', autosave: 1, xml: currentXml() }), '*');
    } else if (msg.event === 'save' && msg.xml && cur) {
      flowState.xml[cur.key] = msg.xml;
      flowState.edited[cur.key] = true;
      renderFlowTabs();
      $('#flowNote').textContent = cur.title + ' — เก็บ XML ที่แก้แล้วไว้ในแท็บนี้ กดดาวน์โหลด .drawio เพื่อเซฟไฟล์';
      toast('เก็บงานแก้ของ ' + cur.title + ' แล้ว');
    }
  });

  /* -------------------------------------------------------------- download */
  function download() {
    if (!state.model) { toast('ยังไม่ได้วิเคราะห์สคริปต์'); return; }
    if (typeof ExcelJS === 'undefined') {
      toast('โหลดไลบรารี ExcelJS ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อแล้วรีเฟรชหน้านี้');
      return;
    }
    var btn = $('#download');
    btn.disabled = true; btn.textContent = 'กำลังสร้างไฟล์…';
    try {
      var wb = SqlMapBuilder.build(ExcelJS, state.model, state.meta);
      wb.xlsx.writeBuffer().then(function (buf) {
        var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = $('#outName').textContent;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        btn.disabled = false; btn.textContent = 'ดาวน์โหลด .xlsx';
        toast('สร้างไฟล์แล้ว: ' + $('#outName').textContent);
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'ดาวน์โหลด .xlsx';
        toast('สร้างไฟล์ไม่สำเร็จ: ' + e.message);
      });
    } catch (e) {
      btn.disabled = false; btn.textContent = 'ดาวน์โหลด .xlsx';
      toast('สร้างไฟล์ไม่สำเร็จ: ' + e.message);
    }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 5200);
  }

  /* ------------------------------------------------------------------ boot */
  var booted = false;
  document.addEventListener('DOMContentLoaded', function () {
    if (booted) return;   /* กันกรณีอีเวนต์ยิงซ้ำ ไม่ให้ผูก handler สองรอบ */
    booted = true;
    setupIntake();
    $('#analyze').addEventListener('click', function () { analyze(); });
    $('#download').addEventListener('click', download);
    $('#clear').addEventListener('click', function () {
      $('#sql').value = '';
      state.files = []; state.active = 0; state.targetIndex = -1;
      state.model = null; state.edits = newEdits(); $('#result').hidden = true;
      renderFiles();
    });
    $('#addCol').addEventListener('click', function () {
      if (!state.model) return;
      var col = blankColumn('');
      state.edits.addedCols.push(col);
      state.model.columns.push(col);
      renderLedger(); renderStats();
    });
    $('#addSource').addEventListener('click', function () {
      if (!state.model) return;
      var blocks = state.model.sourceBlocks;
      var nb = { name: 'SOURCE: NAME ' + (blocks.length + 1), _key: 'X#' + (++keySeq), manual: true };
      state.edits.extraBlocks.push({ name: nb.name, _key: nb._key });
      blocks.push(nb);
      state.model.columns.forEach(function (c) { c.sources.push(blankSource()); });
      /* source ที่เพิ่มเองได้ section ของตัวเองใน Data source summary
         และกลุ่มของตัวเองใน Tables relationship — ว่างเปล่าแต่แก้ไขได้ */
      state.model.sourceSections = state.model.sourceSections || [];
      state.model.sourceSections.push({
        label: nb.name, file: '', manual: true, blockKey: nb._key,
        _key: nb._key + '::sec', table: '', sources: [blankSrcRow()]
      });
      state.edits.newSrcRows[nb._key + '::sec'] =
        state.model.sourceSections[state.model.sourceSections.length - 1].sources.slice();
      state.model.groups = state.model.groups || [];
      var ngm = {
        name: nb.name, isCte: false, isFileHead: true, manual: true,
        blockKey: nb._key, _key: nb._key + '::main', rows: [blankRelRow()], sql: ''
      };
      state.model.groups.push(ngm);
      state.edits.newRelRows[ngm._key] = ngm.rows.slice();
      renumberRows(state.model);
      renderSources(); renderJoins();
      renderLedger();
      toast('เพิ่ม source ที่ ' + blocks.length + ' แล้ว — เลื่อนตารางไปทางขวาเพื่อกรอก');
    });
    $('#addPar').addEventListener('click', function () {
      if (!state.model) return;
      var src = null;
      state.model.columns.forEach(function (c) { if (/_TM_KEY_DAY$/i.test(c.name)) src = c; });
      var col = blankColumn('PAR_KEY');
      col.datatype = 'NUMBER(8,0)';
      col.description = 'Partition key';
      if (src) {
        col.sourceTable = src.sourceTable; col.sourceColumn = src.sourceColumn;
        col.sourceAlias = src.sourceAlias; col.transform = src.transform;
      }
      state.edits.addedCols.push(col);
      state.model.columns.push(col);
      renderLedger(); renderStats();
    });
    $('#rfrLedgerAll').addEventListener('click', function () {
      if (!state.model) return;
      refreshScope('ledger', null, 'Column mapping ทั้งตาราง');
    });
    $('#rfrSourceAll').addEventListener('click', function () {
      if (!state.model) return;
      refreshScope('srcAll', null, 'Data source summary ทั้งหมด');
    });
    $('#rfrJoinAll').addEventListener('click', function () {
      if (!state.model) return;
      refreshScope('relAll', null, 'Tables relationship ทั้งหมด');
    });
    setupDdl();
    $('#navDoc').addEventListener('click', function () { showView('doc'); });
    $('#navFlow').addEventListener('click', function () { showView('flow'); });
    $('#navEr').addEventListener('click', function () { showView('er'); });
    $('#erOpen').addEventListener('click', openErInDrawio);
    $('#erXmlDownload').addEventListener('click', downloadErXml);
    $('#erXmlCopy').addEventListener('click', copyErXml);
    $('#erAllXml').addEventListener('click', downloadAllErXml);
    $('#erCopy').addEventListener('click', copyEr);
    $('#erDownload').addEventListener('click', downloadEr);
    $('#erAll').addEventListener('click', downloadAllEr);
    $('#erRefresh').addEventListener('click', function () {
      var cur = activeEr();
      if (cur && erState.xmlEdited) delete erState.xmlEdited[cur.key];
      renderEr();
      toast('สร้าง ER ใหม่จากสคริปต์แล้ว (ทั้งโค้ด Mermaid และ XML draw.io)');
    });
    $('#erShowTarget').addEventListener('change', renderEr);
    $('#erKeysOnly').addEventListener('change', renderEr);
    $('#flowRefresh').addEventListener('click', resetFlow);
    $('#flowDownload').addEventListener('click', downloadFlow);
    $('#flowAll').addEventListener('click', downloadAllFlows);
    $('#flowCopy').addEventListener('click', copyFlow);
    $('#flowOpen').addEventListener('click', openInDrawio);
    $('#sql').addEventListener('input', saveEditorToFile);
    renderFiles();
    renderFileName();
  });
})();
