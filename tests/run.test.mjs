import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Importer = require('../js/importer.js');
const Calc = require('../js/calc.js');

test('CSV 解析：支持引号、逗号、CRLF', () => {
  const csv = '日期,时间,里程\r\n2026-08-01,20:00,100\r\n2026-08-02,21:00,"1,000"\r\n';
  const rows = Importer.parseCSV(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['日期', '时间', '里程']);
  assert.deepEqual(rows[2], ['2026-08-02', '21:00', '1,000']);
});

test('小熊油耗油耗 CSV（12 字段）导入', () => {
  const csv = [
    '日期,时间,里程,油价,费用,油耗,是否加满,燃油类型,备注,是否上次忘记记录,是否油灯亮了,加油站',
    '2026-07-20,20:13:24,1240,0.60,1.09,15.2,1,家充,首次记录,0,0,自家插座',
    '2026-08-05,22:30:44,1460,0.90,0.67,13.8,0,小区充电桩,补电,0,0,小区2号桩'
  ].join('\n');
  const r = Importer.importText(csv);
  assert.equal(r.kind, 'xiaoxiong-fuel');
  assert.equal(r.records.length, 2);
  const a = r.records[0];
  assert.equal(a.date, '2026-07-20');
  assert.equal(a.time, '20:13:24');
  assert.equal(a.mileage, 1240);
  assert.equal(a.price, 0.6);
  assert.equal(a.cost, 1.09);
  assert.equal(a.full, true);
  assert.equal(a.type, '家充');
  assert.equal(a.note, '首次记录');
  assert.equal(a.station, '自家插座');
  /* 充电量 = 费用 / 电价 反推 */
  assert.ok(Math.abs(a.energyKwh - 1.817) < 1e-6);
  const b = r.records[1];
  assert.equal(b.full, false);
});

test('小熊油耗费用 CSV（5 字段）导入', () => {
  const csv = [
    '日期,时间,类型,费用,备注',
    '2026-07-28,20:59:21,保养,50.00,链条润滑',
    '2026-08-06,18:30:00,保险,120.00,交强险'
  ].join('\n');
  const r = Importer.importText(csv);
  assert.equal(r.kind, 'xiaoxiong-expense');
  assert.equal(r.expenses.length, 2);
  assert.equal(r.expenses[0].kind, 'expense');
  assert.equal(r.expenses[0].cost, 50);
});

test('通用 CSV：中文表头自动识别', () => {
  const csv = [
    '日期,时间,里程,充电量,费用,电价,充电前电量,充电后电量,充满,充电方式,备注,站点',
    '2026-08-01,20:00,1000,1.8,1.08,0.6,10,100,1,家充,测试,自家',
    '2026-08-03,21:00,1030,1.0,0.9,0.9,40,80,0,小区充电桩,,2号桩'
  ].join('\n');
  const r = Importer.importText(csv);
  assert.equal(r.kind, 'generic');
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].energyKwh, 1.8);
  assert.equal(r.records[0].full, true);
  assert.equal(r.records[0].socStart, 10);
  assert.equal(r.records[1].full, false);
});

test('JSON 备份（v2 多车辆）导入导出往返', () => {
  const settings = { vehicleName: '测试车', batteryCapacityWh: 1863, chargerEfficiency: 0.88, defaultPrice: 0.6, unit: 'Wh/km' };
  const records = [
    { id: 'a1', date: '2026-08-01', time: '20:00', mileage: 1000, socStart: 10, socEnd: 100, energyKwh: 1.8, cost: 1.08, price: 0.6, full: true, type: '家充', note: '' },
    { id: 'a2', date: '2026-08-03', time: '21:00', mileage: 1030, energyKwh: 1.0, cost: 0.9, price: 0.9, full: false, type: '小区充电桩', note: '' }
  ];
  const vehicles = [{ id: 'v1', name: '测试车', settings: settings, records: records }];
  const json = Importer.toOwnJSON(vehicles, 'v1');
  const r = Importer.importText(json);
  assert.equal(r.kind, 'json');
  assert.equal(r.vehicles.length, 1);
  assert.equal(r.vehicles[0].records.length, 2);
  assert.deepEqual(r.vehicles[0].settings, settings);
  assert.equal(r.vehicles[0].records[0].id, 'a1');
  assert.equal(r.vehicles[0].records[0].energyKwh, 1.8);
});

