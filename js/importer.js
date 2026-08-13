/*
 * 导入导出解析器
 * 支持：
 *  1. 本应用自己的 JSON 备份（app: "energy-tracker"）
 *  2. 小熊油耗官方 CSV 导出格式（油耗记录 12 字段 / 费用记录 5 字段）
 *  3. 通用 CSV（表头自动识别：日期、里程、充电量、费用、电价、电量百分比等）
 * 导出：
 *  本应用自己的 JSON 备份 / CSV 记录
 */
(function (global) {
  'use strict';

  function stripBOM(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }

  /* 简易 RFC4180 CSV 解析：支持引号包裹、转义引号、CRLF */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    const s = stripBOM(String(text));
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else if (c === '\r') {
        /* 忽略，交给 \n 处理 */
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* 全角转半角、小写、去空白，用于表头匹配 */
  function norm(s) {
    return String(s || '')
      .replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? null : n;
  }

  function round(v, d) {
    if (v === null || v === undefined || isNaN(v)) return null;
    const p = Math.pow(10, d === undefined ? 2 : d);
    return Math.round(v * p) / p;
  }

  function normDate(s) {
    if (!s) return '';
    const t = String(s).trim();
    const m = t.match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})日?/);
    if (!m) return t;
    return m[1] + '-' + String(+m[2]).padStart(2, '0') + '-' + String(+m[3]).padStart(2, '0');
  }

  function normTime(s) {
    if (!s) return '';
    const m = String(s).trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return '';
    return String(+m[1]).padStart(2, '0') + ':' + String(+m[2]).padStart(2, '0') + (m[3] ? ':' + String(+m[3]).padStart(2, '0') : '');
  }

  /* 表头别名：精确匹配优先，个别包含匹配 */
  const HEADER_ALIASES = {
    date: ['日期', 'date'],
    time: ['时间', 'time'],
    mileage: ['里程', '总里程', '表显里程', '里程表', 'odometer', 'mileage'],
    energy: ['充电量', '充电度数', '充电电量', '用电量', '度数', 'energy', 'kwh'],
    cost: ['费用', '金额', '花费', 'cost', 'money'],
    price: ['电价', '单价', '油价', '价格', 'price'],
    socStart: ['充电前电量', '充电前剩余电量', '开始电量', '充电前', 'socstart'],
    socEnd: ['充电后电量', '充电后剩余电量', '结束电量', '充电后', 'socend'],
    full: ['充满', '是否充满', '是否加满', '加满', 'full'],
    type: ['充电方式', '充电类型', '燃油类型', '类型', 'type'],
    note: ['备注', '说明', 'note'],
    station: ['充电站', '加油站', '站点', 'station'],
    fuel: ['油耗', '电耗', '百公里电耗', 'fuel']
  };

  function matchHeader(h) {
    const n = norm(h);
    if (!n) return null;
    for (const key in HEADER_ALIASES) {
      const list = HEADER_ALIASES[key];
      for (let i = 0; i < list.length; i++) {
        if (n === norm(list[i])) return key;
      }
      /* 包含匹配只对中文长词启用，避免误伤 */
      for (let i = 0; i < list.length; i++) {
        const a = norm(list[i]);
        if (a.length >= 4 && n.includes(a)) return key;
      }
    }
    return null;
  }

  function detectKind(headers) {
    const keys = headers.map(matchHeader);
    const has = function (k) { return keys.indexOf(k) >= 0; };
    if (has('fuel') && has('mileage') && (has('full') || has('price'))) return 'xiaoxiong-fuel';
    if (has('date') && has('cost') && has('type') && !has('mileage') && !has('energy')) return 'xiaoxiong-expense';
    return 'generic';
  }

  /* 小熊油耗油耗记录 CSV：日期,时间,里程,油价,费用,油耗,是否加满,燃油类型,备注,是否上次忘记记录,是否油灯亮了,加油站 */
  function parseXiaoxiongFuel(rows) {
    const records = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 8) continue;
      const rec = {
        date: normDate(r[0]),
        time: normTime(r[1]),
        mileage: num(r[2]),
        price: num(r[3]),
        cost: num(r[4]),
        full: String(r[6]).trim() === '1',
        type: (r[7] || '').trim(),
        note: (r[8] || '').trim(),
        station: (r[11] || '').trim(),
        source: 'xiaoxiong'
      };
      /* 电价与费用都有时，反推充电量（度） */
      if (rec.cost != null && rec.price != null && rec.cost > 0 && rec.price > 0) {
        rec.energyKwh = round(rec.cost / rec.price, 3);
      }
      if (rec.date || rec.mileage != null) records.push(rec);
    }
    return records;
  }

  /* 小熊油耗费用记录 CSV：日期,时间,类型,费用,备注 */
  function parseXiaoxiongExpense(rows) {
    const records = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 4) continue;
      const rec = {
        date: normDate(r[0]),
        time: normTime(r[1]),
        type: (r[2] || '').trim(),
        cost: num(r[3]),
        note: (r[4] || '').trim(),
        kind: 'expense',
        source: 'xiaoxiong'
      };
      if (rec.date || rec.cost != null) records.push(rec);
    }
    return records;
  }

  /* 通用 CSV：按表头自动映射字段 */
  function parseGeneric(rows) {
    const headers = rows[0].map(function (h, idx) { return { key: matchHeader(h), raw: h, idx: idx }; });
    const known = headers.filter(function (h) { return h.key; });
    const records = [];
    const warnings = [];
    if (known.length < 2) {
      warnings.push('无法识别表头，请确认 CSV 第一行包含「日期」「里程」等字段');
      return { records: [], warnings: warnings };
    }
    const col = function (key) { const h = headers.find(function (x) { return x.key === key; }); return h ? h.idx : -1; };

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const get = function (key) {
        const idx = col(key);
        return idx >= 0 && idx < r.length ? r[idx] : undefined;
      };
      const date = normDate(get('date') || '');
      const time = normTime(get('time') || '');
      const mileage = num(get('mileage'));
      const energy = num(get('energy'));
      const cost = num(get('cost'));
      const price = num(get('price'));
      const socStart = num(get('socStart'));
      const socEnd = num(get('socEnd'));
      const fullRaw = get('full');
      const type = get('type');
      if (!date && mileage == null && energy == null && cost == null) continue;
      const rec = {
        date: date, time: time, mileage: mileage,
        socStart: socStart, socEnd: socEnd,
        energyKwh: energy, cost: cost, price: price,
        full: String(fullRaw === undefined ? '' : fullRaw).trim() === '1' || /^(1|是|满|true|yes)$/i.test(String(fullRaw || '')),
        type: type ? String(type).trim() : '',
        note: get('note') ? String(get('note')).trim() : '',
        station: get('station') ? String(get('station')).trim() : '',
        source: 'csv'
      };
      if (rec.cost != null && rec.price != null && rec.price > 0 && rec.energyKwh == null) {
        rec.energyKwh = round(rec.cost / rec.price, 3);
      }
      records.push(rec);
    }
    return { records: records, warnings: warnings };
  }

  function normalizeJsonRecord(r) {
    if (!r || typeof r !== 'object') return null;
    if (r.kind === 'expense') {
      return {
        id: r.id || null,
        date: normDate(r.date || ''),
        time: normTime(r.time || ''),
        type: r.type || '其他费用',
        cost: num(r.cost),
        note: r.note || '',
        kind: 'expense',
        source: 'json'
      };
    }
    return {
      id: r.id || null,
      date: normDate(r.date || ''),
      time: normTime(r.time || ''),
      mileage: num(r.mileage),
      socStart: num(r.socStart),
      socEnd: num(r.socEnd),
      energyKwh: num(r.energyKwh),
      cost: num(r.cost),
      price: num(r.price),
      full: !!r.full,
      type: r.type || '',
      note: r.note || '',
      station: r.station || '',
      source: r.source || 'json'
    };
  }

  function importText(text, opts) {
    opts = opts || {};
    const src = String(text || '').replace(/^\uFEFF/, '');
    const trimmed = src.trim();
    const warnings = [];

    /* JSON：本应用备份或记录数组 */
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      try {
        const data = JSON.parse(trimmed);
        if (Array.isArray(data)) {
          const records = data.map(normalizeJsonRecord).filter(Boolean);
          return { kind: 'json', records: records, expenses: [], warnings: [], counts: { records: records.filter(function (r) { return r.kind !== 'expense'; }).length, expenses: records.filter(function (r) { return r.kind === 'expense'; }).length } };
        }
        if (data && typeof data === 'object') {
          /* v2 多车辆备份 */
          if (Array.isArray(data.vehicles)) {
            const vehicles = data.vehicles.map(function (v) {
              return {
                id: v.id || null,
                name: (v.name || '').trim() || '我的车',
                settings: v.settings && typeof v.settings === 'object' ? v.settings : null,
                records: Array.isArray(v.records) ? v.records.map(normalizeJsonRecord).filter(Boolean) : []
              };
            });
            const totalRecords = vehicles.reduce(function (s, v) { return s + v.records.length; }, 0);
            return {
              kind: 'json',
              records: [],
              expenses: [],
              vehicles: vehicles,
              settings: null,
              savedAt: data.savedAt || '',
              warnings: [],
              counts: { records: totalRecords, expenses: 0 }
            };
          }
          const recs = Array.isArray(data.records) ? data.records.map(normalizeJsonRecord).filter(Boolean) : [];
          const settings = data.settings && typeof data.settings === 'object' ? data.settings : null;
          return {
            kind: 'json',
            records: recs,
            expenses: [],
            settings: settings,
            savedAt: data.savedAt || '',
            warnings: [],
            counts: { records: recs.filter(function (r) { return r.kind !== 'expense'; }).length, expenses: recs.filter(function (r) { return r.kind === 'expense'; }).length }
          };
        }
        throw new Error('JSON 内容不是有效的备份');
      } catch (e) {
        return { kind: 'json', records: [], expenses: [], warnings: ['JSON 解析失败：' + (e && e.message ? e.message : e)] };
      }
    }

    /* CSV */
    const rows = parseCSV(trimmed);
    if (rows.length === 0) return { kind: 'csv', records: [], expenses: [], warnings: ['文件是空的'] };
    const kind = detectKind(rows[0]);
    if (kind === 'xiaoxiong-fuel') {
      const records = parseXiaoxiongFuel(rows);
      return { kind: 'xiaoxiong-fuel', records: records, expenses: [], warnings: warnings, counts: { records: records.length, expenses: 0 } };
    }
    if (kind === 'xiaoxiong-expense') {
      const expenses = parseXiaoxiongExpense(rows);
      return { kind: 'xiaoxiong-expense', records: [], expenses: expenses, warnings: warnings, counts: { records: 0, expenses: expenses.length } };
    }
    const g = parseGeneric(rows);
    return { kind: 'generic', records: g.records, expenses: [], warnings: warnings.concat(g.warnings), counts: { records: g.records.length, expenses: 0 } };
  }

  /* 导出：本应用 CSV（12 列，与记录一一对应） */
  function toOwnCSV(records) {
    const header = ['日期', '时间', '里程', '充电量', '费用', '电价', '充电前电量', '充电后电量', '充满', '充电方式', '备注', '站点'];
    const lines = [header.join(',')];
    records.forEach(function (r) {
      const esc = function (v) {
        const s = String(v === null || v === undefined ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      if (r.kind === 'expense') return;
      lines.push([
        esc(r.date || ''), esc(r.time || ''), esc(r.mileage == null ? '' : r.mileage),
        esc(r.energyKwh == null ? '' : r.energyKwh), esc(r.cost == null ? '' : r.cost),
        esc(r.price == null ? '' : r.price), esc(r.socStart == null ? '' : r.socStart),
        esc(r.socEnd == null ? '' : r.socEnd), r.full ? '1' : '0',
        esc(r.type || ''), esc(r.note || ''), esc(r.station || '')
      ].join(','));
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  /* 导出：本应用 JSON 备份（v2 多车辆） */
  function toOwnJSON(vehicles, activeVehicleId) {
    const list = Array.isArray(vehicles) ? vehicles : [];
    return JSON.stringify({
      app: 'energy-tracker',
      version: 2,
      savedAt: new Date().toISOString(),
      activeVehicleId: activeVehicleId || (list.length ? list[0].id : ''),
      vehicles: list.map(function (v) {
        return {
          id: v.id,
          name: v.name,
          settings: v.settings,
          records: v.records
        };
      })
    }, null, 2);
  }

  const TrackerImporter = {
    parseCSV: parseCSV,
    importText: importText,
    toOwnCSV: toOwnCSV,
    toOwnJSON: toOwnJSON,
    matchHeader: matchHeader,
    detectKind: detectKind
  };

  global.TrackerImporter = TrackerImporter;
  if (typeof module !== 'undefined' && module.exports) module.exports = TrackerImporter;
})(typeof window !== 'undefined' ? window : globalThis);
