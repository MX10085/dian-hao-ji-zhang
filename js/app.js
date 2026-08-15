/* 界面交互与本地存储：多车辆 + 每日自动备份 */
(function () {
  'use strict';
  const $ = Util.$, $$ = Util.$$;
  const STORE_KEY = 'energy-tracker.v1';
  const BACKUP_KEY = 'energy-tracker.backups.v1';
  const APP_VERSION = 'v1.0';

  const DEFAULT_SETTINGS = {
    vehicleName: '极核 AE6+',
    companionDate: '',
    batteryCapacityWh: 1863,
    chargerEfficiency: 0.88,
    defaultPrice: 0.6,
    unit: 'kWh/100km'
  };
  const DEFAULTS = {
    vehicles: [{ id: 'v1', name: '极核 AE6+', settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), records: [] }],
    activeVehicleId: 'v1',
    autoDownload: false
  };

  const SAMPLE = [
    { date: '2026-07-20', time: '20:13', mileage: 1240, socStart: 5, socEnd: 100, energyKwh: 1.82, price: 0.6, cost: 1.09, full: true, type: '家充', note: '首次完整记录' },
    { date: '2026-07-23', time: '21:02', mileage: 1295, socStart: 12, socEnd: 100, energyKwh: 1.71, price: 0.6, cost: 1.03, full: true, type: '家充', note: '' },
    { date: '2026-07-27', time: '20:40', mileage: 1350, socStart: 15, socEnd: 100, energyKwh: 1.68, price: 0.6, cost: 1.01, full: true, type: '家充', note: '高温天' },
    { date: '2026-08-01', time: '19:55', mileage: 1408, socStart: 10, socEnd: 100, energyKwh: 1.75, price: 0.6, cost: 1.05, full: true, type: '家充', note: '' },
    { date: '2026-08-05', time: '22:30', mileage: 1460, socStart: 45, socEnd: 80, energyKwh: 0.74, price: 0.9, cost: 0.67, full: false, type: '小区充电桩', note: '补电至80%' },
    { date: '2026-08-09', time: '21:18', mileage: 1510, socStart: 8, socEnd: 100, energyKwh: 1.79, price: 0.6, cost: 1.07, full: true, type: '家充', note: '' }
  ];

  const SAMPLE_EXPENSES = [
    { date: '2026-07-28', time: '20:59', type: '保养', cost: 50, note: '链条润滑' },
    { date: '2026-08-06', time: '18:30', type: '保险', cost: 120, note: '交强险' }
  ];

  let state = load();
  let pendingImport = null;
  let toastTimer = null;
  let recordsExpanded = false;
  const COLLAPSE_LIMIT = 3;
  const zoomState = {};

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      const data = JSON.parse(raw);
      if (Array.isArray(data.vehicles) && data.vehicles.length) {
        return {
          vehicles: data.vehicles.map(function (v) {
            const settings = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), v.settings || {});
            if (settings.unit === 'Wh/km') settings.unit = 'kWh/100km';
            return {
              id: v.id || Util.uid(),
              name: (v.name || '').trim() || settings.vehicleName || '我的车',
              settings: settings,
              records: Array.isArray(v.records) ? v.records : []
            };
          }),
          activeVehicleId: data.activeVehicleId || data.vehicles[0].id,
          autoDownload: !!data.autoDownload
        };
      }
      /* 旧版单车辆数据迁移 */
      const settings = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), data.settings || {});
      if (settings.unit === 'Wh/km') settings.unit = 'kWh/100km';
      return {
        vehicles: [{ id: 'v1', name: settings.vehicleName || '我的车', settings: settings, records: Array.isArray(data.records) ? data.records : [] }],
        activeVehicleId: 'v1',
        autoDownload: false
      };
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function currentVehicle() {
    return state.vehicles.find(function (v) { return v.id === state.activeVehicleId; }) || state.vehicles[0];
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  }

  function unitLabel() {
    return currentVehicle().settings.unit === 'kWh/100km' ? '度/百公里' : 'Wh/km';
  }

  function dispEfficiency(whPerKm) {
    if (whPerKm == null) return null;
    return currentVehicle().settings.unit === 'kWh/100km' ? whPerKm / 10 : whPerKm;
  }

  function round2(v) {
    if (v === null || v === undefined || isNaN(v)) return null;
    return Math.round(v * 100) / 100;
  }

  function companionDays() {
    const s = currentVehicle().settings.companionDate;
    if (!s) return null;
    const d = Util.parseDate(s);
    if (!d) return null;
    const today = new Date();
    const diff = Util.daysBetween(d, today);
    return diff != null && diff >= 0 ? diff + 1 : null;
  }

  /* ---------- 每日自动备份 ---------- */
  function loadBackups() {
    try { return JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveBackups(list) {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(list));
  }
  function createBackup(download) {
    const list = loadBackups();
    list.unshift({ date: Util.todayStr(), savedAt: new Date().toISOString(), data: JSON.parse(JSON.stringify(state)) });
    if (list.length > 15) list.length = 15;
    saveBackups(list);
    renderBackupList();
    if (download) {
      Util.download('energy-backup-' + Util.todayStr() + '.json', JSON.stringify(list[0].data, null, 2), 'application/json');
      toast('已自动下载今日备份');
    }
    /* 同步备份到 NAS（Node-RED /api/backup） */
    const syncRaw = $('#sync-url') ? ($('#sync-url').value || '').trim() : '';
    if (syncRaw) {
      try {
        const u = new URL(syncRaw);
        u.pathname = '/api/backup';
        pushBackupToNodeRed(u.toString()).then(function (ok) {
          localStorage.setItem('energy-tracker.nasbackup', JSON.stringify({ time: new Date().toISOString(), ok: ok }));
          renderNasBackupStatus();
        });
      } catch (e) {}
    }
  }
  function ensureDailyBackup(force) {
    if (force) { createBackup(state.autoDownload); toast('已备份'); return; }
    const list = loadBackups();
    if (list.length && list[0].date === Util.todayStr()) return;
    createBackup(state.autoDownload);
  }
  function renderBackupList() {
    const el = $('#backup-list');
    const list = loadBackups();
    if (!list.length) { el.innerHTML = '<p class="muted">还没有备份记录</p>'; return; }
    el.innerHTML = list.slice(0, 10).map(function (b, i) {
      return '<div class="rec-row backup-row" data-idx="' + i + '">' +
        '<div class="rec-main">' +
        '<div class="rec-top"><span class="rec-date">' + Util.esc(b.date) + '</span></div>' +
        '<div class="rec-sub">' + Util.esc(String(b.savedAt || '').replace('T', ' ').slice(0, 16)) + '</div></div>' +
        '<div class="rec-actions">' +
        '<button type="button" class="edit" data-act="restore" title="恢复">↩</button>' +
        '<button type="button" class="edit" data-act="export" title="导出">↓</button>' +
        '<button type="button" class="del" data-act="del" title="删除">🗑</button></div></div>';
    }).join('');
  }
  function restoreBackup(idx) {
    const list = loadBackups();
    const b = list[idx];
    if (!b) return;
    if (!confirm('恢复 ' + b.date + ' 的备份？当前数据会被覆盖。')) return;
    state = JSON.parse(JSON.stringify(b.data));
    if (!Array.isArray(state.vehicles) || !state.vehicles.length) {
      const settings = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), state.settings || {});
      state = {
        vehicles: [{ id: 'v1', name: settings.vehicleName || '我的车', settings: settings, records: state.records || [] }],
        activeVehicleId: 'v1',
        autoDownload: false
      };
    }
    if (typeof state.autoDownload !== 'boolean') state.autoDownload = false;
    save();
    renderAll();
    toast('已恢复 ' + b.date + ' 的备份');
  }
  function deleteBackup(idx) {
    const list = loadBackups();
    list.splice(idx, 1);
    saveBackups(list);
    renderBackupList();
    toast('已删除备份');
  }
  function exportBackup(idx) {
    const list = loadBackups();
    const b = list[idx];
    if (!b) return;
    Util.download('energy-backup-' + b.date + '.json', JSON.stringify(b.data, null, 2), 'application/json');
    toast('已导出 ' + b.date + ' 的备份');
  }

  /* ---------- 记录页（概览 + 充电记录） ---------- */
  function renderDashboard() {
    const v = currentVehicle();
    const s = TrackerCalc.summary(v.records, v.settings);
    const fmtEff = function (val) {
      const d = dispEfficiency(val);
      return d == null ? '—' : Util.fmt(d, 1);
    };
    const days = companionDays();
    $('#stats').innerHTML =
      statCard('爱车相伴', days != null ? days : '—', '天', days != null) +
      statCard('总里程(表显)', Util.fmt(s.lastMileage, 1), 'km', true) +
      statCard('累计充电', Util.fmt(s.totalWallKwh, 2), 'kWh', true) +
      statCard('平均电耗(车端)', fmtEff(s.avgWhPerKm), unitLabel(), true) +
      statCard('平均电耗(墙端)', fmtEff(s.avgWallWhPerKm), unitLabel()) +
      statCard('每公里成本', Util.fmt(s.avgCostPerKm, 3), '元');

    renderBatteryHealth(TrackerCalc.batteryHealth(v.records, v.settings));

    const segs = TrackerCalc.computeSegments(v.records, v.settings);
    const rawLinePts = segs
      .filter(function (x) { return x.whPerKm != null && x.distanceKm != null; })
      .map(function (x) { return { x: (x.record.date || '') + ' ' + (x.record.time || ''), y: x.whPerKm }; });
    const lineMean = rawLinePts.length ? rawLinePts.reduce(function (acc, p) { return acc + p.y; }, 0) / rawLinePts.length : null;
    attachZoomSafe('#chart-wh', rawLinePts, function (slice, body) {
      TrackerCharts.lineChart(body, slice, {
        fmt: function (val) { return Util.fmt(dispEfficiency(val), 1); },
        mean: lineMean
      });
    }, 2, 183);

    renderChargeList();
  }

  function statCard(k, v, unit, hot, rawHtml) {
    return '<div class="stat' + (hot ? ' hot' : '') + '"><div class="k">' + Util.esc(k) + '</div>' +
      '<div class="v">' + (v == null ? '—' : (rawHtml ? v : Util.esc(v))) + (unit ? '<small>' + Util.esc(unit) + '</small>' : '') + '</div></div>';
  }

  function renderChargeList() {
    const list = $('#record-list');
    const v = currentVehicle();
    const charges = v.records.filter(function (r) { return r.kind !== 'expense'; });
    const sorted = TrackerCalc.sortRecords(charges).reverse(); /* 新的在前 */
    const segs = TrackerCalc.computeSegments(charges, v.settings);
    const byId = {};
    segs.forEach(function (s) { byId[s.record.id] = s; });

    $('#record-empty').style.display = charges.length ? 'none' : 'block';
    const shown = recordsExpanded ? sorted : sorted.slice(0, COLLAPSE_LIMIT);
    list.innerHTML = shown.map(function (rec) { return chargeRowHtml(rec, byId[rec.id]); }).join('');
    const btn = $('#btn-toggle-records');
    if (charges.length > COLLAPSE_LIMIT) {
      btn.classList.remove('hidden');
      btn.textContent = recordsExpanded ? '收起' : '展开全部（' + charges.length + '）';
    } else {
      btn.classList.add('hidden');
    }
  }

  function chargeRowHtml(rec, seg) {
    const eff = seg && seg.whPerKm != null ? Util.fmt(dispEfficiency(seg.whPerKm), 1) + ' ' + unitLabel() : '';
    const sub = [];
    if (rec.mileage != null) sub.push('里程 ' + Util.fmt(rec.mileage, 1) + ' km');
    if (rec.full) sub.push('充满');
    if (rec.socEnd != null) sub.push('充至 ' + rec.socEnd + '%');
    if (rec.note) sub.push(rec.note);
    return '<div class="rec-row" data-id="' + Util.esc(rec.id) + '">' +
      '<div class="rec-main">' +
      '<div class="rec-top"><span class="rec-date">' + Util.esc(rec.date) + (rec.time ? ' ' + Util.esc(rec.time) : '') + '</span>' +
      '<span class="badge">' + Util.esc(rec.type || '充电') + '</span></div>' +
      '<div class="rec-sub">' + Util.esc(sub.join(' · ')) + '</div></div>' +
      '<div class="rec-nums">' +
      '<div class="num">' + Util.fmt(rec.energyKwh, 2) + ' <small>kWh</small></div>' +
      '<div class="num dim">' + Util.fmt(rec.cost, 2) + ' 元</div>' +
      '<div class="num dim">' + Util.esc(eff || '') + '</div></div>' +
      recActions() + '</div>';
  }

  function recActions() {
    return '<div class="rec-actions">' +
      '<button type="button" class="edit" data-act="edit" title="编辑">✎</button>' +
      '<button type="button" class="del" data-act="del" title="删除">🗑</button></div>';
  }

  /* ---------- 费用页 ---------- */
  function renderExpenses() {
    const v = currentVehicle();
    const exps = v.records.filter(function (r) { return r.kind === 'expense'; });
    const sorted = TrackerCalc.sortRecords(exps);
    $('#expense-count').textContent = '共 ' + exps.length + ' 条';
    $('#expense-empty').style.display = exps.length ? 'none' : 'block';
    $('#expense-list').innerHTML = sorted.map(expenseRowHtml).join('');
    renderExpenseStats();
  }

  function expenseRowHtml(rec) {
    return '<div class="rec-row" data-id="' + Util.esc(rec.id) + '">' +
      '<div class="rec-main">' +
      '<div class="rec-top"><span class="rec-date">' + Util.esc(rec.date) + (rec.time ? ' ' + Util.esc(rec.time) : '') + '</span>' +
      '<span class="badge exp">' + Util.esc(rec.type || '费用') + '</span></div>' +
      '<div class="rec-sub">' + Util.esc(rec.note || '') + '</div></div>' +
      '<div class="rec-nums"><div class="num">' + Util.fmt(rec.cost, 2) + ' <small>元</small></div></div>' +
      recActions() + '</div>';
  }

  function renderExpenseStats() {
    const es = TrackerCalc.expenseStats(currentVehicle().records);
    const cmap = TrackerCharts.colorMap(['充电费'].concat(es.categories.map(function (c) { return c.type; })));
    let rows = '<table><thead><tr><th>项目</th><th class="num">笔数</th><th class="num">金额（元）</th></tr></thead><tbody>';
    rows += '<tr><td><span class="cat-dot" style="background:' + cmap['充电费'] + '"></span>充电费</td><td class="num">' + es.chargeCount + '</td><td class="num">' + Util.fmt(es.chargeTotal, 2) + '</td></tr>';
    es.categories.forEach(function (c) {
      rows += '<tr><td><span class="cat-dot" style="background:' + cmap[c.type] + '"></span>' + Util.esc(c.type) + '</td><td class="num">' + c.count + '</td><td class="num">' + Util.fmt(c.total, 2) + '</td></tr>';
    });
    rows += '<tr class="total"><td>合计</td><td class="num"></td><td class="num">' + Util.fmt(es.totalSpend, 2) + '</td></tr>';
    rows += '</tbody></table>';
    $('#expense-cat-table').innerHTML = rows;

    const monthItems = es.monthTotals.map(function (m) {
      return { label: String(parseInt(m.month.slice(5), 10)) + '月', value: m.total };
    });
    const monthMean = monthItems.length ? monthItems.reduce(function (acc, m) { return acc + m.value; }, 0) / monthItems.length : null;
    attachZoomSafe('#chart-monthly', monthItems, function (slice, body) {
      TrackerCharts.barChart(body, slice, {
        fmt: function (val) { return Util.fmt(val, 2); },
        mean: monthMean
      });
    }, 2, 183);

    TrackerCharts.donutChart($('#chart-breakdown'), es.breakdown, { fmt: function (val) { return Util.fmt(val, 2); } });
  }

  /* ---------- 电池健康 ---------- */
  function renderBatteryHealth(bh) {
    const el = $('#battery-health');
    if (!bh.hasData) {
      el.innerHTML = '<p class="muted">暂无足够数据：需要有「充电前后电量 %」和有效充电量的记录才能估算（电量差小于 20% 的充电会被跳过）。</p>';
      TrackerCharts.lineChart($('#chart-health'), [], {});
      return;
    }
    el.innerHTML =
      statCard('当前估算容量', Util.fmt(bh.latestWh, 0) + ' / <span class="nominal">' + Util.fmt(bh.nominalWh, 0) + '</span>', 'Wh', true, true) +
      statCard('健康度 SOH', Util.fmt(bh.soh, 1), '%', bh.soh < 80) +
      statCard('年均衰减', bh.lossPerYearWh != null ? (bh.lossPerYearWh > 0 ? '+' : '') + Util.fmt(bh.lossPerYearWh, 1) : '—', 'Wh/年');
    const estPts = bh.estimates.map(function (e) { return { x: e.date, y: e.estWh }; });
    const estMean = estPts.length ? estPts.reduce(function (acc, p) { return acc + p.y; }, 0) / estPts.length : null;
    attachZoomSafe('#chart-health', estPts, function (slice, body) {
      TrackerCharts.lineChart(body, slice, {
        fmt: function (val) { return Util.fmt(val, 0); },
        mean: estMean,
        colorMode: 'low-bad',
        warnText: '低于平时',
        goodText: '高于平时'
      });
    }, 2, 183);
  }

  /* ---------- 记一笔（充电） ---------- */
  function openRecordForm(rec) {
    const v = currentVehicle();
    $('#dialog-title').textContent = rec ? '编辑记录' : '记一笔';
    $('#f-id').value = rec ? rec.id : '';
    $('#f-date').value = rec ? (rec.date || Util.todayStr()) : Util.todayStr();
    $('#f-time').value = rec ? (rec.time || '') : Util.nowTimeStr();
    $('#f-mileage').value = rec && rec.mileage != null ? rec.mileage : '';
    $('#f-socStart').value = rec && rec.socStart != null ? rec.socStart : '';
    $('#f-socEnd').value = rec && rec.socEnd != null ? rec.socEnd : '';
    $('#f-energy').value = rec && rec.energyKwh != null ? rec.energyKwh : '';
    $('#f-price').value = rec && rec.price != null ? rec.price : (rec ? '' : v.settings.defaultPrice);
    $('#f-cost').value = rec && rec.cost != null ? rec.cost : '';
    $('#f-full').checked = rec ? !!rec.full : true;
    const sel = $('#f-type');
    if (rec && rec.type) {
      if (!Array.prototype.some.call(sel.options, function (o) { return o.value === rec.type; })) {
        const opt = document.createElement('option');
        opt.value = rec.type;
        opt.textContent = rec.type;
        sel.appendChild(opt);
      }
      sel.value = rec.type;
    } else {
      sel.value = '家充';
    }
    $('#f-note').value = rec ? (rec.note || '') : '';
    $('#btn-del').classList.toggle('hidden', !rec);
    document.getElementById('record-dialog').showModal();
  }

  function autoFill(trigger) {
    const s = currentVehicle().settings;
    let energy = Util.toNum($('#f-energy').value);
    let price = Util.toNum($('#f-price').value);
    let cost = Util.toNum($('#f-cost').value);
    if (trigger !== 'energy' && energy == null && cost != null && price != null && price > 0) {
      energy = cost / price;
      $('#f-energy').value = round2(energy);
    }
    if (trigger !== 'price' && price == null && cost != null && energy != null && energy > 0) {
      $('#f-price').value = round2(cost / energy);
    }
    if (trigger !== 'cost' && cost == null && energy != null && price != null) {
      $('#f-cost').value = round2(energy * price);
    }
    if (Util.toNum($('#f-energy').value) == null) {
      const s0 = Util.toNum($('#f-socStart').value);
      const e0 = Util.toNum($('#f-socEnd').value);
      if (s0 != null && e0 != null && e0 > s0) {
        const est = s.batteryCapacityWh / 1000 * (e0 - s0) / 100 / s.chargerEfficiency;
        $('#f-energy').value = round2(est);
        if (Util.toNum($('#f-price').value) == null) $('#f-price').value = s.defaultPrice;
      }
    }
  }

  function collectRecord() {
    const s = currentVehicle().settings;
    const energy = Util.toNum($('#f-energy').value);
    const price = Util.toNum($('#f-price').value);
    const cost = Util.toNum($('#f-cost').value);
    const rec = {
      id: $('#f-id').value || Util.uid(),
      date: $('#f-date').value || Util.todayStr(),
      time: $('#f-time').value || '',
      mileage: Util.toNum($('#f-mileage').value),
      socStart: Util.toNum($('#f-socStart').value),
      socEnd: Util.toNum($('#f-socEnd').value),
      energyKwh: energy,
      price: price,
      cost: cost,
      full: $('#f-full').checked,
      type: $('#f-type').value,
      note: $('#f-note').value.trim()
    };
    if (rec.energyKwh == null && rec.cost != null && rec.price != null && rec.price > 0) {
      rec.energyKwh = round2(rec.cost / rec.price);
    }
    if (rec.cost == null && rec.energyKwh != null && rec.price != null) {
      rec.cost = round2(rec.energyKwh * rec.price);
    }
    if (rec.price == null && rec.energyKwh != null && rec.energyKwh > 0 && rec.cost != null) {
      rec.price = round2(rec.cost / rec.energyKwh);
    }
    if (rec.energyKwh == null && rec.socStart != null && rec.socEnd != null && rec.socEnd > rec.socStart) {
      rec.energyKwh = round2(s.batteryCapacityWh / 1000 * (rec.socEnd - rec.socStart) / 100 / s.chargerEfficiency);
      if (rec.price == null) rec.price = s.defaultPrice;
      if (rec.cost == null) rec.cost = round2(rec.energyKwh * rec.price);
    }
    if (rec.price == null) rec.price = s.defaultPrice;
    return rec;
  }

  function saveRecord(ev) {
    ev.preventDefault();
    const rec = collectRecord();
    if (rec.mileage == null || rec.mileage < 0) { toast('请填写总里程'); return; }
    const v = currentVehicle();
    const idx = v.records.findIndex(function (r) { return r.id === rec.id; });
    if (idx >= 0) v.records[idx] = rec; else v.records.push(rec);
    save();
    renderAll();
    document.getElementById('record-dialog').close();
    toast(idx >= 0 ? '已保存' : '已记一笔');
  }

  /* ---------- 记费用 ---------- */
  function openExpenseForm(rec, presetType) {
    $('#expense-dialog-title').textContent = rec ? '编辑费用' : '记费用';
    $('#e-id').value = rec ? rec.id : '';
    $('#e-date').value = rec ? (rec.date || Util.todayStr()) : Util.todayStr();
    $('#e-time').value = rec ? (rec.time || '') : Util.nowTimeStr();
    $('#e-type').value = rec ? (rec.type || '其他') : (presetType || '保养');
    $('#e-cost').value = rec && rec.cost != null ? rec.cost : '';
    $('#e-note').value = rec ? (rec.note || '') : '';
    $('#btn-del-expense').classList.toggle('hidden', !rec);
    document.getElementById('expense-dialog').showModal();
  }

  function saveExpense(ev) {
    ev.preventDefault();
    const cost = Util.toNum($('#e-cost').value);
    if (cost == null || cost < 0) { toast('请填写金额'); return; }
    const rec = {
      id: $('#e-id').value || Util.uid(),
      date: $('#e-date').value || Util.todayStr(),
      time: $('#e-time').value || '',
      type: $('#e-type').value.trim() || '其他',
      cost: cost,
      note: $('#e-note').value.trim(),
      kind: 'expense'
    };
    const v = currentVehicle();
    const idx = v.records.findIndex(function (r) { return r.id === rec.id; });
    if (idx >= 0) v.records[idx] = rec; else v.records.push(rec);
    save();
    renderAll();
    document.getElementById('expense-dialog').close();
    toast(idx >= 0 ? '已保存' : '已记费用');
  }

  function deleteRecord(id) {
    if (!confirm('删除这条记录？')) return;
    const v = currentVehicle();
    v.records = v.records.filter(function (r) { return r.id !== id; });
    save();
    renderAll();
    toast('已删除');
  }

  /* ---------- 导入 ---------- */
  async function handleFiles(files) {
    const results = [];
    for (const f of Array.from(files || [])) {
      try {
        const text = await Util.readFileAsText(f);
        results.push(TrackerImporter.importText(text, { sourceName: f.name }));
      } catch (e) {
        results.push({ error: String(e && e.message ? e.message : e) });
      }
    }
    pendingImport = { records: [], expenses: [], vehicles: [], warnings: [], settings: null, savedAt: '' };
    results.forEach(function (r) {
      if (r.error) { pendingImport.warnings.push(r.error); return; }
      (r.records || []).forEach(function (x) { pendingImport.records.push(x); });
      (r.expenses || []).forEach(function (x) { pendingImport.expenses.push(x); });
      (r.vehicles || []).forEach(function (x) { pendingImport.vehicles.push(x); });
      (r.warnings || []).forEach(function (w) { pendingImport.warnings.push(w); });
      if (r.settings) pendingImport.settings = r.settings;
      if (r.savedAt) pendingImport.savedAt = r.savedAt;
    });
    renderImportResult();
    document.getElementById('import-dialog').showModal();
  }

  function renderImportResult() {
    const el = $('#import-result');
    const p = pendingImport;
    const lines = [];
    if (p.vehicles.length) {
      const total = p.vehicles.reduce(function (s, v) { return s + v.records.length; }, 0);
      lines.push('<p>解析成功：包含 ' + p.vehicles.length + ' 辆车、' + total + ' 条记录。</p>');
    } else if (p.records.length || p.expenses.length) {
      lines.push('<p>解析成功：' + p.records.length + ' 条充电/能耗记录' + (p.expenses.length ? '，' + p.expenses.length + ' 条费用记录' : '') + '</p>');
      if (p.settings) lines.push('<p>备份内包含车辆设置，将一并恢复。</p>');
    } else {
      lines.push('<p>没有解析出任何记录。</p>');
    }
    if (p.warnings.length) {
      lines.push('<p class="warn">注意：</p><ul>' + p.warnings.map(function (w) { return '<li>' + Util.esc(w) + '</li>'; }).join('') + '</ul>');
    }
    el.innerHTML = lines.join('');
    $('#btn-import-confirm').classList.toggle('hidden', !(p.records.length || p.expenses.length || p.vehicles.length));
  }

  function confirmImport() {
    if (!pendingImport) return;
    const p = pendingImport;
    if (p.vehicles && p.vehicles.length) {
      let added = 0, skipped = 0;
      p.vehicles.forEach(function (nv) {
        const vid = nv.id || Util.uid();
        const recs = (nv.records || []).map(function (r) { if (!r.id) r.id = Util.uid(); return r; });
        const ex = state.vehicles.find(function (v) { return v.id === vid && nv.id; });
        if (ex) {
          const before = ex.records.length;
          const fresh = recs.filter(function (r) { return !ex.records.some(function (x) { return x.id === r.id; }); });
          ex.records = ex.records.concat(fresh);
          if (nv.settings) ex.settings = Object.assign({}, ex.settings, nv.settings);
          skipped += recs.length - fresh.length;
          added += fresh.length;
        } else {
          state.vehicles.push({
            id: vid,
            name: nv.name || '导入的车',
            settings: Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), nv.settings || {}),
            records: recs
          });
          added += recs.length;
          if (!state.activeVehicleId) state.activeVehicleId = vid;
        }
      });
      save();
      renderAll();
      pendingImport = null;
      document.getElementById('import-dialog').close();
      toast('导入完成：' + added + ' 条记录' + (skipped ? '，跳过 ' + skipped + ' 条重复' : ''));
      return;
    }
    let skipped = 0;
    const dedupe = function (list) {
      const v = currentVehicle();
      return list.filter(function (r) {
        if (r.id && v.records.some(function (x) { return x.id === r.id; })) {
          skipped++;
          return false;
        }
        if (!r.id) r.id = Util.uid();
        return true;
      });
    };
    const v = currentVehicle();
    v.records = v.records.concat(dedupe(p.records), dedupe(p.expenses));
    if (p.settings) v.settings = Object.assign({}, v.settings, p.settings);
    save();
    renderAll();
    pendingImport = null;
    document.getElementById('import-dialog').close();
    toast(skipped ? '导入完成，跳过 ' + skipped + ' 条重复记录' : '导入完成');
  }

  /* ---------- 设置 ---------- */
  function renderSettings() {
    const f = $('#settings-form');
    const s = currentVehicle().settings;
    f.vehicleName.value = s.vehicleName;
    f.companionDate.value = s.companionDate || '';
    f.batteryCapacityWh.value = s.batteryCapacityWh;
    f.chargerEfficiency.value = s.chargerEfficiency;
    f.defaultPrice.value = s.defaultPrice;
    f.unit.value = s.unit;
    const dl = $('#auto-download');
    if (dl) dl.checked = !!state.autoDownload;
    const ver = $('#app-version');
    if (ver) ver.textContent = APP_VERSION;
    renderVehiclePanel();
  }

  function saveSettings(ev) {
    ev.preventDefault();
    const f = $('#settings-form');
    const s = currentVehicle().settings;
    s.vehicleName = f.vehicleName.value.trim() || '我的车';
    s.companionDate = f.companionDate.value || '';
    s.batteryCapacityWh = Util.toNum(f.batteryCapacityWh.value) || 1863;
    s.chargerEfficiency = Util.toNum(f.chargerEfficiency.value) || 0.88;
    s.defaultPrice = Util.toNum(f.defaultPrice.value) || 0;
    s.unit = f.unit.value;
    save();
    renderAll();
    toast('设置已保存');
  }

  function renderVehiclePanel() {
    const sel = $('#vehicle-select');
    if (!sel) return;
    sel.innerHTML = state.vehicles.map(function (v) {
      return '<option value="' + Util.esc(v.id) + '"' + (v.id === state.activeVehicleId ? ' selected' : '') + '>' + Util.esc(v.name) + '</option>';
    }).join('');
    const delBtn = $('#btn-vehicle-del');
    if (delBtn) delBtn.disabled = state.vehicles.length <= 1;
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderVehicle();
    renderDashboard();
    renderExpenses();
    renderSettings();
    renderBackupList();
    renderSyncPanel();
    renderNasBackupStatus();
  }

  function renderVehicle() {
    $('#vehicle-title').textContent = '电耗记账';
    $('#vehicle-sub').textContent = currentVehicle().settings.vehicleName + ' · 本地离线';
    document.title = '电耗记账 · ' + currentVehicle().settings.vehicleName;
  }

  /* ---------- 缩放辅助 ---------- */
  function attachZoomSafe(id, data, renderFn, minPoints, defaultWindowDays) {
    try {
      TrackerCharts.attachZoom($(id), data, function (slice, body) {
        renderFn(slice, body);
      }, {
        minPoints: minPoints || 2,
        win: zoomState[id],
        defaultWindowDays: defaultWindowDays,
        onWin: function (w) { zoomState[id] = { start: w.start, end: w.end }; }
      });
    } catch (err) {
      renderFn(data, $(id));
    }
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    /* 本应用自带图表缩放，禁用浏览器页面级缩放 */
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('gesturechange', function (e) { e.preventDefault(); });

    /* 标签页 */
    $('#tabbar').addEventListener('click', function (ev) {
      const btn = ev.target.closest('button[data-tab]');
      if (!btn) return;
      $$('#tabbar button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      $$('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + btn.dataset.tab); });
    });

    /* 记一笔（充电） */
    $('#btn-add-quick').addEventListener('click', function () { openRecordForm(null); });
    $('#btn-toggle-records').addEventListener('click', function () {
      recordsExpanded = !recordsExpanded;
      renderChargeList();
    });
    $('#record-form').addEventListener('submit', saveRecord);
    $('#btn-del').addEventListener('click', function () {
      const id = $('#f-id').value;
      document.getElementById('record-dialog').close();
      deleteRecord(id);
    });
    $$('#record-dialog [data-close]').forEach(function (b) {
      b.addEventListener('click', function () { document.getElementById('record-dialog').close(); });
    });
    ['f-energy', 'f-price', 'f-cost'].forEach(function (id) {
      $('#' + id).addEventListener('input', function () { autoFill(id.slice(2)); });
    });
    ['f-socStart', 'f-socEnd'].forEach(function (id) {
      $('#' + id).addEventListener('change', function () { autoFill('soc'); });
    });
    $('#record-list').addEventListener('click', function (ev) {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const row = ev.target.closest('.rec-row');
      const id = row && row.dataset.id;
      if (!id) return;
      if (btn.dataset.act === 'edit') {
        const rec = currentVehicle().records.find(function (r) { return r.id === id; });
        if (rec) openRecordForm(rec);
      } else if (btn.dataset.act === 'del') {
        deleteRecord(id);
      }
    });

    /* 记费用 */
    $('#btn-add-expense').addEventListener('click', function () { openExpenseForm(null); });
    $('#expense-quick').addEventListener('click', function (ev) {
      const b = ev.target.closest('button[data-type]');
      if (!b) return;
      openExpenseForm(null, b.dataset.type);
    });
    $('#expense-form').addEventListener('submit', saveExpense);
    $('#btn-del-expense').addEventListener('click', function () {
      const id = $('#e-id').value;
      document.getElementById('expense-dialog').close();
      deleteRecord(id);
    });
    $$('#expense-dialog [data-close]').forEach(function (b) {
      b.addEventListener('click', function () { document.getElementById('expense-dialog').close(); });
    });
    $('#expense-list').addEventListener('click', function (ev) {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const row = ev.target.closest('.rec-row');
      const id = row && row.dataset.id;
      if (!id) return;
      if (btn.dataset.act === 'edit') {
        const rec = currentVehicle().records.find(function (r) { return r.id === id; });
        if (rec) openExpenseForm(rec);
      } else if (btn.dataset.act === 'del') {
        deleteRecord(id);
      }
    });

    /* 导入 */
    $('#btn-import').addEventListener('click', function () { $('#file-input').click(); });
    $('#btn-pick').addEventListener('click', function () { $('#file-input').click(); });
    $('#file-input').addEventListener('change', function (ev) {
      handleFiles(ev.target.files);
      ev.target.value = '';
    });
    const dz = $('#dropzone');
    ['dragenter', 'dragover'].forEach(function (t) {
      dz.addEventListener(t, function (ev) { ev.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      dz.addEventListener(t, function (ev) { ev.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (ev) { handleFiles(ev.dataTransfer.files); });
    $('#btn-import-confirm').addEventListener('click', confirmImport);
    $$('#import-dialog [data-close]').forEach(function (b) {
      b.addEventListener('click', function () { document.getElementById('import-dialog').close(); });
    });

    /* 导出 */
    $('#btn-export').addEventListener('click', function () {
      Util.download('energy-backup-' + Util.todayStr() + '.json', TrackerImporter.toOwnJSON(state.vehicles, state.activeVehicleId), 'application/json');
      toast('备份已下载');
    });
    $('#btn-export-csv').addEventListener('click', function () {
      Util.download('energy-records-' + Util.todayStr() + '.csv', TrackerImporter.toOwnCSV(currentVehicle().records), 'text/csv;charset=utf-8');
      toast('CSV 已导出');
    });

    /* 设置 */
    $('#settings-form').addEventListener('submit', saveSettings);
    $('#btn-sample').addEventListener('click', function () {
      const v = currentVehicle();
      if (v.records.length) {
        if (!confirm('已有记录，示例数据将追加到当前车辆列表里，继续？')) return;
      }
      SAMPLE.forEach(function (s) {
        v.records.push(Object.assign({ id: Util.uid() }, s));
      });
      SAMPLE_EXPENSES.forEach(function (s) {
        v.records.push(Object.assign({ id: Util.uid(), kind: 'expense' }, s));
      });
      save();
      renderAll();
      toast('已加载 ' + (SAMPLE.length + SAMPLE_EXPENSES.length) + ' 条示例数据');
    });

    /* 车辆管理 */
    $('#vehicle-select').addEventListener('change', function () {
      const id = this.value;
      if (state.vehicles.some(function (v) { return v.id === id; })) {
        state.activeVehicleId = id;
        save();
        renderAll();
        toast('已切换车辆');
      }
    });
    $('#btn-vehicle-add').addEventListener('click', function () {
      const name = prompt('车辆名称', '新车');
      if (!name || !name.trim()) return;
      const v = { id: Util.uid(), name: name.trim(), settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), records: [] };
      state.vehicles.push(v);
      state.activeVehicleId = v.id;
      save();
      renderAll();
      toast('已添加车辆：' + v.name);
    });
    $('#btn-vehicle-rename').addEventListener('click', function () {
      const v = currentVehicle();
      const name = prompt('新的车辆名称', v.name);
      if (!name || !name.trim()) return;
      v.name = name.trim();
      v.settings.vehicleName = v.name;
      save();
      renderAll();
      toast('已重命名');
    });
    $('#btn-vehicle-del').addEventListener('click', function () {
      if (state.vehicles.length <= 1) { toast('至少保留一辆车'); return; }
      const v = currentVehicle();
      if (!confirm('删除车辆「' + v.name + '」及其全部记录？此操作不可恢复。')) return;
      state.vehicles = state.vehicles.filter(function (x) { return x.id !== v.id; });
      state.activeVehicleId = state.vehicles[0].id;
      save();
      renderAll();
      toast('已删除车辆');
    });

    /* 每日自动备份 */
    $('#btn-backup-now').addEventListener('click', function () { ensureDailyBackup(true); });
    $('#auto-download').addEventListener('change', function () {
      state.autoDownload = this.checked;
      save();
      if (this.checked) ensureDailyBackup(true);
    });
    $('#backup-list').addEventListener('click', function (ev) {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const row = ev.target.closest('.backup-row');
      const idx = row ? Number(row.dataset.idx) : -1;
      if (idx < 0) return;
      if (btn.dataset.act === 'restore') restoreBackup(idx);
      else if (btn.dataset.act === 'export') exportBackup(idx);
      else if (btn.dataset.act === 'del') deleteBackup(idx);
    });
  }

  /* ---------- Node-RED 自动记录同步 ---------- */
  const SYNC_KEY = 'energy-tracker.nodered';

  function loadSyncInfo() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveSyncInfo(info) {
    localStorage.setItem(SYNC_KEY, JSON.stringify(info));
  }
  function defaultSyncUrl() {
    return 'http://localhost:1880/api/records';
  }
  function renderSyncPanel() {
    const urlEl = $('#sync-url');
    const statusEl = $('#sync-status');
    if (!urlEl || !statusEl) return;
    const info = loadSyncInfo();
    urlEl.value = info.url || ''; // 隐私：不预填具体地址
    statusEl.textContent = info.lastSync ? '上次同步：' + String(info.lastSync).replace('T', ' ').slice(0, 16) + '（接口共 ' + (info.lastCount || 0) + ' 条）' : '';
  }
  function normalizeNodeRedRecord(r) {
    return {
      id: r.id || Util.uid(),
      date: r.date || '',
      time: r.time || '',
      mileage: r.mileage != null ? Number(r.mileage) : null,
      socStart: r.socStart != null ? Number(r.socStart) : null,
      socEnd: r.socEnd != null ? Number(r.socEnd) : null,
      energyKwh: r.energyKwh != null ? Number(r.energyKwh) : null,
      cost: r.cost != null ? Number(r.cost) : null,
      price: r.price != null ? Number(r.price) : null,
      full: !!r.full,
      type: r.type || '家充',
      note: r.note || '',
      battery: r.battery || '未知',
      source: 'node-red'
    };
  }
  async function syncNodeRed() {
    const url = ($('#sync-url').value || '').trim();
    const statusEl = $('#sync-status');
    if (!url) { statusEl.textContent = '请先填写 Node-RED 接口地址'; return; }
    statusEl.textContent = '同步中…';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const arr = await res.json();
      if (!Array.isArray(arr)) throw new Error('返回格式不是数组');
      const v = currentVehicle();
      const ids = {};
      v.records.forEach(function (r) { if (r.id) ids[r.id] = true; });
      let added = 0, skipped = 0;
      arr.forEach(function (r) {
        if (!r || typeof r !== 'object') return;
        if (!r.id) r.id = Util.uid();
        if (ids[r.id]) { skipped++; return; }
        v.records.push(normalizeNodeRedRecord(r));
        ids[r.id] = true;
        added++;
      });
      save();
      saveSyncInfo({ url: url, lastSync: new Date().toISOString(), lastCount: arr.length });
      renderAll();
      statusEl.textContent = '同步完成：新增 ' + added + ' 条' + (skipped ? '，跳过 ' + skipped + ' 条重复' : '') + '（接口共 ' + arr.length + ' 条）';
      toast(added ? '已同步 ' + added + ' 条新记录' : '没有新记录');
    } catch (e) {
      statusEl.textContent = '同步失败：' + (e && e.message ? e.message : e) + '。注意：https 页面不能访问局域网 http，请用局域网地址打开应用再同步。';
    }
  }
  async function checkNodeRed() {
    const url = ($('#sync-url').value || '').trim();
    const statusEl = $('#sync-status');
    if (!url) { statusEl.textContent = '请先填写 Node-RED 接口地址'; return; }
    let base = url;
    try {
      const u = new URL(url);
      u.pathname = '/api/status';
      base = u.toString();
    } catch (e) {}
    statusEl.textContent = '检查中…';
    try {
      const res = await fetch(base);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const st = await res.json();
      let text = '连接正常：已有记录 ' + (st.count || 0) + ' 条';
      if (st.pending) text += '，挂起换电（充电前 ' + st.pending.soc_before + '%）';
      if (st.session && st.session.active) text += '，正在充电';
      statusEl.textContent = text;
      toast('Node-RED 连接正常');
    } catch (e) {
      statusEl.textContent = '检查失败：' + (e && e.message ? e.message : e) + '。注意：https 页面不能访问局域网 http，请用局域网地址打开应用。';
    }
  }
  function pushBackupToNodeRed(url) {
    return fetch(url, {
      method: 'POST',
      body: JSON.stringify({ app: 'energy-tracker', savedAt: new Date().toISOString(), vehicles: state.vehicles, activeVehicleId: state.activeVehicleId }),
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
    }).then(function (res) { return res.ok; }).catch(function () { return false; });
  }
  async function pushBackupNow() {
    const raw = ($('#sync-url').value || '').trim();
    if (!raw) { toast('请先填写 Node-RED 接口地址'); return; }
    let backupUrl;
    try { const u = new URL(raw); u.pathname = '/api/backup'; backupUrl = u.toString(); } catch (e) { toast('接口地址格式不对'); return; }
    const ok = await pushBackupToNodeRed(backupUrl);
    localStorage.setItem('energy-tracker.nasbackup', JSON.stringify({ time: new Date().toISOString(), ok: ok }));
    renderNasBackupStatus();
    toast(ok ? '已备份到 NAS' : '备份到 NAS 失败');
  }
  function renderNasBackupStatus() {
    const el = $('#nas-backup-status');
    if (!el) return;
    try {
      const info = JSON.parse(localStorage.getItem('energy-tracker.nasbackup') || 'null');
      el.textContent = info ? 'NAS 备份：' + String(info.time).replace('T', ' ').slice(0, 16) + (info.ok ? ' 成功' : ' 失败') : '';
    } catch (e) { el.textContent = ''; }
  }
  function bindSyncEvents() {
    $('#btn-sync-node-red').addEventListener('click', syncNodeRed);
    $('#btn-check-nodered').addEventListener('click', checkNodeRed);
    $('#btn-nas-backup').addEventListener('click', pushBackupNow);
    const syncUrlEl = $('#sync-url');
    syncUrlEl.addEventListener('focus', function () {
      const el = this;
      setTimeout(function () {
        el.scrollLeft = el.scrollWidth;
        try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
      }, 0);
    });
  }
  /* ---------- PWA ---------- */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./sw.js').catch(function () { /* 静默失败 */ });
  }

  bindEvents();
  bindSyncEvents();
  renderAll();
  ensureDailyBackup(false);
  setInterval(function () { ensureDailyBackup(false); }, 60 * 60 * 1000);
})();
