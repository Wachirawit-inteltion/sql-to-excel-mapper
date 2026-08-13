/* ============================================================================
   sqlmap.parser — reads an Oracle/Hive style SELECT script and returns a model
   describing target columns, their lineage, source tables and joins.
   ========================================================================== */
(function (global) {
  'use strict';

  var IDENT = /[A-Za-z0-9_$#]/;

  /* ---------- 1. strip comments, keep trailing `--` hints per line ---------- */
  function preprocess(sql) {
    var out = '', hints = {}, line = 0, i = 0, n = sql.length;
    while (i < n) {
      var ch = sql[i];
      if (ch === '\n') { out += ch; line++; i++; continue; }
      if (ch === "'" || ch === '"') {
        var q = ch; out += ch; i++;
        while (i < n) {
          if (sql[i] === q && sql[i + 1] === q) { out += q + q; i += 2; continue; }
          out += sql[i];
          if (sql[i] === '\n') line++;
          if (sql[i] === q) { i++; break; }
          i++;
        }
        continue;
      }
      if (ch === '-' && sql[i + 1] === '-') {
        var j = i;
        while (j < n && sql[j] !== '\n') j++;
        var txt = sql.slice(i + 2, j).trim();
        if (txt) hints[line] = hints[line] ? hints[line] + ' ' + txt : txt;
        i = j;
        continue;
      }
      if (ch === '/' && sql[i + 1] === '*') {
        var k = i + 2, isHint = sql[i + 2] === '+';
        while (k < n && !(sql[k] === '*' && sql[k + 1] === '/')) {
          if (sql[k] === '\n') line++;
          k++;
        }
        var end = Math.min(k + 2, n);
        if (isHint && sql.slice(i, end).indexOf('\n') < 0) out += sql.slice(i, end);
        else out += sql.slice(i, end).replace(/[^\n]/g, ' ');
        i = end;
        continue;
      }
      out += ch; i++;
    }
    return { clean: out, hints: hints };
  }

  /* ---------- 2. depth mask: 0 = top level code, -1 = inside a literal ------ */
  function analyze(s) {
    var mask = new Int32Array(s.length), depth = 0, i = 0;
    while (i < s.length) {
      var ch = s[i];
      if (ch === "'" || ch === '"') {
        var q = ch; mask[i] = -1; i++;
        while (i < s.length) {
          mask[i] = -1;
          if (s[i] === q && s[i + 1] === q) { mask[i + 1] = -1; i += 2; continue; }
          if (s[i] === q) { i++; break; }
          i++;
        }
        continue;
      }
      if (ch === '(') { mask[i] = depth; depth++; i++; continue; }
      if (ch === ')') { depth--; mask[i] = depth; i++; continue; }
      mask[i] = depth; i++;
    }
    return mask;
  }

  function findTop(s, mask, patterns, from) {
    for (var i = from || 0; i < s.length; i++) {
      if (mask[i] !== 0) continue;
      if (i > 0 && IDENT.test(s[i - 1])) continue;
      for (var p = 0; p < patterns.length; p++) {
        patterns[p].lastIndex = i;
        var m = patterns[p].exec(s);
        if (m && m.index === i) {
          var after = s[i + m[0].length];
          if (after && IDENT.test(after)) continue;
          return { index: i, end: i + m[0].length, text: m[0], which: p };
        }
      }
    }
    return null;
  }

  function splitTop(s) {
    var mask = analyze(s), parts = [], start = 0;
    for (var i = 0; i < s.length; i++) {
      if (mask[i] === 0 && s[i] === ',') {
        parts.push({ text: s.slice(start, i), start: start });
        start = i + 1;
      }
    }
    parts.push({ text: s.slice(start), start: start });
    return parts.filter(function (p) { return p.text.trim() !== ''; });
  }

  function splitAnd(s) {
    var mask = analyze(s), parts = [], start = 0, re = /AND\b/giy;
    for (var i = 0; i < s.length; i++) {
      if (mask[i] !== 0) continue;
      if (i > 0 && IDENT.test(s[i - 1])) continue;
      re.lastIndex = i;
      var m = re.exec(s);
      if (m && m.index === i) {
        parts.push(s.slice(start, i));
        start = i + m[0].length;
        i = start - 1;
      }
    }
    parts.push(s.slice(start));
    return parts.map(function (p) { return squash(p); })
      .filter(function (p) { return p && !/^1\s*=\s*1$/.test(p); });
  }

  function squash(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }

  function tidy(t) {
    // keep line breaks (they read well in Excel) but drop indentation noise
    return String(t == null ? '' : t).split('\n')
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l !== ''; })
      .join('\n');
  }

  /* ---------- 3. WITH ... AS ( ... ) extraction ----------------------------- */
  function extractCtes(clean) {
    var mask = analyze(clean);
    var withKw = findTop(clean, mask, [/WITH\b/iy], 0);
    var ctes = [];
    if (!withKw) return { ctes: ctes, mainStart: firstSelect(clean, mask) };

    var pos = withKw.end;
    while (pos < clean.length) {
      var m = /\s*([A-Za-z0-9_$#"]+)\s*(?:\([^)]*\)\s*)?AS\s*\(/iy;
      m.lastIndex = pos;
      var found = m.exec(clean);
      if (!found || found.index !== pos) break;
      var open = found.index + found[0].length - 1;
      var close = matchParen(clean, mask, open);
      if (close < 0) break;
      ctes.push({
        name: found[1].replace(/"/g, ''),
        start: open + 1,
        end: close,
        sql: clean.slice(open + 1, close)
      });
      pos = close + 1;
      var comma = /\s*,/y; comma.lastIndex = pos;
      var c = comma.exec(clean);
      if (c && c.index === pos) { pos = pos + c[0].length; continue; }
      break;
    }
    return { ctes: ctes, mainStart: firstSelect(clean, mask, pos) };
  }

  function firstSelect(s, mask, from) {
    var kw = findTop(s, mask, [/SELECT\b/iy], from || 0);
    return kw ? kw.index : 0;
  }

  function matchParen(s, mask, openIdx) {
    var depth = mask[openIdx];
    for (var i = openIdx + 1; i < s.length; i++) {
      if (mask[i] === -1) continue;
      if (s[i] === ')' && mask[i] === depth) return i;
    }
    return -1;
  }

  /* ---------- 4. one SELECT block ------------------------------------------ */
  var TAIL = [/WHERE\b/iy, /GROUP\s+BY\b/iy, /ORDER\s+BY\b/iy, /HAVING\b/iy,
    /UNION\s+ALL\b/iy, /UNION\b/iy, /MINUS\b/iy, /INTERSECT\b/iy,
    /CONNECT\s+BY\b/iy, /START\s+WITH\b/iy, /FETCH\b/iy];

  function parseBlock(sqlText, base, lineOf, hints, name) {
    var mask = analyze(sqlText);
    var sel = findTop(sqlText, mask, [/SELECT\b/iy], 0);
    if (!sel) return null;
    var listStart = sel.end;
    var hintRe = /\s*\/\*\+[\s\S]*?\*\//y; hintRe.lastIndex = listStart;
    var hm2 = hintRe.exec(sqlText);
    if (hm2 && hm2.index === listStart) listStart = hm2.index + hm2[0].length;
    var pre = /\s*(DISTINCT|UNIQUE|ALL)\b/iy; pre.lastIndex = listStart;
    var pm = pre.exec(sqlText);
    if (pm && pm.index === listStart) listStart = pm.index + pm[0].length;

    var fromKw = findTop(sqlText, mask, [/FROM\b/iy], listStart);
    var listEnd = fromKw ? fromKw.index : sqlText.length;
    var tail = fromKw ? findTop(sqlText, mask, TAIL, fromKw.end) : null;
    var fromText = fromKw ? sqlText.slice(fromKw.end, tail ? tail.index : sqlText.length) : '';

    var whereText = '';
    if (tail && /^WHERE/i.test(tail.text)) {
      var next = findTop(sqlText, mask, TAIL.slice(1), tail.end);
      whereText = sqlText.slice(tail.end, next ? next.index : sqlText.length);
    }

    var groupText = '';
    var gk = findTop(sqlText, mask, [/GROUP\s+BY\b/iy], fromKw ? fromKw.end : listStart);
    if (gk) {
      var gEnd = findTop(sqlText, mask, [/HAVING\b/iy, /ORDER\s+BY\b/iy, /UNION\s+ALL\b/iy,
        /UNION\b/iy, /MINUS\b/iy, /INTERSECT\b/iy, /FETCH\b/iy], gk.end);
      groupText = squash(sqlText.slice(gk.end, gEnd ? gEnd.index : sqlText.length)).trim();
    }

    var items = splitTop(sqlText.slice(listStart, listEnd)).map(function (part) {
      var abs = base + listStart + part.start;
      return parseSelectItem(part.text, abs, lineOf, hints);
    });

    /* the set-operator keyword (if any) can sit anywhere after FROM — not
       necessarily as the very next clause, since WHERE / GROUP BY / HAVING /
       ORDER BY may come first in this branch — so look for it explicitly
       instead of assuming "tail" already is it */
    var setOpKw = fromKw
      ? findTop(sqlText, mask, [/UNION\s+ALL\b/iy, /UNION\b/iy, /MINUS\b/iy, /INTERSECT\b/iy], fromKw.end)
      : null;

    var block = {
      name: name || null,
      sql: tidy(sqlText),
      select: items,
      sources: parseFrom(fromText),
      where: splitAnd(whereText),
      groupBy: groupText,
      setOp: null,
      branches: null,
      hasSetOp: !!setOpKw
    };

    /* UNION / MINUS / INTERSECT: keep every branch, not just the first one */
    if (block.hasSetOp) {
      var setKw = setOpKw;
      if (setKw) {
        block.setOp = squash(setKw.text).toUpperCase();
        var restBlock = parseBlock(sqlText.slice(setKw.end), base + setKw.end, lineOf, hints, name);
        var firstBranch = {
          select: items, sources: block.sources, where: block.where,
          groupBy: groupText, sql: tidy(sqlText.slice(0, setKw.index)), opBefore: null
        };
        block.branches = [firstBranch];
        if (restBlock) {
          /* each branch remembers the actual operator that precedes it, so a
             CTE mixing UNION ALL / MINUS / INTERSECT across 3+ branches keeps
             the right operator per transition instead of reusing the first */
          if (restBlock.branches) {
            restBlock.branches[0].opBefore = block.setOp;
            block.branches = block.branches.concat(restBlock.branches);
          } else block.branches.push({
            select: restBlock.select, sources: restBlock.sources, where: restBlock.where,
            groupBy: restBlock.groupBy, sql: restBlock.sql, opBefore: block.setOp
          });
        }
      }
    }
    return block;
  }

  function parseSelectItem(text, absStart, lineOf, hints) {
    var raw = text;
    var trimmed = raw.replace(/\s+$/, '');
    var lastCharAbs = absStart + trimmed.length - 1;
    var hint = hints[lineOf(lastCharAbs)] || '';

    var expr = squash(raw), alias = null;
    var mask = analyze(expr);
    var asKw = null;
    for (var i = expr.length - 1; i >= 0; i--) {
      if (mask[i] !== 0) continue;
      var re = /AS\b/iy; re.lastIndex = i;
      var m = re.exec(expr);
      if (m && m.index === i && (i === 0 || !IDENT.test(expr[i - 1]))) { asKw = { index: i, end: i + 2 }; break; }
    }
    if (asKw) {
      var tailTxt = expr.slice(asKw.end).trim();
      if (/^[A-Za-z0-9_$#"]+$/.test(tailTxt)) {
        alias = tailTxt.replace(/"/g, '');
        expr = expr.slice(0, asKw.index).trim();
      }
    } else {
      var im = /^(.*?[)\w"$#])\s+([A-Za-z0-9_$#"]+)$/.exec(expr);
      if (im && !/^(FROM|WHERE|AND|OR|ON|JOIN)$/i.test(im[2]) && /^[\w$#."]+$/.test(im[1]) === false) {
        // expression + implicit alias (e.g. `NVL(a,b) x`)
        alias = im[2].replace(/"/g, '');
        expr = im[1].trim();
      } else if (im && /^[\w$#."]+$/.test(im[1])) {
        alias = im[2].replace(/"/g, '');
        expr = im[1].trim();
      }
    }

    var simple = /^([A-Za-z0-9_$#"]+)\.([A-Za-z0-9_$#"*]+)$/.exec(expr);
    var bare = /^([A-Za-z0-9_$#"]+)$/.exec(expr);
    var ref = null;
    if (simple) ref = { alias: simple[1].replace(/"/g, ''), column: simple[2].replace(/"/g, '') };
    else if (bare) ref = { alias: null, column: bare[1].replace(/"/g, '') };
    else {
      var first = /([A-Za-z0-9_$#]+)\.([A-Za-z0-9_$#]+)/.exec(expr);
      if (first) ref = { alias: first[1], column: first[2] };
    }

    return {
      expr: expr,
      alias: alias,
      hint: hint,
      ref: ref,
      isSimple: !!(simple || bare),
      name: alias || (simple ? simple[2].replace(/"/g, '') : (bare ? bare[1].replace(/"/g, '') : expr))
    };
  }

  /* ---------- 5. FROM / JOIN ----------------------------------------------- */
  var JOIN_RE = /(?:(?:INNER|CROSS)\s+|(?:LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+)?JOIN\b/iy;

  function parseFrom(fromText) {
    if (!fromText.trim()) return [];
    var mask = analyze(fromText), cuts = [], i;
    for (i = 0; i < fromText.length; i++) {
      if (mask[i] !== 0) continue;
      if (fromText[i] === ',') { cuts.push({ index: i, end: i + 1, type: 'CROSS JOIN' }); continue; }
      if (i > 0 && IDENT.test(fromText[i - 1])) continue;
      JOIN_RE.lastIndex = i;
      var m = JOIN_RE.exec(fromText);
      if (m && m.index === i) {
        cuts.push({ index: i, end: i + m[0].length, type: squash(m[0]).toUpperCase() });
        i = i + m[0].length - 1;
      }
    }
    var segs = [], prev = 0, type = null;
    for (i = 0; i < cuts.length; i++) {
      segs.push({ type: type, text: fromText.slice(prev, cuts[i].index) });
      type = cuts[i].type; prev = cuts[i].end;
    }
    segs.push({ type: type, text: fromText.slice(prev) });

    return segs.map(function (seg) {
      var s = parseSourceRef(seg.text);
      s.joinType = seg.type;
      return s;
    }).filter(function (s) { return s.table || s.subSql; });
  }

  function parseSourceRef(txt) {
    var res = { schema: '', table: '', alias: '', on: '', subSql: null };
    var t = txt.trim();
    if (!t) return res;
    var mask = analyze(t);
    var onKw = findTop(t, mask, [/ON\b/iy, /USING\b/iy], 0);
    var head = onKw ? t.slice(0, onKw.index) : t;
    if (onKw) res.on = tidy(t.slice(onKw.end).trim());
    head = head.trim();

    var rest;
    if (head[0] === '(') {
      var hm = analyze(head);
      var close = matchParen(head, hm, 0);
      res.subSql = head.slice(1, close);
      rest = head.slice(close + 1);
    } else {
      var nm = /^([A-Za-z0-9_$#".]+)/.exec(head);
      if (!nm) return res;
      var full = nm[1].replace(/"/g, '').split('.');
      res.table = full.pop();
      res.schema = full.join('.');
      rest = head.slice(nm[0].length);
    }
    var am = /^\s*(?:AS\s+)?([A-Za-z0-9_$#"]+)/i.exec(rest);
    if (am && !/^(ON|WHERE|GROUP|ORDER|HAVING|UNION|LEFT|RIGHT|INNER|FULL|CROSS|JOIN)$/i.test(am[1])) {
      res.alias = am[1].replace(/"/g, '');
    }
    return res;
  }

  /* ---------- 6. lineage ---------------------------------------------------- */
  function upper(s) { return String(s || '').toUpperCase(); }

  function buildContext(block, cteMap) {
    var map = {};
    (block.sources || []).forEach(function (src, idx) {
      var key = upper(src.alias || src.table);
      var cte = src.table ? cteMap[upper(src.table)] : null;
      map[key] = {
        idx: idx, alias: src.alias || src.table, schema: src.schema,
        table: src.table, cte: cte || src.inlineNode || null, subSql: src.subSql || null
      };
    });
    return { block: block, aliases: map, cteMap: cteMap };
  }

  /* inline views: ( SELECT ... ) alias  -> parse into their own block so that
     lineage keeps resolving and their base tables reach the source summary */
  function expandInline(block, bag, warnings, depth) {
    if (!block || depth > 6) return;
    (block.sources || []).forEach(function (src) {
      if (!src.subSql || src.inlineNode) return;
      var nm = src.alias || ('INLINE_' + (bag.length + 1));
      var inner = parseBlock(src.subSql, 0, function () { return -1; }, {}, nm);
      if (!inner) { warnings.push('อ่าน subquery ในวงเล็บ (' + nm + ') ไม่สำเร็จ'); return; }
      var node = { name: nm, block: inner, ctx: null, isInline: true };
      src.inlineNode = node;
      bag.push(node);
      expandInline(inner, bag, warnings, depth + 1);
    });
  }

  var EXPR_WORDS = ('SELECT|FROM|WHERE|AND|OR|NOT|CASE|WHEN|THEN|ELSE|END|AS|NULL|IS|IN|LIKE|BETWEEN|' +
    'DISTINCT|OVER|PARTITION|ORDER|GROUP|BY|ASC|DESC|CAST|INTERVAL|DATE|TIMESTAMP').split('|');

  // first plain (undotted) column name inside an expression, e.g. SUM(AMT) -> AMT
  function bareColumn(expr) {
    var s = String(expr || '').replace(/'[^']*'/g, "''");
    var re = /([A-Za-z_][A-Za-z0-9_$#]*)\s*(\(|\.)?/g, m;
    while ((m = re.exec(s))) {
      if (m[2]) continue;                                   // function call or qualified name
      if (EXPR_WORDS.indexOf(upper(m[1])) !== -1) continue;  // keyword
      return m[1];
    }
    return '';
  }

  function resolve(ctx, aliasName, column, depth) {
    depth = depth || 0;
    var keys = Object.keys(ctx.aliases);
    var entry = aliasName ? ctx.aliases[upper(aliasName)] : (keys.length === 1 ? ctx.aliases[keys[0]] : null);
    if (!entry || depth > 6) {
      return { label: aliasName ? '(' + aliasName + ')' : '', schema: '', column: column, alias: aliasName || '', resolved: false, transform: '' };
    }
    if (!entry.cte) {
      return {
        label: entry.table, schema: entry.schema, column: column,
        alias: entry.alias, resolved: true, transform: ''
      };
    }
    var inner = entry.cte;
    var pfx = inner.prefix === undefined ? 'Subsquery: ' : inner.prefix;
    var item = null;
    for (var i = 0; i < inner.block.select.length; i++) {
      if (upper(inner.block.select[i].name) === upper(column)) { item = inner.block.select[i]; break; }
    }
    if (!item || !item.ref) {
      var innerSrcs = (inner.block.sources || []).filter(function (s) { return s.table || s.subSql; });
      if (item && innerSrcs.length === 1) {
        var guess = bareColumn(item.expr) || column;
        var one = resolve(inner.ctx, innerSrcs[0].alias || innerSrcs[0].table, guess, depth + 1);
        return {
          label: pfx + inner.name + (one.label ? ' (' + one.label.replace(/^Subsquery: /, '') + ')' : ''),
          schema: '',
          column: one.column || guess,
          alias: entry.alias + (one.alias ? ' (' + one.alias + ')' : ''),
          resolved: one.resolved,
          transform: item.isSimple ? '' : item.expr
        };
      }
      return {
        label: pfx + inner.name, schema: '', column: column,
        alias: entry.alias, resolved: false, transform: item ? (item.isSimple ? '' : item.expr) : ''
      };
    }
    var innerCtx = inner.ctx;
    var down = resolve(innerCtx, item.ref.alias, item.ref.column, depth + 1);
    return {
      label: pfx + inner.name + (down.label ? ' (' + down.label.replace(/^Subsquery: /, '') + ')' : ''),
      schema: '',
      column: down.column,
      alias: entry.alias + (down.alias ? ' (' + down.alias + ')' : ''),
      resolved: down.resolved,
      transform: item.isSimple ? '' : item.expr
    };
  }

  /* ---------- 7. datatype guess -------------------------------------------- */
  var PII_RE = /^MSISDN$|PHONE|MOBILE_?NO|TEL_?NO|EMAIL|ID_?CARD|CITIZEN|PASSPORT|NATIONAL_?ID|FIRST_?NAME|LAST_?NAME|FULL_?NAME|CUST_?NAME|BIRTH|_DOB$|^DOB$|ADDRESS|ADDR_/;
  function looksPII(col) { return PII_RE.test(upper(col)); }

  function guessType(col, hint, expr) {
    var h = upper(hint);
    var sized = /\b(VARCHAR2?|NVARCHAR2?|CHAR|NUMBER|DECIMAL|NUMERIC)\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\)/.exec(h);
    if (sized) {
      var t = sized[0].replace(/\s+/g, '');
      if (/^VARCHAR\(/.test(t)) t = 'VARCHAR2' + t.slice(7);
      if (/^(DECIMAL|NUMERIC)\(/.test(t)) t = 'NUMBER' + t.slice(t.indexOf('('));
      return t;
    }
    if (/\bDATE\b/.test(h) && !/KEY/.test(h)) return 'DATE';
    if (/TIMESTAMP/.test(h)) return 'TIMESTAMP';
    if (/\bINT\b|INTEGER/.test(h)) return 'NUMBER(8,0)';
    if (/DECIMAL|NUMERIC|DOUBLE|FLOAT/.test(h)) return 'NUMBER(18,2)';
    if (/NUMBER/.test(h)) return 'NUMBER';
    if (/STRING|VARCHAR|CHAR/.test(h)) return 'VARCHAR2(50)';

    var e = upper(expr || ''), c = upper(col || '');
    if (/^TO_DATE\(|^TRUNC\(|^SYSDATE/.test(e)) return 'DATE';
    if (/^TO_NUMBER\(|^COUNT\(|^SUM\(|^ROW_NUMBER\(/.test(e)) return 'NUMBER(8,0)';
    if (/(^|_)(DT|DATE|TIME)$/.test(c)) return 'DATE';
    if (/(TM_KEY_DAY|_KEY|PAR_KEY|_QTY|_AMT|_CNT|_NUM)$/.test(c)) return 'NUMBER(8,0)';
    if (/(_ID|_CD|_NBR|MSISDN|_FLG|_NM|_DSCR|_RSN)$/.test(c)) return 'VARCHAR2(50)';
    return 'VARCHAR2(50)';
  }

  /* ---------- 8. public entry ---------------------------------------------- */
  function parseSql(sqlText, opts) {
    opts = opts || {};
    var warnings = [];
    var pp = preprocess(sqlText || '');
    var clean = pp.clean;

    var lineStarts = [0];
    for (var i = 0; i < clean.length; i++) if (clean[i] === '\n') lineStarts.push(i + 1);
    function lineOf(pos) {
      var lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; }
      return lo;
    }

    var banner = /-{4,}\s*([A-Za-z0-9_$#]+)\s*-{4,}/.exec(sqlText || '');
    var insertInto = /INSERT\s+(?:OVERWRITE\s+)?(?:INTO\s+)?TABLE\s+([A-Za-z0-9_$#.]+)/i.exec(sqlText || '')
      || /INSERT\s+INTO\s+([A-Za-z0-9_$#.]+)/i.exec(sqlText || '');
    var targetTable = insertInto ? insertInto[1].split('.').pop() : (banner ? banner[1] : '');
    if (!targetTable && opts.fallbackName) targetTable = opts.fallbackName;

    var ex = extractCtes(clean);
    var cteMap = {};
    // tables produced by scripts uploaded earlier resolve like sub-queries
    Object.keys(opts.externals || {}).forEach(function (k) { cteMap[k] = opts.externals[k]; });
    var ctes = ex.ctes.map(function (c) {
      var b = parseBlock(c.sql, c.start, lineOf, pp.hints, c.name);
      if (!b) warnings.push('อ่าน subquery "' + c.name + '" ไม่สำเร็จ');
      var node = { name: c.name, block: b, ctx: null };
      cteMap[upper(c.name)] = node;
      return node;
    }).filter(function (n) { return n.block; });

    var inlineNodes = [];
    ctes.forEach(function (n) { expandInline(n.block, inlineNodes, warnings, 0); });
    ctes.forEach(function (n) { n.ctx = buildContext(n.block, cteMap); });

    var mainSqlText = clean.slice(ex.mainStart);
    var main = parseBlock(mainSqlText, ex.mainStart, lineOf, pp.hints, targetTable || 'MAIN');
    if (!main) return { ok: false, error: 'ไม่พบคำสั่ง SELECT ในสคริปต์', warnings: warnings };
    expandInline(main, inlineNodes, warnings, 0);
    inlineNodes.forEach(function (n) { n.ctx = buildContext(n.block, cteMap); });
    var mainCtx = buildContext(main, cteMap);
    if (main.hasSetOp) warnings.push('พบ UNION / MINUS — เอกสารจะอ้างอิงเฉพาะ SELECT ชุดแรก');

    /* target columns */

  /* ---------- column lineage ------------------------------------------------
     Follows every ALIAS.COLUMN in the final expression back through the
     sub-queries it came from, collecting the physical tables it ends at and
     the chain of expressions on the way (including UNION branches).          */
  function refsOf(expr) {
    var out = [], seen = {};
    var stripped = String(expr || '').replace(/'[^']*'/g, "''");
    var re = /([A-Za-z_][\w$#]*)\s*\.\s*([A-Za-z_][\w$#]*)/g, m;
    while ((m = re.exec(stripped))) {
      var k = upper(m[1]) + '.' + upper(m[2]);
      if (seen[k]) continue;
      seen[k] = 1;
      out.push({ alias: m[1], column: m[2] });
    }
    return out;
  }

  function branchesOf(block) {
    return (block.branches && block.branches.length > 1) ? block.branches : [block];
  }

  function outputsFor(node, column, cteMap, depth) {
    var res = [];
    branchesOf(node.block).forEach(function (br) {
      var ctx = br === node.block ? node.ctx : buildContext({ sources: br.sources || [] }, cteMap);
      var item = null;
      (br.select || []).forEach(function (it) {
        if (!item && upper(it.name) === upper(column)) item = it;
      });
      if (item) { res.push({ expr: item.expr, ctx: ctx, isSimple: item.isSimple }); return; }
      /* SELECT * — the column belongs to whatever the branch reads from */
      var star = (br.select || []).some(function (it) { return /(^|\.)\*$/.test(String(it.expr).trim()); });
      if (star && depth < 6) {
        (br.sources || []).forEach(function (src) {
          var key = upper(src.alias || src.table);
          var entry = ctx.aliases[key];
          if (entry && entry.cte) {
            outputsFor(entry.cte, column, cteMap, depth + 1).forEach(function (o) { res.push(o); });
          }
        });
      }
    });
    return res;
  }

  function traceColumn(ctx, aliasName, column, acc, depth) {
    var entry = ctx.aliases[upper(aliasName)];
    if (!entry) return null;
    if (!entry.cte) {
      if (entry.table && acc.bases.indexOf(entry.table) === -1) acc.bases.push(entry.table);
      return { label: entry.table || '', schema: entry.schema || '', isBase: true };
    }
    var inner = entry.cte;
    if (depth < 8) {
      var outs = outputsFor(inner, column, acc.cteMap, 0);
      if (outs.length) {
        var exprs = outs.map(function (o) { return o.expr; });
        var joiner = '\n' + ((inner.block && inner.block.setOp) || 'UNION') + '\n';
        var line = aliasName + '.' + column +
          (exprs.length > 1 ? ' =\n' + exprs.join(joiner) : ' = ' + exprs[0]);
        if (acc.lines.indexOf(line) === -1) acc.lines.push(line);
        outs.forEach(function (o) {
          refsOf(o.expr).forEach(function (r) {
            traceColumn(o.ctx, r.alias, r.column, acc, depth + 1);
          });
        });
      }
    }
    return { label: inner.name, isBase: false, schema: '' };
  }

  function lineageOf(item, ctx, cteMap) {
    var res = {
      schema: '', table: '', column: '', alias: '',
      remark: '', resolved: false
    };
    var refs = refsOf(item.expr).filter(function (r) { return ctx.aliases[upper(r.alias)]; });
    if (!refs.length) return res;

    var tables = [], cols = [], aliases = [], lines = [], schema = '';
    refs.forEach(function (r) {
      var acc = { lines: [], bases: [], cteMap: cteMap };
      var hit = traceColumn(ctx, r.alias, r.column, acc, 0);
      if (!hit) return;
      var label;
      if (hit.isBase) {
        label = hit.label;
        if (!schema) schema = hit.schema || '';
      } else {
        var bases = acc.bases.slice().sort();
        label = 'Subsquery: ' + hit.label + (bases.length ? '(' + bases.join(', ') + ')' : '');
      }
      if (label && tables.indexOf(label) === -1) tables.push(label);
      var disp = r.alias + '.' + r.column;
      if (cols.indexOf(disp) === -1) cols.push(disp);
      if (aliases.indexOf(r.alias) === -1) aliases.push(r.alias);
      acc.lines.forEach(function (l) { if (lines.indexOf(l) === -1) lines.push(l); });
    });

    res.schema = tables.length === 1 && tables[0].indexOf('Subsquery: ') !== 0 ? schema : '';
    res.table = tables.join(', ');
    res.column = cols.join(', ');
    res.alias = aliases.join(',');
    res.remark = lines.length ? 'Remark: \n' + lines.join('\n') : '';
    res.resolved = !!tables.length;
    return res;
  }

    var columns = main.select.map(function (item, idx) {
      var star = /\*/.test(item.expr);
      if (star) warnings.push('มี SELECT * — ไม่สามารถแตกรายชื่อคอลัมน์ได้');
      var r = lineageOf(item, mainCtx, cteMap);
      if (refsOf(item.expr).length && !r.resolved) {
        warnings.push('หา source ของคอลัมน์ ' + item.name + ' ไม่เจอ');
      }
      return {
        no: idx + 1,
        name: item.name,
        datatype: guessType(item.name, item.hint, item.expr),
        pk: false, index: false, pii: looksPII(item.name), piiType: '',
        description: '', sample: '', remark: '',
        schema: r.schema || '',
        sourceTable: r.table || '',
        sourceColumn: r.column || '',
        sourceAlias: r.alias || '',
        transform: item.isSimple ? '' : item.expr,
        sourceRemark: r.remark || '',
        expr: item.expr,
        hint: item.hint
      };
    });

    /* physical sources + delta criteria */
    var sourceIndex = {}, sources = [];
    function noteSource(schema, table) {
      var key = upper(schema + '.' + table);
      if (!table || sourceIndex[key]) return sourceIndex[key];
      var rec = {
        no: sources.length + 1, system: 'ORACLE', schema: schema || '', table: table,
        tableType: 'Transaction', selection: 'Full load', delta: '', filter: '', remark: ''
      };
      sourceIndex[key] = rec; sources.push(rec);
      return rec;
    }

    var allBlocks = ctes.map(function (n) { return { name: 'Subsquery: ' + n.name, block: n.block, ctx: n.ctx, isCte: true }; });
    inlineNodes.forEach(function (n) {
      allBlocks.push({ name: 'Subsquery: ' + n.name, block: n.block, ctx: n.ctx, isCte: true });
    });
    allBlocks.push({ name: targetTable || 'TARGET', block: main, ctx: mainCtx, isCte: false });

    var MASTER_RE = /^(DIM_|R_|REF_|LKP_|LOOKUP_|MST_|MASTER_|CD_|CODE_)/i;

    function noteConditions(bl, conds, fallback) {
      conds.forEach(function (cond) {
        /* only date-driven predicates are a delta window; a bare ${PARAM} that
           carries no date at all is just another filter */
        var isDelta = /:BEG_DT|:END_DT|\bSYSDATE\b|VAR_DATE|BEG_DT|END_DT/i.test(cond) ||
          (/\$\{/.test(cond) && /(DATE|TIMESTAMP|_DT\b|_TM\b|PPN_TM|UPD_TM)/i.test(cond));
        var stripped = cond.replace(/'[^']*'/g, "''");

        /* how many different sources does this predicate touch? two or more and
           it is a join condition, which belongs in the relationship table only */
        var seenAlias = {}, distinct = 0, mm;
        var scan = /([A-Za-z0-9_$#]+)\s*\.\s*[A-Za-z0-9_$#]+/g;
        while ((mm = scan.exec(stripped))) {
          var e2 = bl.ctx.aliases[upper(mm[1])];
          if (!e2) continue;
          if (!seenAlias[upper(mm[1])]) { seenAlias[upper(mm[1])] = 1; distinct++; }
        }
        if (!isDelta && distinct > 1) return;

        /* unqualified predicate — credit the first physical table of the block */
        if (!distinct && fallback) {
          if (isDelta) {
            fallback.delta = fallback.delta ? fallback.delta + '\nAND ' + cond : cond;
            fallback.selection = 'Delta load';
          } else if (!fallback.filter || fallback.filter.indexOf(cond) === -1) {
            fallback.filter = fallback.filter ? fallback.filter + '\nAND ' + cond : cond;
          }
          return;
        }

        /* a predicate can mention several aliases — credit every physical one */
        var re = /([A-Za-z0-9_$#]+)\s*\.\s*[A-Za-z0-9_$#]+/g, m, hit = {};
        while ((m = re.exec(stripped))) {
          var entry = bl.ctx.aliases[upper(m[1])];
          if (!entry || entry.cte || !entry.table) continue;
          var rec = sourceIndex[upper((entry.schema || '') + '.' + entry.table)];
          if (!rec || hit[rec.table]) continue;
          hit[rec.table] = 1;
          if (isDelta) {
            if (!rec.delta || rec.delta.indexOf(cond) === -1) {
              rec.delta = rec.delta ? rec.delta + '\nAND ' + cond : cond;
            }
            rec.selection = 'Delta load';
          } else if (!rec.filter || rec.filter.indexOf(cond) === -1) {
            rec.filter = rec.filter ? rec.filter + '\nAND ' + cond : cond;
          }
        }
      });
    }

    allBlocks.forEach(function (bl) {
      var blocks = branchesOf(bl.block);
      blocks.forEach(function (br) {
        (br.sources || []).forEach(function (src) {
          if (src.table && !cteMap[upper(src.table)]) noteSource(src.schema, src.table);
        });
      });
      blocks.forEach(function (br) {
        var ctx = br === bl.block ? bl.ctx : buildContext({ sources: br.sources || [] }, cteMap);
        var scope = { ctx: ctx };
        var firstPhys = null;
        (br.sources || []).forEach(function (src) {
          if (!firstPhys && src.table && !cteMap[upper(src.table)]) {
            firstPhys = sourceIndex[upper((src.schema || '') + '.' + src.table)] || null;
          }
        });
        noteConditions(scope, br.where || [], firstPhys);
        /* delta / filter predicates often live in the JOIN ... ON clause */
        (br.sources || []).forEach(function (src) {
          if (src.on) noteConditions(scope, splitAnd(src.on), firstPhys);
        });
      });
    });

    sources.forEach(function (s) {
      if (MASTER_RE.test(s.table)) s.tableType = 'Master';
      if (!s.delta) s.selection = 'Full load';
    });

    /* join groups */
    /* Table A is the side the ON condition actually points back to — not simply
       the previous line of the FROM chain, which is what a join tree really is. */
    function partnerOf(srcs, i) {
      var b = srcs[i];
      var cond = b.on || '';
      if (cond) {
        var aliases = {}, m, re = /([A-Za-z_][\w$#]*)\s*\.\s*[A-Za-z_][\w$#]*/g;
        var stripped = cond.replace(/'[^']*'/g, "''");
        while ((m = re.exec(stripped))) aliases[upper(m[1])] = (aliases[upper(m[1])] || 0) + 1;
        var mine = upper(b.alias || b.table);
        for (var j = i - 1; j >= 0; j--) {
          var cand = upper(srcs[j].alias || srcs[j].table);
          if (cand !== mine && aliases[cand]) return srcs[j];
        }
      }
      return srcs[i - 1];
    }

    var ordered = allBlocks.length
      ? [allBlocks[allBlocks.length - 1]].concat(allBlocks.slice(0, -1))
      : [];
    var groups = ordered.map(function (bl) {
      var rows = [];
      var b0 = bl.block;
      var whereOf = function (blk) {
        return blk.where && blk.where.length ? 'Where condition:\n' + blk.where.join('\nAND ') : '';
      };
      var aggOf = function (blk) {
        return blk.groupBy ? 'Aggregate by: ' + blk.groupBy : '';
      };

      function rowsFor(blk) {
        var out = [], srcs = blk.sources || [];
        for (var i = 1; i < srcs.length; i++) {
          var b = srcs[i], a = partnerOf(srcs, i);
          out.push({
            tableA: labelOf(a, cteMap), aliasA: a.alias || a.table || '',
            tableB: labelOf(b, cteMap), aliasB: b.alias || b.table || '',
            joinType: b.joinType || 'JOIN',
            condition: b.on ? 'ON ' + b.on : ''
          });
        }
        if (!out.length && srcs.length === 1) {
          out.push({
            tableA: labelOf(srcs[0], cteMap), aliasA: srcs[0].alias || srcs[0].table || '',
            tableB: '', aliasB: '', joinType: '', condition: ''
          });
        }
        return out;
      }

      if (b0.branches && b0.branches.length > 1) {
        /* a set operation: show the branches joined by UNION / MINUS / INTERSECT */
        b0.branches.forEach(function (br, bi) {
          var sub = rowsFor(br);
          if (bi > 0 && sub.length && br.sources && br.sources.length) {
            var prev = b0.branches[bi - 1].sources[0];
            var here = br.sources[0];
            rows.push({
              no: rows.length + 1,
              tableA: labelOf(prev, cteMap), aliasA: prev.alias || prev.table || '',
              tableB: labelOf(here, cteMap), aliasB: here.alias || here.table || '',
              joinType: br.opBefore || b0.setOp || 'UNION', condition: '',
              condWhere: whereOf(br), remark: aggOf(br)
            });
            if (br.sources.length > 1) {
              sub.forEach(function (r) {
                r.no = rows.length + 1; r.condWhere = ''; r.remark = '';
                rows.push(r);
              });
            }
            return;
          }
          /* skip a trivial single-table first branch (nothing to join) — but
             only when it really has nothing to say; a WHERE/GROUP BY on that
             branch would otherwise vanish since the union row that follows
             only carries the *next* branch's own condition, never this one's */
          if (bi === 0 && sub.length === 1 && !sub[0].tableB &&
            !(br.where && br.where.length) && !br.groupBy) return;
          sub.forEach(function (r, ri) {
            r.no = rows.length + 1;
            r.condWhere = ri === 0 ? whereOf(br) : '';
            r.remark = ri === 0 ? aggOf(br) : '';
            rows.push(r);
          });
        });
      } else {
        rowsFor(b0).forEach(function (r, ri) {
          r.no = rows.length + 1;
          r.condWhere = ri === 0 ? whereOf(b0) : '';
          r.remark = ri === 0 ? aggOf(b0) : '';
          rows.push(r);
        });
      }
      return { name: bl.name, isCte: bl.isCte, rows: rows, sql: bl.isCte ? bl.block.sql : '' };
    });

    /* graph of the script, used to draw the data-flow diagram */
    function inputsOf(b) {
      var out = [], seenIn = {}, all = [];
      branchesOf(b).forEach(function (br) { (br.sources || []).forEach(function (x) { all.push(x); }); });
      all.forEach(function (s) {
        var nm, kind;
        if (s.subSql) { nm = s.inlineNode ? s.inlineNode.name : (s.alias || 'inline'); kind = 'step'; }
        else { nm = s.table; kind = cteMap[upper(s.table)] ? 'step' : 'table'; }
        if (!nm || seenIn[upper(nm)]) return;
        seenIn[upper(nm)] = 1;
        out.push({ name: nm, schema: kind === 'table' ? (s.schema || '') : '', kind: kind });
      });
      return out;
    }
    var flowSteps = [];
    ctes.forEach(function (n) { flowSteps.push({ name: n.name, inline: false, inputs: inputsOf(n.block) }); });
    inlineNodes.forEach(function (n) { flowSteps.push({ name: n.name, inline: true, inputs: inputsOf(n.block) }); });

    return {
      ok: true,
      targetTable: targetTable || '',
      columns: columns,
      sources: sources,
      groups: groups,
      cteNames: ctes.map(function (n) { return n.name; }),
      warnings: warnings,
      flow: {
        target: targetTable || '',
        steps: flowSteps,
        main: { inputs: inputsOf(main), joins: (main.sources || []).length },
        columnCount: columns.length
      },
      // lets a later script resolve columns that come from this script's table
      producedNode: { name: targetTable || '', block: main, ctx: mainCtx, prefix: '' }
    };
  }

  function labelOf(src, cteMap) {
    if (src.subSql) return 'Subsquery: ' + (src.inlineNode ? src.inlineNode.name : (src.alias || 'inline'));
    if (src.table && cteMap[upper(src.table)]) {
      var node = cteMap[upper(src.table)];
      return (node.prefix === undefined ? 'Subsquery: ' : node.prefix) + src.table;
    }
    return src.table || '';
  }

  /* ---------- 9. several linked scripts ------------------------------------ */
  /* files: [{ name, sql }] in dependency order — the last one (or targetIndex)
     is the script that builds the documented table; earlier scripts are treated
     as upstream steps so lineage keeps going back to the real base tables.     */
  function parseSqlSet(files, targetIndex) {
    files = (files || []).filter(function (f) { return f && String(f.sql || '').trim(); });
    if (!files.length) return { ok: false, error: 'ยังไม่มีสคริปต์ให้อ่าน', warnings: [] };

    var ti = (targetIndex === undefined || targetIndex < 0 || targetIndex >= files.length)
      ? files.length - 1 : targetIndex;

    /* every script is read on its own — one source block per file */
    var warnings = [], parsed = [];
    files.forEach(function (f) {
      var m;
      try { m = parseSql(f.sql, { fallbackName: baseName(f.name) }); }
      catch (err) { warnings.push(f.name + ': อ่านไม่สำเร็จ — ' + err.message); parsed.push(null); return; }
      if (!m || !m.ok) { warnings.push(f.name + ': ' + (m ? m.error : 'อ่านไม่สำเร็จ')); parsed.push(null); return; }
      (m.warnings || []).forEach(function (w) { warnings.push(f.name + ': ' + w); });
      parsed.push(m);
    });
    if (!parsed.some(Boolean)) {
      return { ok: false, error: 'อ่านสคริปต์ไม่สำเร็จสักไฟล์', warnings: warnings };
    }

    var n = files.length;
    /* one editable label per script, reused by V1 / Data Source Summary /
       Tables Relationship so renaming it once renames it everywhere          */
    function label(i) {
      var nm = files[i].name || '';
      if (!nm || /^pasted\.sql$/i.test(nm)) return 'SOURCE: NAME ' + (i + 1);
      return 'SOURCE: ' + nm;
    }
    function emptySources() {
      var a = [];
      for (var k = 0; k < n; k++) a.push({ schema: '', table: '', column: '', alias: '', transform: '', remark: '' });
      return a;
    }

    /* columns merged by name, target script first so its order wins */
    var order = [], byName = {};
    var seq = [ti];
    for (var i = 0; i < n; i++) if (i !== ti) seq.push(i);
    seq.forEach(function (fi) {
      var m = parsed[fi];
      if (!m) return;
      m.columns.forEach(function (c) {
        var key = upper(c.name), rec = byName[key];
        if (!rec) {
          rec = {
            no: order.length + 1, name: c.name, datatype: c.datatype,
            pk: c.pk, index: c.index, pii: c.pii, piiType: c.piiType,
            description: c.description, sample: c.sample, remark: c.remark,
            schema: '', sourceTable: '', sourceColumn: '', sourceAlias: '', transform: '',
            sources: emptySources()
          };
          byName[key] = rec; order.push(key);
        }
        if (!rec.datatype) rec.datatype = c.datatype;
        rec.pii = rec.pii || c.pii;
        rec.sources[fi] = {
          schema: c.schema || '', table: c.sourceTable || '', column: c.sourceColumn || '',
          alias: c.sourceAlias || '', transform: c.transform || '', remark: c.sourceRemark || ''
        };
      });
    });
    var columns = order.map(function (k, i) {
      var rec = byName[k];
      rec.no = i + 1;
      for (var j = 0; j < n; j++) {
        var sv = rec.sources[j];
        if (sv && (sv.table || sv.column)) {
          rec.schema = sv.schema; rec.sourceTable = sv.table; rec.sourceColumn = sv.column;
          rec.sourceAlias = sv.alias; rec.transform = sv.transform; rec.sourceRemark = sv.remark;
          break;
        }
      }
      return rec;
    });

    /* one Data Source Summary section and one relationship section per file */
    var sourceSections = [], groups = [], flat = [], seen = {};
    files.forEach(function (f, i) {
      var m = parsed[i];
      var head = label(i);
      sourceSections.push({
        label: head, fileIndex: i, file: f.name,
        table: m ? m.targetTable : '', sources: m ? m.sources : []
      });
      if (!m) return;
      m.sources.forEach(function (s) {
        var key = upper((s.schema || '') + '.' + s.table);
        if (seen[key]) return;
        seen[key] = 1; flat.push(s);
      });
      m.groups.forEach(function (g, gi) {
        groups.push({
          name: gi === 0 ? head : g.name,
          isCte: gi !== 0, rows: g.rows, sql: g.sql,
          file: f.name, fileIndex: i, isFileHead: gi === 0
        });
      });
    });

    var tm = parsed[ti];
    return {
      ok: true,
      targetTable: tm ? tm.targetTable : label(ti),
      columns: columns,
      sources: flat,
      sourceSections: sourceSections,
      groups: groups,
      sourceBlocks: files.map(function (f, i) {
        return { name: label(i), file: f.name, fileIndex: i, fromFile: true };
      }),
      cteNames: tm ? tm.cteNames : [],
      flows: files.map(function (f, i) {
        var m = parsed[i];
        if (!m) return { file: f.name, label: label(i), target: '', steps: [], main: { inputs: [] } };
        return {
          file: f.name, label: label(i), fileIndex: i,
          target: m.flow.target || baseName(f.name),
          steps: m.flow.steps, main: m.flow.main, columnCount: m.flow.columnCount
        };
      }),
      warnings: warnings,
      files: files.map(function (f, i) {
        return {
          name: f.name, table: label(i), isTarget: i === ti,
          columns: parsed[i] ? parsed[i].columns.length : 0, ok: !!parsed[i]
        };
      })
    };
  }

  function baseName(name) {
    return String(name || '').replace(/\.[A-Za-z0-9]+$/, '').trim();
  }

  var api = { parseSql: parseSql, parseSqlSet: parseSqlSet, guessType: guessType, _preprocess: preprocess };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SqlMapParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