test('旧版 JSON 备份（v1 单车辆）仍可导入', () => {
  const json = JSON.stringify({
    app: 'energy-tracker', version: 1,
    settings: { vehicleName: '老车' },
    records: [{ id: 'x1', date: '2026-01-01', mileage: 100, energyKwh: 1.0 }]
  });
  const r = Importer.importText(json);
  assert.equal(r.kind, 'json');
  assert.equal(r.records.length, 1);
  assert.deepEqual(r.settings, { vehicleName: '老车' });
});

test('CSV 导出后能再导入（自身格式往返）', () => {
  const records = [
    { id: 'a1', date: '2026-08-01', time: '20:00', mileage: 1000, socStart: 10, socEnd: 100, energyKwh: 1.8, cost: 1.08, price: 0.6, full: true, type: '家充', note: '测试' },
    { id: 'a2', date: '2026-08-03', time: '21:00', mileage: 1030, energyKwh: 1.0, cost: 0.9, price: 0.9, full: false, type: '小区充电桩', note: '' }
  ];
  const csv = Importer.toOwnCSV(records);
  const r = Importer.importText(csv);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].date, '2026-08-01');
  assert.equal(r.records[0].energyKwh, 1.8);
  assert.equal(r.records[0].full, true);
  assert.equal(r.records[1].full, false);
});

test('路段电耗：优先用前后电量差计算车端电耗', () => {
  const records = [
    { id: 'r1', date: '2026-08-01', time: '08:00', mileage: 100, socEnd: 100 },
    { id: 'r2', date: '2026-08-02', time: '20:00', mileage: 130, socStart: 40, socEnd: 100, energyKwh: 1.2, cost: 0.72, price: 0.6 }
  ];
  const settings = { batteryCapacityWh: 1863, chargerEfficiency: 0.88 };
  const segs = Calc.computeSegments(records, settings);
  assert.equal(segs.length, 2);
  const seg = segs[1];
  assert.equal(seg.distanceKm, 30);
  /* 车端：1.863 × (100-40)/100 = 1.1178 kWh */
  assert.ok(Math.abs(seg.batteryKwh - 1.1178) < 1e-9);
  assert.ok(Math.abs(seg.whPerKm - 1.1178 * 1000 / 30) < 1e-9);
  /* 墙端/费用直接用本条充电记录 */
  assert.equal(seg.wallKwh, 1.2);
  assert.equal(seg.cost, 0.72);
  assert.ok(Math.abs(seg.costPerKm - 0.72 / 30) < 1e-9);
});

test('路段电耗：没有电量数据时按充电量×充电效率', () => {
  const records = [
    { id: 'r1', date: '2026-08-01', time: '08:00', mileage: 100 },
    { id: 'r2', date: '2026-08-02', time: '20:00', mileage: 130, energyKwh: 1.0, cost: 0.6, price: 0.6 }
  ];
  const segs = Calc.computeSegments(records, { batteryCapacityWh: 1863, chargerEfficiency: 0.88 });
  const seg = segs[1];
  assert.equal(seg.distanceKm, 30);
  assert.ok(Math.abs(seg.batteryKwh - 0.88) < 1e-9);
  assert.ok(Math.abs(seg.wallWhPerKm - 1000 / 30) < 1e-9);
});

test('汇总：加权平均与月度统计', () => {
  const records = [
    { id: 'r1', date: '2026-07-01', time: '08:00', mileage: 100, socEnd: 100, energyKwh: 1.0, cost: 0.6, price: 0.6 },
    { id: 'r2', date: '2026-07-15', time: '20:00', mileage: 130, socStart: 50, socEnd: 100, energyKwh: 1.0, cost: 0.6, price: 0.6 },
    { id: 'r3', date: '2026-08-01', time: '08:00', mileage: 170, socStart: 20, socEnd: 100, energyKwh: 1.2, cost: 0.72, price: 0.6 }
  ];
  const s = Calc.summary(records, { batteryCapacityWh: 1863, chargerEfficiency: 0.88 });
  assert.equal(s.totalDistance, 70);
  assert.equal(s.recordCount, 3);
  /* 累计充电/总费用包含第一条记录（不依赖路段配对） */
  assert.equal(s.totalWallKwh, 3.2);
  assert.equal(s.totalCost, 1.92);
  /* 月度充电花费 */
  assert.ok(Math.abs(s.thisMonthCost - 0.72) < 1e-6);
  const jul = s.monthCharges.find((m) => m.month === '2026-07');
  assert.equal(jul.cost, 1.2);
  /* 加权平均车端电耗 */
  const batt = 1.863 * 0.5 + 1.863 * 0.8; /* 路段1: 100→50 消耗50%; 路段2: 100→20 消耗80% */
  const expectWh = batt * 1000 / 70;
  assert.ok(Math.abs(s.avgWhPerKm - expectWh) < 1e-6);
});

