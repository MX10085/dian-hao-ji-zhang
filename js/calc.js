/*
 * 电耗计算引擎
 * 记录按日期时间排序，相邻两条记录构成一个“路段”：
 *  - 距离 = 后一条里程 - 前一条里程
 *  - 车端电耗优先用前后电量百分比差计算（不需要知道充电效率）：
 *      路段耗电 = 电池容量 × (前一条充电后电量% - 本条充电前电量%) / 100
 *    若没有电量数据，则退化为：墙端充电量 × 充电效率
 *  - 墙端电耗/费用直接用本条记录的充电量/费用
 */
(function (global) {
  'use strict';

  function sortRecords(records) {
    return records.slice().sort(function (a, b) {
      const da = String(a.date || ''), db = String(b.date || '');
      if (da !== db) return da < db ? -1 : 1;
      const ta = String(a.time || ''), tb = String(b.time || '');
      if (ta !== tb) return ta < tb ? -1 : 1;
      const ia = String(a.id || ''), ib = String(b.id || '');
      if (ia !== ib) return ia < ib ? -1 : 1;
      return 0;
    });
  }

  function computeSegments(records, settings) {
    const capWh = settings && settings.batteryCapacityWh != null && settings.batteryCapacityWh > 0 ? settings.batteryCapacityWh : 1863;
    const capKwh = capWh / 1000;
    const eff = settings && settings.chargerEfficiency != null && settings.chargerEfficiency > 0 ? settings.chargerEfficiency : 0.88;
    const sorted = sortRecords(records);
    const segments = [];
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i], prev = i > 0 ? sorted[i - 1] : null;
      const seg = { record: cur, index: i };
      if (prev && cur.kind !== 'expense' && prev.kind !== 'expense') {
        if (cur.mileage != null && prev.mileage != null) {
          seg.distanceKm = cur.mileage - prev.mileage;
          if (seg.distanceKm <= 0) seg.distanceKm = null;
        }
        if (prev.socEnd != null && cur.socStart != null) {
          seg.batteryKwh = capKwh * (prev.socEnd - cur.socStart) / 100;
        } else if (cur.energyKwh != null && cur.energyKwh > 0) {
          seg.batteryKwh = cur.energyKwh * eff;
        } else if (prev.socEnd != null && cur.socEnd != null) {
          seg.batteryKwh = capKwh * (prev.socEnd - cur.socEnd) / 100;
        }
        seg.wallKwh = cur.energyKwh != null
          ? cur.energyKwh
          : (cur.cost != null && cur.price != null && cur.price > 0 ? cur.cost / cur.price : null);
        seg.cost = cur.cost != null
          ? cur.cost
          : (cur.energyKwh != null && cur.price != null ? cur.energyKwh * cur.price : null);
        if (seg.distanceKm) {
          if (seg.batteryKwh != null) seg.whPerKm = seg.batteryKwh * 1000 / seg.distanceKm;
          if (seg.wallKwh != null) seg.wallWhPerKm = seg.wallKwh * 1000 / seg.distanceKm;
          if (seg.cost != null) seg.costPerKm = seg.cost / seg.distanceKm;
        }
      }
      segments.push(seg);
    }
    return segments;
  }

  function weightedAvg(sum, km) {
    return km > 0 ? sum / km : null;
  }

  function summary(records, settings) {
    const segs = computeSegments(records, settings);
    const charges = records.filter(function (r) { return r.kind !== 'expense'; });
    const expenses = records.filter(function (r) { return r.kind === 'expense'; });

    let battSum = 0, battKm = 0, wallSum = 0, wallKm = 0, costSum = 0, costKm = 0;
    let totalBattery = 0;
    /* 累计充电/总费用按全部充电记录直接求和（与费用页口径一致），车端耗电按路段计算 */
    let totalWall = charges.reduce(function (s, r) {
      return s + (r.energyKwh != null ? r.energyKwh : (r.cost != null && r.price != null && r.price > 0 ? r.cost / r.price : 0));
    }, 0);
    let totalCost = charges.reduce(function (s, r) { return s + (r.cost || 0); }, 0);
    let totalExpense = 0;
    segs.forEach(function (s) {
      if (s.batteryKwh != null) totalBattery += s.batteryKwh;
      if (s.distanceKm) {
        if (s.batteryKwh != null) { battSum += s.batteryKwh; battKm += s.distanceKm; }
        if (s.wallKwh != null) { wallSum += s.wallKwh; wallKm += s.distanceKm; }
        if (s.cost != null) { costSum += s.cost; costKm += s.distanceKm; }
      }
    });
    expenses.forEach(function (r) { if (r.cost != null) totalExpense += r.cost; });

    const ms = charges.map(function (r) { return r.mileage; }).filter(function (m) { return m != null; });
    const totalDistance = ms.length >= 2 ? Math.max.apply(null, ms) - Math.min.apply(null, ms) : null;
    /* 总里程：最新一条记录的仪表里程（表显） */
    const sortedCharges = sortRecords(charges);
    const lastCharge = sortedCharges.length ? sortedCharges[sortedCharges.length - 1] : null;
    const lastMileage = lastCharge && lastCharge.mileage != null ? lastCharge.mileage : null;

    const monthCharges = {};
    charges.forEach(function (r) {
      const m = String(r.date || '').slice(0, 7);
      if (!m) return;
      if (!monthCharges[m]) monthCharges[m] = { cost: 0, wall: 0 };
      if (r.cost != null) monthCharges[m].cost += r.cost;
      if (r.energyKwh != null) monthCharges[m].wall += r.energyKwh;
    });
    const monthList = Object.keys(monthCharges).sort().map(function (m) {
      return { month: m, cost: round2(monthCharges[m].cost), wall: round2(monthCharges[m].wall) };
    });
    const now = new Date();
    const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const thisMonthCost = monthCharges[thisMonth] ? monthCharges[thisMonth].cost : 0;

    return {
      recordCount: charges.length,
      expenseCount: expenses.length,
      totalDistance: totalDistance == null ? null : round2(totalDistance),
      lastMileage: lastMileage == null ? null : round2(lastMileage),
      totalBatteryKwh: round2(totalBattery),
      totalWallKwh: round2(totalWall),
      totalCost: round2(totalCost),
      totalExpense: round2(totalExpense),
      avgWhPerKm: battKm > 0 ? battSum * 1000 / battKm : null,
      avgWallWhPerKm: wallKm > 0 ? wallSum * 1000 / wallKm : null,
      avgCostPerKm: costKm > 0 ? costSum / costKm : null,
      monthCharges: monthList,
      thisMonthCost: round2(thisMonthCost)
    };
  }

  /*
   * 费用统计：
   *  - categories：各费用类别（保养/保险…）的笔数与金额，按金额降序
   *  - monthTotals：每月总支出（充电费 + 其他费用）
   *  - breakdown：费用构成（充电费 + 各类别），供环形图使用
   */
  function expenseStats(records) {
    const charges = records.filter(function (r) { return r.kind !== 'expense'; });
    const expenses = records.filter(function (r) { return r.kind === 'expense'; });

    const chargeCount = charges.length;
    const chargeTotal = charges.reduce(function (s, r) { return s + (r.cost || 0); }, 0);
    const totalExpense = expenses.reduce(function (s, r) { return s + (r.cost || 0); }, 0);

    const byType = {};
    expenses.forEach(function (r) {
      const t = (r.type && String(r.type).trim()) || '其他';
      if (!byType[t]) byType[t] = { count: 0, total: 0 };
      byType[t].count += 1;
      byType[t].total += r.cost || 0;
    });
    const categories = Object.keys(byType).map(function (t) {
      return { type: t, count: byType[t].count, total: round2(byType[t].total) };
    }).sort(function (a, b) { return b.total - a.total; });

    const months = {};
    records.forEach(function (r) {
      const m = String(r.date || '').slice(0, 7);
      if (!m) return;
      months[m] = (months[m] || 0) + (r.cost || 0);
    });
    const monthTotals = Object.keys(months).sort().map(function (m) {
      return { month: m, total: round2(months[m]) };
    });

    const breakdown = [{ label: '充电费', value: round2(chargeTotal) }]
      .concat(categories.map(function (c) { return { label: c.type, value: c.total }; }))
      .filter(function (x) { return x.value > 0; });

    return {
      chargeCount: chargeCount,
      chargeTotal: round2(chargeTotal),
      totalExpense: round2(totalExpense),
      totalSpend: round2(chargeTotal + totalExpense),
      categories: categories,
      monthTotals: monthTotals,
      breakdown: breakdown
    };
  }

  /*
   * 电池容量健康估算（SOH）：
   * 每次充电：存储电量 ≈ 墙端充电量 × 充电效率 = 当前容量 × (充后% − 充前%) / 100
   * 反推：当前容量 ≈ 墙端充电量 × 效率 × 100 / 电量差
   * 跳过电量差小于 20% 的充电（SOC 取整误差大），并过滤明显异常值。
   */
  function batteryHealth(records, settings) {
    const nominalWh = settings && settings.batteryCapacityWh && settings.batteryCapacityWh > 0
      ? settings.batteryCapacityWh : 1863;
    const eff = settings && settings.chargerEfficiency && settings.chargerEfficiency > 0
      ? settings.chargerEfficiency : 0.88;
    const charges = records.filter(function (r) { return r.kind !== 'expense'; });
    const estimates = [];

    charges.forEach(function (r) {
      const s0 = r.socStart, s1 = r.socEnd;
      if (s0 == null || s1 == null || s1 <= s0) return;
      const delta = s1 - s0;
      if (delta < 20) return;
      let kwh = r.energyKwh;
      if (kwh == null && r.cost != null && r.price != null && r.price > 0) kwh = r.cost / r.price;
      if (kwh == null || kwh <= 0) return;
      const estWh = kwh * eff * 100 / delta * 1000;
      if (estWh < nominalWh * 0.3 || estWh > nominalWh * 1.8) return;
      estimates.push({ date: String(r.date || ''), estWh: Math.round(estWh), socDelta: Math.round(delta) });
    });
    estimates.sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    });

    const result = {
      hasData: estimates.length > 0,
      estimates: estimates,
      count: estimates.length,
      nominalWh: nominalWh
    };
    if (!estimates.length) {
      result.avgWh = null; result.latestWh = null; result.earliestWh = null;
      result.soh = null; result.lossPerYearWh = null;
      return result;
    }

    const avgOf = function (list) {
      return Math.round(list.reduce(function (s, e) { return s + e.estWh; }, 0) / list.length);
    };
    result.avgWh = avgOf(estimates);
    result.earliestWh = avgOf(estimates.slice(0, 5));
    result.latestWh = avgOf(estimates.slice(-5));
    result.soh = Math.round(result.latestWh / nominalWh * 1000) / 10;

    /* 最小二乘线性趋势：Wh/天 → Wh/年 */
    result.lossPerYearWh = null;
    if (estimates.length >= 3) {
      const t0 = Date.parse(estimates[0].date + 'T00:00:00');
      let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
      estimates.forEach(function (e) {
        const t = (Date.parse(e.date + 'T00:00:00') - t0) / 86400000;
        if (!isFinite(t)) return;
        n++; sx += t; sy += e.estWh; sxx += t * t; sxy += t * e.estWh;
      });
      if (n >= 3) {
        const denom = n * sxx - sx * sx;
        if (denom !== 0) {
          const slope = (n * sxy - sx * sy) / denom;
          result.lossPerYearWh = Math.round(slope * 365);
        }
      }
    }
    return result;
  }

  /* 标记明显偏离平时的时点：以中位数为基准
   * mode: 'high' 高于 中位数×factor（默认，电耗异常高）
   *       'low'  低于 中位数/factor（容量异常低）
   *       'both' 两个方向都标记 */
  function flagHighConsumption(points, factor, mode) {
    factor = factor || 1.5;
    mode = mode || 'high';
    const ys = points.map(function (p) { return p.y; })
      .filter(function (v) { return v != null && isFinite(v); })
      .sort(function (a, b) { return a - b; });
    const med = ys.length ? ys[Math.floor(ys.length / 2)] : null;
    return points.map(function (p) {
      let warn = false;
      if (med != null && p.y != null && isFinite(p.y)) {
        if (mode === 'low') warn = p.y < med / factor;
        else if (mode === 'both') warn = p.y > med * factor || p.y < med / factor;
        else warn = p.y > med * factor;
      }
      return {
        x: p.x,
        y: p.y,
        warn: warn
      };
    });
  }

  function round2(v) {
    if (v === null || v === undefined || isNaN(v)) return null;
    return Math.round(v * 100) / 100;
  }

  const TrackerCalc = {
    sortRecords: sortRecords,
    computeSegments: computeSegments,
    summary: summary,
    expenseStats: expenseStats,
    batteryHealth: batteryHealth,
    flagHighConsumption: flagHighConsumption
  };

  global.TrackerCalc = TrackerCalc;
  if (typeof module !== 'undefined' && module.exports) module.exports = TrackerCalc;
})(typeof window !== 'undefined' ? window : globalThis);
