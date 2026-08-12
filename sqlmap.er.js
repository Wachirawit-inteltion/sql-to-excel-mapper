/* ============================================================================
   sqlmap.er — ER diagram (Mermaid erDiagram) generator
   อ่านจากโมเดลเดียวกับที่ใช้ทำเอกสาร mapping: ตาราง/คอลัมน์จาก Column mapping
   และเส้น PK–FK จาก ON condition ใน Tables relationship — แยกออกเป็นชุดละสคริปต์
   ========================================================================== */
(function (global) {
  'use strict';

  var MASTER_RE = /^(DIM_|R_|REF_|LKP_|LOOKUP_|MST_|MASTER_|CD_|CODE_)/i;
  var PAIR_RE = /([A-Za-z_][\w$#]*)\s*\.\s*([A-Za-z_][\w$#]*)\s*=\s*([A-Za-z_][\w$#]*)\s*\.\s*([A-Za-z_][\w$#]*)/g;

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  function entityName(label) {
    var t = String(label == null ? '' : label).trim();
    if (!t) return '';
    t = t.replace(/^Subsquery\s*:\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '');
    t = t.split(',')[0].trim().split('.').pop();
    t = t.replace(/[^A-Za-z0-9_]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
    if (!t) return '';
    if (/^[0-9]/.test(t)) t = 'T_' + t;
    return t.toUpperCase();
  }

  function typeWord(t) {
    var v = String(t == null ? '' : t).replace(/\s+/g, '').toUpperCase();
    var m = /^[A-Z0-9_]+/.exec(v);
    return m && m[0] ? m[0] : 'string';
  }

  function colName(c) {
    var t = String(c == null ? '' : c).trim().replace(/[^A-Za-z0-9_]/g, '_');
    return t ? t.toUpperCase() : '';
  }

  var REF_RE = /([A-Za-z_][\w$#]*)\s*\.\s*([A-Za-z_][\w$#]*)/g;
  function scanRefs(text, cb) {
    var t = String(text == null ? '' : text), m;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(t))) cb(m[1], m[2]);
  }

  function safeText(t) {
    return String(t == null ? '' : t).replace(/"/g, "'").replace(/[\r\n]+/g, ' ').trim();
  }

  /* ------------------------------------------------------------- โครงเอนทิตี */
  function newEnt(name) {
    return { name: name, schema: '', kind: 'table', cols: {}, order: [], deg: 0 };
  }

  function addCol(ent, col, type, opt) {
    var n = colName(col);
    if (!n || !ent) return null;
    var rec = ent.cols[n];
    if (!rec) {
      rec = { name: n, type: typeWord(type), full: String(type || '').trim(), pk: false, fk: false, note: '' };
      ent.cols[n] = rec; ent.order.push(n);
    }
    if (type && (!rec.full || rec.type === 'string')) { rec.type = typeWord(type); rec.full = String(type).trim(); }
    if (opt && opt.pk) rec.pk = true;
    if (opt && opt.fk) rec.fk = true;
    if (opt && opt.note && !rec.note) rec.note = safeText(opt.note);
    return rec;
  }

  /* ทะเบียนคอลัมน์รวมทุกสคริปต์ — ใช้เติมคอลัมน์ให้ตารางกลางที่สคริปต์อื่นสร้าง */
  function globalColumns(model) {
    var reg = {};
    function put(ent, col, type, note) {
      var n = colName(col);
      if (!ent || !n) return;
      var e = reg[ent] || (reg[ent] = { cols: {}, order: [] });
      if (!e.cols[n]) { e.cols[n] = { name: n, type: type || '', note: note || '' }; e.order.push(n); }
      else if (type && !e.cols[n].type) e.cols[n].type = type;
    }
    (model.sourceBlocks || []).forEach(function (b, bi) {
      var alias = {};
      (model.groups || []).forEach(function (g) {
        if (g.fileIndex !== b.fileIndex) return;
        (g.rows || []).forEach(function (r) {
          if (r.aliasA && r.tableA) alias[up(r.aliasA)] = entityName(r.tableA);
          if (r.aliasB && r.tableB) alias[up(r.aliasB)] = entityName(r.tableB);
        });
      });
      (model.columns || []).forEach(function (c) {
        var sv = (c.sources || [])[bi];
        if (!sv) return;
        var toks = String(sv.column || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        var single = toks.length === 1;
        toks.forEach(function (tok) {
          var parts = tok.split('.');
          var ent = parts.length > 1 ? alias[up(parts[0])] : entityName(sv.table);
          put(ent, parts.length > 1 ? parts[1] : parts[0], single ? c.datatype : '', single ? c.name : '');
        });
        scanRefs(sv.remark, function (a, col) { if (alias[up(a)]) put(alias[up(a)], col, '', ''); });
      });
      (model.groups || []).forEach(function (g) {
        if (g.fileIndex !== b.fileIndex) return;
        (g.rows || []).forEach(function (r) {
          scanRefs(r.condition, function (a, col) { if (alias[up(a)]) put(alias[up(a)], col, '', ''); });
        });
      });
    });
    return reg;
  }

  /* ---------------------------------------------------- อ่านข้อมูลของ 1 สคริปต์ */
  function collect(model, fileIndex, opts) {
    var ents = {}, order = [], rels = [], relIndex = {}, alias = {};
    var groups = (model.groups || []).filter(function (g) {
      return fileIndex === null || fileIndex === undefined || g.fileIndex === fileIndex;
    });

    function ent(label) {
      var n = entityName(label);
      if (!n) return null;
      if (!ents[n]) { ents[n] = newEnt(n); order.push(n); }
      if (/^Subsquery\s*:/i.test(String(label || ''))) ents[n].kind = 'sub';
      return ents[n];
    }

    /* ตารางจริง + schema จาก Data source summary ของสคริปต์นี้ */
    var sections = (model.sourceSections || []).filter(function (sec) {
      return fileIndex === null || fileIndex === undefined || sec.fileIndex === fileIndex;
    });
    var typeOf = {};
    sections.forEach(function (sec) {
      (sec.sources || []).forEach(function (sv) {
        var e = ent(sv.table);
        if (!e) return;
        e.schema = sv.schema || e.schema;
        e.kind = 'table';
        typeOf[e.name] = sv.tableType || '';
      });
    });

    /* alias -> entity จาก Tables relationship */
    groups.forEach(function (g) {
      (g.rows || []).forEach(function (r) {
        if (r.aliasA && r.tableA) alias[up(r.aliasA)] = entityName(r.tableA);
        if (r.aliasB && r.tableB) alias[up(r.aliasB)] = entityName(r.tableB);
        if (r.tableA) ent(r.tableA);
        if (r.tableB) ent(r.tableB);
      });
    });

    /* คอลัมน์จาก Column mapping ของ source block ที่ตรงกับสคริปต์นี้ */
    var bi = -1;
    (model.sourceBlocks || []).forEach(function (b, i) {
      if (b.fileIndex === fileIndex) bi = i;
    });
    if (bi >= 0) {
      (model.columns || []).forEach(function (c) {
        var sv = (c.sources || [])[bi];
        if (!sv) return;
        var toks = String(sv.column || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        var single = toks.length === 1;
        toks.forEach(function (tok) {
          var parts = tok.split('.');
          var e, col;
          if (parts.length > 1) { e = ents[alias[up(parts[0])]] || ent(alias[up(parts[0])] || ''); col = parts[1]; }
          else { e = ent(sv.table); col = parts[0]; }
          if (!e) return;
          addCol(e, col, single ? c.datatype : '', { note: single ? c.name : '' });
        });
        scanRefs(sv.remark, function (a, col) {
          var e = ents[alias[up(a)]];
          if (e) addCol(e, col, '', {});
        });
      });
    }

    /* เส้น PK – FK จาก ON condition */
    function isMaster(name) {
      return MASTER_RE.test(name) || /^(Master|Reference)$/i.test(typeOf[name] || '');
    }
    groups.forEach(function (g, gi) {
      (g.rows || []).forEach(function (r) {
        if (!r.tableA || !r.tableB) return;
        var ea = ent(r.tableA), eb = ent(r.tableB);
        if (!ea || !eb) return;
        var pairs = [], m;
        PAIR_RE.lastIndex = 0;
        var cond = String(r.condition || '');
        while ((m = PAIR_RE.exec(cond))) {
          var e1 = ents[alias[up(m[1])]] || (up(m[1]) === up(r.aliasA) ? ea : (up(m[1]) === up(r.aliasB) ? eb : null));
          var e2 = ents[alias[up(m[3])]] || (up(m[3]) === up(r.aliasA) ? ea : (up(m[3]) === up(r.aliasB) ? eb : null));
          if (!e1 || !e2 || e1 === e2) continue;
          pairs.push({ e1: e1, c1: m[2], e2: e2, c2: m[4] });
        }
        var pkSide, fkSide;
        if (pairs.length) {
          var p0 = pairs[0];
          var mA = isMaster(p0.e1.name), mB = isMaster(p0.e2.name);
          if (mA && !mB) { pkSide = p0.e1; fkSide = p0.e2; }
          else if (mB && !mA) { pkSide = p0.e2; fkSide = p0.e1; }
          else { pkSide = (p0.e2 === eb) ? p0.e2 : p0.e1; fkSide = (pkSide === p0.e1) ? p0.e2 : p0.e1; }
        } else {
          pkSide = isMaster(eb.name) || !isMaster(ea.name) ? eb : ea;
          fkSide = pkSide === eb ? ea : eb;
        }
        var labels = [], colPairs = [];
        pairs.forEach(function (p) {
          var pk = p.e1 === pkSide ? p.c1 : p.c2;
          var fk = p.e1 === pkSide ? p.c2 : p.c1;
          addCol(pkSide, pk, '', { pk: true });
          addCol(fkSide, fk, '', { fk: true });
          var l = colName(pk) === colName(fk) ? colName(pk) : (colName(pk) + ' = ' + colName(fk));
          if (labels.indexOf(l) === -1) labels.push(l);
          colPairs.push({ pk: colName(pk), fk: colName(fk) });
        });
        var key = pkSide.name + '>' + fkSide.name;
        var rec = relIndex[key];
        if (!rec) {
          rec = {
            pk: pkSide.name, fk: fkSide.name, group: g.name || '', gi: gi,
            isCte: !!g.isCte, joinType: r.joinType || '', keys: [], cols: [],
            identifying: pairs.length > 0
          };
          relIndex[key] = rec; rels.push(rec);
        }
        labels.forEach(function (l) { if (rec.keys.indexOf(l) === -1) rec.keys.push(l); });
        colPairs.forEach(function (p) {
          var dup = rec.cols.some(function (x) { return x.pk === p.pk && x.fk === p.fk; });
          if (!dup) rec.cols.push(p);
        });
        if (!rec.joinType && r.joinType) rec.joinType = r.joinType;
        pkSide.deg++; fkSide.deg++;
      });
    });

    /* ตารางปลายทางของสคริปต์นี้ */
    var target = null;
    if (opts.showTarget) {
      var flow = (model.flows || []).filter(function (f) { return f.fileIndex === fileIndex; })[0];
      var tname = (flow && flow.target) || (sections[0] && sections[0].table) || model.targetTable || '';
      var te = ent(tname);
      if (te) {
        te.kind = 'target';
        target = te;
        var isDocTarget = (model.files || []).some(function (f, i) { return i === fileIndex && f.isTarget; });
        if (isDocTarget) {
          (model.columns || []).forEach(function (c) {
            addCol(te, c.name, c.datatype, { pk: !!c.pk });
          });
        }
        /* ตารางที่ป้อนให้ query หลัก -> เส้นประไปยังตารางปลายทาง */
        var mainG = groups.filter(function (g) { return !g.isCte; })[0];
        var feeders = [];
        if (mainG) {
          (mainG.rows || []).forEach(function (r) {
            [r.tableA, r.tableB].forEach(function (t) {
              var n = entityName(t);
              if (n && n !== te.name && feeders.indexOf(n) === -1) feeders.push(n);
            });
          });
        }
        feeders.forEach(function (n) {
          var key = n + '>' + te.name;
          if (relIndex[key]) return;
          var rec = {
            pk: n, fk: te.name, group: 'load', gi: -1, isCte: false,
            joinType: '', keys: [], cols: [], identifying: false, load: true
          };
          relIndex[key] = rec; rels.push(rec);
          if (ents[n]) ents[n].deg++;
          te.deg++;
        });
      }
    }

    /* ตารางที่อ่านคอลัมน์จากสคริปต์นี้ไม่ได้ (เช่นตารางกลางที่สคริปต์อื่นสร้าง)
       ให้ยืมรายชื่อคอลัมน์จากสคริปต์อื่นที่อ้างถึงตารางเดียวกัน */
    var reg = opts.registry || {};
    order.forEach(function (n) {
      var e = ents[n];
      if (!e || e.order.length >= (e.kind === 'target' ? 1 : 1)) {
        if (e && e.order.length) return;
      }
      var g = reg[n];
      if (!g) return;
      g.order.forEach(function (k) {
        addCol(e, k, g.cols[k].type, { note: g.cols[k].note });
      });
    });

    return { ents: ents, order: order, rels: rels, target: target };
  }

  /* จัดลำดับเส้นแบบ BFS จากตารางที่เชื่อมเยอะสุด — ลดเส้นตัดกันตอน draw.io เรนเดอร์ */
  function orderRels(data) {
    var rels = data.rels.slice();
    if (rels.length < 2) return rels;
    var adj = {};
    rels.forEach(function (r) {
      (adj[r.pk] = adj[r.pk] || []).push(r);
      (adj[r.fk] = adj[r.fk] || []).push(r);
    });
    var names = Object.keys(adj).sort(function (a, b) {
      return (adj[b].length - adj[a].length) || (a < b ? -1 : 1);
    });
    var out = [], done = {}, seen = {};
    names.forEach(function (start) {
      if (seen[start]) return;
      var queue = [start];
      seen[start] = 1;
      while (queue.length) {
        var cur = queue.shift();
        adj[cur].slice().sort(function (a, b) {
          return (a.gi - b.gi) || (a.pk < b.pk ? -1 : 1);
        }).forEach(function (r) {
          var k = r.pk + '>' + r.fk;
          if (done[k]) return;
          done[k] = 1; out.push(r);
          var other = r.pk === cur ? r.fk : r.pk;
          if (!seen[other]) { seen[other] = 1; queue.push(other); }
        });
      }
    });
    rels.forEach(function (r) { if (!done[r.pk + '>' + r.fk]) out.push(r); });
    var joins = out.filter(function (r) { return !r.load; });
    var loads = out.filter(function (r) { return !!r.load; });
    return joins.concat(loads);
  }

  function arrow(rel) {
    if (rel.load) return '||..o{';
    if (/LEFT|RIGHT|FULL|OUTER/i.test(rel.joinType || '')) return '||..o{';
    if (/UNION|MINUS|INTERSECT/i.test(rel.joinType || '')) return '}o..o{';
    return '||--o{';
  }

  function relLabel(rel) {
    if (rel.load) return 'load';
    var keys = rel.keys.length ? rel.keys.join(' + ') : (rel.joinType || 'join');
    var jt = rel.joinType ? ' (' + safeText(rel.joinType) + ')' : '';
    return safeText(keys + jt);
  }

  /* ------------------------------------------------------------ ออกเป็นข้อความ */
  /* ลำดับตาราง + คอลัมน์ที่จะแสดง — ใช้ร่วมกันทั้งฝั่ง Mermaid และ draw.io */
  function entityView(data, rels, opts) {
    var used = {};
    rels.forEach(function (r) { used[r.pk] = 1; used[r.fk] = 1; });
    var names = data.order.slice().filter(function (n) { return data.ents[n]; });
    names.sort(function (a, b) {
      var ea = data.ents[a], eb = data.ents[b];
      var ra = (ea.kind === 'target' ? 0 : (used[a] ? 1 : 2));
      var rb = (eb.kind === 'target' ? 0 : (used[b] ? 1 : 2));
      if (ra !== rb) return ra - rb;
      if (eb.deg !== ea.deg) return eb.deg - ea.deg;
      return a < b ? -1 : 1;
    });
    return names.map(function (n) {
      var e = data.ents[n];
      var cols = e.order.map(function (k) { return e.cols[k]; });
      if (opts && opts.keysOnly) {
        var keys = cols.filter(function (c) { return c.pk || c.fk; });
        if (keys.length) cols = keys;
      }
      cols = cols.slice().sort(function (a, b) {
        var ra = a.pk ? 0 : (a.fk ? 1 : 2), rb = b.pk ? 0 : (b.fk ? 1 : 2);
        return ra - rb;
      });
      return { ent: e, name: n, cols: cols };
    });
  }

  function render(data, head, opts) {
    var rels = orderRels(data);
    var lines = ['erDiagram'];
    var pad = '    ';

    lines.push(pad + '%% ' + new Array(66).join('='));
    (head || []).forEach(function (h) { lines.push(pad + '%% ' + safeText(h)); });
    lines.push(pad + '%% ' + new Array(66).join('='));

    if (rels.length) {
      var lastGroup = null;
      lines.push('');
      lines.push(pad + '%% ---------- ความสัมพันธ์ (PK -> FK) ----------');
      rels.forEach(function (r) {
        var gname = r.load ? 'โหลดเข้าตารางปลายทาง' : (r.group || 'main query');
        if (gname !== lastGroup) {
          lines.push('');
          lines.push(pad + '%% -- ' + safeText(gname) + ' --');
          lastGroup = gname;
        }
        lines.push(pad + r.pk + ' ' + arrow(r) + ' ' + r.fk + ' : "' + relLabel(r) + '"');
      });
    }

    lines.push('');
    lines.push(pad + '%% ---------- ตารางและคอลัมน์ ----------');

    var view = entityView(data, rels, opts);
    var entCount = 0, colCount = 0;
    view.forEach(function (v) {
      var e = v.ent, n = v.name, cols = v.cols;
      entCount++;
      lines.push('');
      var tag = e.kind === 'target'
        ? 'ตารางปลายทางของสคริปต์นี้'
        : (e.kind === 'sub' ? 'subquery / CTE ในสคริปต์นี้'
          : (e.schema ? e.schema + '.' + e.name + ' (source table)' : 'source table'));
      lines.push(pad + '%% ' + tag);
      lines.push(pad + n + ' {');
      if (!cols.length) lines.push(pad + pad + 'string NO_COLUMN_DETECTED');
      cols.forEach(function (c) {
        colCount++;
        var key = c.pk ? ' PK' : (c.fk ? ' FK' : '');
        var note = c.full && c.full.toUpperCase() !== c.type ? c.full : (c.note || '');
        lines.push(pad + pad + c.type + ' ' + c.name + key + (note ? ' "' + safeText(note) + '"' : ''));
      });
      lines.push(pad + '}');
    });

    return { text: lines.join('\n') + '\n', entities: entCount, columns: colCount, relations: rels.length };
  }

  /* ----------------------------------------------------- draw.io (mxGraph) */
  var W = 260, HEAD = 28, ROW = 22, GAP_X = 60, GAP_Y = 90;

  function xe(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var ENT_STYLE = 'swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=' + HEAD +
    ';horizontalStack=0;resizeParent=0;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;' +
    'html=1;whiteSpace=wrap;fontSize=12;align=center;verticalAlign=middle;';
  var ROW_STYLE = 'text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=8;' +
    'spacingRight=8;overflow=hidden;points=[[0,0.5,0,0,0],[1,0.5,0,0,0]];portConstraint=eastwest;' +
    'rotatable=0;whiteSpace=wrap;html=1;fontSize=11;fontFamily=Courier New;';

  function entColors(kind) {
    if (kind === 'target') return 'fillColor=#d5e8d4;strokeColor=#82b366;';
    if (kind === 'sub') return 'fillColor=#e1d5e7;strokeColor=#9673a6;';
    return 'fillColor=#dae8fc;strokeColor=#6c8ebf;';
  }

  function layerOf(v) {
    if (v.ent.kind === 'target') return 2;
    if (v.ent.kind === 'sub') return 1;
    return 0;
  }

  function toXml(model, opts) {
    opts = opts || {};
    var fi = (opts.fileIndex === undefined) ? null : opts.fileIndex;
    var data = collect(model, fi, {
      showTarget: opts.showTarget !== false,
      registry: globalColumns(model)
    });
    var rels = orderRels(data);
    var view = entityView(data, rels, { keysOnly: !!opts.keysOnly });
    if (!view.length) return '';

    /* วางเป็นชั้น: ตารางต้นทาง -> subquery/CTE -> ตารางปลายทาง */
    var layers = [[], [], []];
    view.forEach(function (v) { layers[layerOf(v)].push(v); });
    var boxes = {}, cells = [], y = 40;
    layers.forEach(function (list) {
      if (!list.length) return;
      var totalW = list.length * W + (list.length - 1) * GAP_X;
      var x = 40 + Math.max(0, (1400 - totalW) / 2);
      var maxH = 0;
      list.forEach(function (v, i) {
        var h = HEAD + Math.max(1, v.cols.length) * ROW;
        boxes[v.name] = { v: v, x: x, y: y, h: h, id: 'ent' + i + '_' + layers.indexOf(list) };
        x += W + GAP_X;
        if (h > maxH) maxH = h;
      });
      y += maxH + GAP_Y;
    });

    var idn = 0;
    view.forEach(function (v) {
      var b = boxes[v.name];
      b.id = 'E' + (++idn);
      var e = v.ent;
      var sub = e.kind === 'target' ? 'target table'
        : (e.kind === 'sub' ? 'subquery / CTE' : (e.schema || 'source'));
      var label = '<b>' + xe(v.name) + '</b><br><font style="font-size:9px;">' + xe(sub) + '</font>';
      cells.push('<mxCell id="' + b.id + '" value="' + xe(label) + '" style="' + ENT_STYLE + entColors(e.kind) +
        '" vertex="1" parent="1"><mxGeometry x="' + Math.round(b.x) + '" y="' + Math.round(b.y) +
        '" width="' + W + '" height="' + b.h + '" as="geometry"/></mxCell>');
      b.rows = {};
      if (!v.cols.length) {
        cells.push('<mxCell id="' + b.id + 'R0" value="' + xe('(no column detected)') + '" style="' + ROW_STYLE +
          '" vertex="1" parent="' + b.id + '"><mxGeometry y="' + HEAD + '" width="' + W +
          '" height="' + ROW + '" as="geometry"/></mxCell>');
      }
      v.cols.forEach(function (c, ci) {
        var rid = b.id + 'R' + ci;
        b.rows[c.name] = rid;
        var key = c.pk ? 'PK' : (c.fk ? 'FK' : '&nbsp;&nbsp;');
        var tail = c.full || (c.type === 'string' ? '' : c.type);
        var txt = '<b>' + key + '</b> ' + xe(c.name) + (tail ? '<font color="#7A8A99"> : ' + xe(tail) + '</font>' : '');
        cells.push('<mxCell id="' + rid + '" value="' + xe(txt) + '" style="' + ROW_STYLE +
          '" vertex="1" parent="' + b.id + '"><mxGeometry y="' + (HEAD + ci * ROW) + '" width="' + W +
          '" height="' + ROW + '" as="geometry"/></mxCell>');
      });
    });

    var en = 0;
    rels.forEach(function (r) {
      var a = boxes[r.pk], b = boxes[r.fk];
      if (!a || !b) return;
      var dashed = r.load || /LEFT|RIGHT|FULL|OUTER/i.test(r.joinType || '');
      var style = 'edgeStyle=entityRelationEdgeStyle;rounded=0;html=1;fontSize=10;' +
        'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;' +
        'startArrow=ERmandOne;startFill=0;endArrow=ERmany;endFill=0;' +
        (dashed ? 'dashed=1;strokeColor=#9673A6;' : 'dashed=0;strokeColor=#4D6B85;');
      var pairs = (r.cols || []).filter(function (p) { return a.rows[p.pk] && b.rows[p.fk]; });
      if (pairs.length) {
        pairs.forEach(function (p) {
          cells.push('<mxCell id="R' + (++en) + '" value="' + xe(p.pk === p.fk ? p.pk : p.pk + ' = ' + p.fk) +
            '" style="' + style + '" edge="1" parent="1" source="' + a.rows[p.pk] + '" target="' + b.rows[p.fk] +
            '"><mxGeometry relative="1" as="geometry"/></mxCell>');
        });
      } else {
        cells.push('<mxCell id="R' + (++en) + '" value="' + xe(r.load ? 'load' : relLabel(r)) +
          '" style="' + style + '" edge="1" parent="1" source="' + a.id + '" target="' + b.id +
          '"><mxGeometry relative="1" as="geometry"/></mxCell>');
      }
    });

    var f = (model.files || [])[fi];
    var flow = (model.flows || []).filter(function (x) { return x.fileIndex === fi; })[0];
    var title = 'ER — ' + ((flow && flow.target) || (f && f.table) || model.targetTable || 'script');

    return '<mxfile host="sqlmap" type="device">' +
      '<diagram id="er' + (fi === null ? 'all' : fi) + '" name="' + xe(title) + '">' +
      '<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" ' +
      'arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">' +
      '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' + cells.join('') +
      '</root></mxGraphModel></diagram></mxfile>';
  }

  function build(model, opts) {
    opts = opts || {};
    if (!model) return { text: '', entities: 0, columns: 0, relations: 0 };
    var fi = (opts.fileIndex === undefined) ? null : opts.fileIndex;
    var data = collect(model, fi, {
      showTarget: opts.showTarget !== false,
      registry: globalColumns(model)
    });
    var f = (model.files || [])[fi];
    var flow = (model.flows || []).filter(function (x) { return x.fileIndex === fi; })[0];
    var head = [
      'ER Diagram — ' + ((flow && flow.target) || (f && f.table) || model.targetTable || 'script'),
      f ? ('script: ' + f.name) : '',
      'สร้างจากสคริปต์ SQL อัตโนมัติ — วางในหน้าใหม่ของ draw.io (Insert > Advanced > Mermaid)'
    ].filter(Boolean);
    return render(data, head, { keysOnly: !!opts.keysOnly });
  }

  global.SqlMapEr = { build: build, toXml: toXml, entityName: entityName };
})(typeof window !== 'undefined' ? window : globalThis);