test('相伴天数工具', () => {
  require('../js/util.js');
  const Util = globalThis.Util;
  assert.equal(Util.daysBetween('2026-08-01', '2026-08-12'), 11);
  assert.equal(Util.daysBetween('2026-08-12', '2026-08-01'), -11);
  assert.equal(Util.daysBetween('不是日期', '2026-08-12'), null);
});

test('费用统计：分类、月度支出、构成', () => {
  const records = [
    { id: 'c1', date: '2026-07-01', cost: 1.0 },
    { id: 'c2', date: '2026-08-01', cost: 0.7 },
    { id: 'e1', date: '2026-07-05', type: '保养', cost: 50, kind: 'expense' },
    { id: 'e2', date: '2026-07-06', type: '保养', cost: 30, kind: 'expense' },
    { id: 'e3', date: '2026-08-02', type: '保险', cost: 120, kind: 'expense' }
  ];
  const es = Calc.expenseStats(records);
  assert.equal(es.chargeCount, 2);
  assert.equal(es.chargeTotal, 1.7);
  assert.equal(es.totalExpense, 200);
  assert.equal(es.totalSpend, 201.7);
  /* 类别按金额降序 */
  assert.deepEqual(es.categories.map(function (c) { return c.type; }), ['保险', '保养']);
  assert.equal(es.categories[1].count, 2);
  /* 月度支出：2026-07 = 1 + 50 + 30 = 81；2026-08 = 0.7 + 120 = 120.7 */
  assert.equal(es.monthTotals[0].total, 81);
  assert.equal(es.monthTotals[1].total, 120.7);
  /* 构成第一项是充电费 */
  assert.equal(es.breakdown[0].label, '充电费');
  assert.equal(es.breakdown[0].value, 1.7);
});

test('电池容量健康估算', () => {
  const settings = { batteryCapacityWh: 1863, chargerEfficiency: 0.88 };
  const records = [
    { date: '2026-01-01', socStart: 13, socEnd: 100, energyKwh: 1.8 },
    { date: '2026-01-08', socStart: 10, socEnd: 100, energyKwh: 1.75 },
    { date: '2026-01-15', socStart: 15, socEnd: 100, energyKwh: 1.7 }
  ];
  const bh = Calc.batteryHealth(records, settings);
  assert.equal(bh.estimates.length, 3);
  assert.equal(bh.count, 3);
  assert.ok(Math.abs(bh.latestWh - 1764) <= 1);
  assert.ok(bh.soh > 90 && bh.soh < 100);
  assert.ok(bh.lossPerYearWh != null);
  /* 电量差 < 20% 的充电被跳过 */
  const r2 = records.concat([{ date: '2026-01-16', socStart: 95, socEnd: 100, energyKwh: 0.1 }]);
  assert.equal(Calc.batteryHealth(r2, settings).estimates.length, 3);
});

test('电耗异常时点标记（中位数基准）', () => {
  const pts = [10, 11, 10.5, 12, 11, 30].map(function (y, i) {
    return { x: '2026-07-0' + (i + 1), y: y };
  });
  const flagged = Calc.flagHighConsumption(pts, 1.5);
  assert.equal(flagged.length, 6);
  assert.equal(flagged.filter(function (p) { return p.warn; }).length, 1);
  assert.equal(flagged[5].warn, true);
  assert.equal(flagged[0].warn, false);
});

test('异常标记支持低值方向（容量估算）', () => {
  const pts = [1700, 1750, 1680, 1000, 1720].map(function (y, i) {
    return { x: 'd' + i, y: y };
  });
  const flagged = Calc.flagHighConsumption(pts, 1.5, 'low');
  /* 中位数 1700，阈值 1700/1.5 ≈ 1133，1000 触发 */
  assert.equal(flagged.filter(function (p) { return p.warn; }).length, 1);
  assert.equal(flagged[3].warn, true);
  const both = Calc.flagHighConsumption(pts, 1.5, 'both');
  assert.equal(both.filter(function (p) { return p.warn; }).length, 1);
});
