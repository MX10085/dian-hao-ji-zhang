/* 轻量 SVG 图表：折线图 / 柱状图 / 环形图，无外部依赖
 * 支持鼠标悬浮与手指触摸：在图表上滑动时浮现当前所指的数值 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function gridAndAxis(W, H, padL, padR, padT, padB, min, max, fmtTick) {
    const innerH = H - padT - padB;
    let out = '';
    for (let t = 0; t <= 4; t++) {
      const yy = padT + innerH * t / 4;
      const val = max - (max - min) * t / 4;
      out += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yy.toFixed(1) + '" class="grid"/>';
      out += '<text x="' + (padL - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" class="axis">' + esc(fmtTick(val)) + '</text>';
    }
    return out;
  }

  /* 指针事件 → SVG 内部坐标 */
  function svgPoint(e, svgEl, W, H) {
    const r = svgEl.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * W / r.width,
      y: (e.clientY - r.top) * H / r.height
    };
  }

  /* 浮动数值气泡（挂在图表容器内） */
  function attachTooltip(el, svgEl) {
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    el.appendChild(tip);
    const show = function (e, html) {
      const er = el.getBoundingClientRect();
      let left = e.clientX - er.left + 14;
      let top = e.clientY - er.top - 14;
      if (left + 150 > er.width - 4) left = e.clientX - er.left - 150;
      if (left < 4) left = 4;
      if (top < 4) top = e.clientY - er.top + 16;
      tip.innerHTML = html;
      tip.hidden = false;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    };
    const hide = function () { tip.hidden = true; };
    return { show: show, hide: hide };
  }

  /* 三段渐变配色：
   * 低于均值 = 优秀（蓝 #4facfe），接近均值 = 良好（绿 #43d17b），高于均值 = 耗电（红 #ff5d5d）
   * t 为相对偏差 (y-mean)/mean，clamp 到 [-0.5, 0.5] */
  function mixColor(c1, c2, t) {
    const parse = function (c) {
      return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    };
    const a = parse(c1), b = parse(c2);
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  function colorForT(t, invert) {
    if (invert) t = -t;
    t = Math.max(-0.5, Math.min(0.5, t));
    if (t <= 0) return mixColor('#6ab7ff', '#9ad4ea', (t + 0.5) / 0.5);
    return mixColor('#9ad4ea', '#ff5d5d', t / 0.5);
  }

  /* 折线图：points = [{x, y}]；opts.mean 为基准平均值（整段数据），colorMode 控制警示方向 */
  function lineChart(el, points, opts) {
    opts = opts || {};
    const fmt = opts.fmt || function (v) { return global.Util ? global.Util.fmt(v, 1) : v; };
    const mean = opts.mean;
    const invert = opts.colorMode === 'low-bad';
    const warnText = opts.warnText || '高于平时';
    const goodText = opts.goodText || '低于平时';
    const valid = points.filter(function (p) { return p.y != null && isFinite(p.y); });
    if (valid.length === 0) { el.innerHTML = '<p class="chart-empty">暂无数据</p>'; return; }

    const W = 720, H = 260, padL = 54, padR = 16, padT = 18, padB = 30;
    let min = Math.min.apply(null, valid.map(function (p) { return p.y; }));
    let max = Math.max.apply(null, valid.map(function (p) { return p.y; }));
    if (min === max) { min -= 1; max += 1; }
    const padY = (max - min) * 0.12;
    min -= padY; max += padY;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const x = function (i) { return points.length === 1 ? padL + innerW / 2 : padL + innerW * i / (points.length - 1); };
    const y = function (v) { return padT + innerH * (1 - (v - min) / (max - min)); };

    let path = '', segPaths = '', dots = '', labels = '';
    const pts = [];
    const labelStep = Math.max(1, Math.ceil(points.length / 6));
    points.forEach(function (p, i) {
      if (p.y == null || !isFinite(p.y)) return;
      const px = x(i), py = y(p.y);
      let t = 0;
      if (mean != null && mean > 0) t = (p.y - mean) / mean;
      const color = colorForT(t, invert);
      pts.push({ x: px, y: py, t: t });
      dots += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3.4" fill="' + color + '"/>';
      if (i % labelStep === 0 || i === points.length - 1) {
        labels += '<text x="' + px.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="axis">' + esc(String(p.x).slice(5, 10)) + '</text>';
      }
    });

    /* 平滑曲线：Catmull-Rom 转三次贝塞尔，按段着色（两端点偏差均值决定颜色） */
    if (pts.length === 1) {
      path = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
    } else {
      path = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;
        const seg = ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ', ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ', ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
        path += seg;
        const tSeg = (p1.t + p2.t) / 2;
        segPaths += '<path d="M' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1) + seg + '" class="line seg-line" fill="none" style="stroke:' + colorForT(tSeg, invert) + '"/>';
      }
    }

    /* 曲线下方渐变面积（中性绿） */
    let area = '';
    if (pts.length >= 2) {
      const base = padT + innerH;
      const lastP = pts[pts.length - 1];
      area = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
      for (let i = 1; i < pts.length; i++) {
        area += ' L' + pts[i].x.toFixed(1) + ' ' + pts[i].y.toFixed(1);
      }
      area += ' L' + lastP.x.toFixed(1) + ' ' + base.toFixed(1) + ' L' + pts[0].x.toFixed(1) + ' ' + base.toFixed(1) + ' Z';
    }
    /* 平均虚线：均值在当前可见范围内才显示 */
    let avgLine = '';
    if (mean != null && isFinite(mean) && mean >= min && mean <= max) {
      const avgY = y(mean);
      avgLine = '<line x1="' + padL + '" y1="' + avgY.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + avgY.toFixed(1) + '" class="avg-line"/>' +
        '<text x="' + (W - padR - 6) + '" y="' + (avgY - 6).toFixed(1) + '" text-anchor="end" class="axis avg-label">平均 ' + esc(fmt(mean)) + '</text>';
    }
    const guide = '<line class="tt-line" x1="0" y1="0" x2="0" y2="0" style="display:none"/>' +
      '<circle class="tt-dot" r="4.5" fill="#ffd75e" stroke="#10141f" stroke-width="2" style="display:none"/>';

    const gradId = 'areaGrad' + (global.__chartSeq = (global.__chartSeq || 0) + 1);
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="折线图">' +
      '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#9ad4ea" stop-opacity="0.3"/>' +
      '<stop offset="100%" stop-color="#9ad4ea" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      gridAndAxis(W, H, padL, padR, padT, padB, min, max, fmt) +
      avgLine +
      (area ? '<path d="' + area + '" fill="url(#' + gradId + ')" class="area"/>' : '') +
      segPaths + dots + labels + guide + '</svg>';

    const svgEl = el.querySelector('svg');
    const tip = attachTooltip(el, svgEl);
    const ttLine = svgEl.querySelector('.tt-line');
    const ttDot = svgEl.querySelector('.tt-dot');
    const onMove = function (e) {
      const p = svgPoint(e, svgEl, W, H);
      let best = -1, bd = Infinity;
      points.forEach(function (pt, i) {
        if (pt.y == null || !isFinite(pt.y)) return;
        const d = Math.abs(x(i) - p.x);
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) return;
      const px = x(best), py = y(points[best].y);
      ttLine.setAttribute('x1', px.toFixed(1));
      ttLine.setAttribute('x2', px.toFixed(1));
      ttLine.setAttribute('y1', padT.toFixed(1));
      ttLine.setAttribute('y2', (H - padB).toFixed(1));
      ttLine.style.display = '';
      ttDot.setAttribute('cx', px.toFixed(1));
      ttDot.setAttribute('cy', py.toFixed(1));
      ttDot.style.display = '';
      const pt = points[best];
      let tag = '';
      if (mean != null && mean > 0 && pt.y != null && isFinite(pt.y)) {
        const t = (pt.y - mean) / mean;
        const d = invert ? -t : t;
        if (d > 0.15) tag = '<br/><span class="warn-text">⚠ ' + esc(warnText) + '</span>';
        else if (d < -0.15) tag = '<br/><span class="good-text">✓ ' + esc(goodText) + '</span>';
        else tag = '<br/><span class="mid-text">• 接近平时</span>';
      }
      tip.show(e, '<b>' + esc(pt.x) + '</b><br/>' + esc(fmt(pt.y)) + tag);
    };
    const onLeave = function () {
      ttLine.style.display = 'none';
      ttDot.style.display = 'none';
      tip.hide();
    };
    svgEl.addEventListener('pointermove', onMove);
    svgEl.addEventListener('pointerdown', onMove);
    svgEl.addEventListener('pointerleave', onLeave);
  }

  /* 柱状图：items = [{label, value}] */
  function barChart(el, items, opts) {
    opts = opts || {};
    const fmt = opts.fmt || function (v) { return global.Util ? global.Util.fmt(v, 1) : v; };
    if (!items || items.length === 0) { el.innerHTML = '<p class="chart-empty">暂无数据</p>'; return; }

    const W = 720, H = 240, padL = 54, padR = 16, padT = 26, padB = 30;
    const max = Math.max.apply(null, items.map(function (i) { return i.value || 0; })) || 1;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const step = innerW / items.length;
    const bw = Math.min(64, step * 0.55);
    const labelStep = Math.max(1, Math.ceil(items.length / 8));
    const showValues = items.length <= 12;
    let out = gridAndAxis(W, H, padL, padR, padT, padB, 0, max, fmt);
    const centers = [];

    items.forEach(function (it, i) {
      const h = innerH * (it.value || 0) / max;
      const cx = padL + step * i + step / 2;
      centers.push(cx);
      out += '<rect data-i="' + i + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + (padT + innerH - h).toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 0.6).toFixed(1) + '" rx="4" class="bar"/>';
      if (showValues) {
        out += '<text x="' + cx.toFixed(1) + '" y="' + (padT + innerH - h - 6).toFixed(1) +
          '" text-anchor="middle" class="bar-label">' + esc(fmt(it.value)) + '</text>';
      }
      if (i % labelStep === 0 || i === items.length - 1) {
        out += '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="axis">' + esc(it.label) + '</text>';
      }
    });
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="柱状图">' + out + '</svg>';

    const svgEl = el.querySelector('svg');
    const tip = attachTooltip(el, svgEl);
    const rects = svgEl.querySelectorAll('rect.bar');
    let hovered = null;
    const reset = function () {
      if (hovered) { hovered.style.stroke = ''; hovered.style.strokeWidth = ''; hovered = null; }
    };
    const onMove = function (e) {
      const p = svgPoint(e, svgEl, W, H);
      let best = -1, bd = Infinity;
      centers.forEach(function (cx, i) {
        const d = Math.abs(cx - p.x);
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) return;
      reset();
      hovered = rects[best];
      if (hovered) {
        hovered.style.stroke = '#ffffff';
        hovered.style.strokeWidth = '2';
      }
      tip.show(e, '<b>' + esc(items[best].label) + '</b><br/>' + esc(fmt(items[best].value)));
    };
    const onLeave = function () { reset(); tip.hide(); };
    svgEl.addEventListener('pointermove', onMove);
    svgEl.addEventListener('pointerdown', onMove);
    svgEl.addEventListener('pointerleave', onLeave);
  }

  const PALETTE = ['#9ad4ea', '#ff9f43', '#54a0ff', '#ee5253', '#9b59b6', '#00d2d3', '#f368e0', '#ff6b81', '#8395a7', '#48dbfb'];

  /* 项目名称 → 稳定颜色：同一项目永远同色，不同项目尽量不同色 */
  function colorForLabel(label) {
    let h = 0;
    const s = String(label || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /* 为一组项目分配互不相同的颜色（按名称排序后分配，保证稳定） */
  function colorMap(labels) {
    const uniq = [];
    labels.forEach(function (l) {
      if (uniq.indexOf(l) < 0) uniq.push(l);
    });
    const sorted = uniq.slice().sort(function (a, b) {
      return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
    });
    const used = {};
    const map = {};
    sorted.forEach(function (label) {
      let c = colorForLabel(label);
      if (used[c]) {
        const base = PALETTE.indexOf(c) < 0 ? 0 : PALETTE.indexOf(c);
        for (let k = 1; k <= PALETTE.length; k++) {
          const alt = PALETTE[(base + k) % PALETTE.length];
          if (!used[alt]) { c = alt; break; }
        }
      }
      used[c] = true;
      map[label] = c;
    });
    return map;
  }

  function arcPath(cx, cy, ro, ri, a0, a1) {
    const p = function (r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const s = p(ro, a0), e = p(ro, a1);
    const s2 = p(ri, a1), e2 = p(ri, a0);
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    return 'M' + s[0].toFixed(1) + ' ' + s[1].toFixed(1) +
      ' A' + ro + ' ' + ro + ' 0 ' + large + ' 1 ' + e[0].toFixed(1) + ' ' + e[1].toFixed(1) +
      ' L' + s2[0].toFixed(1) + ' ' + s2[1].toFixed(1) +
      ' A' + ri + ' ' + ri + ' 0 ' + large + ' 0 ' + e2[0].toFixed(1) + ' ' + e2[1].toFixed(1) + ' Z';
  }

  /* 环形图：items = [{label, value}] */
  function donutChart(el, items, opts) {
    opts = opts || {};
    const fmt = opts.fmt || function (v) { return global.Util ? global.Util.fmt(v, 2) : v; };
    const total = items.reduce(function (s, it) { return s + (Number(it.value) || 0); }, 0);
    if (!items.length || total <= 0) { el.innerHTML = '<p class="chart-empty">暂无数据</p>'; return; }

    const W = 360, H = 230, cx = W / 2, cy = H / 2 - 12, outer = 80, inner = 52;
    let ang = -Math.PI / 2;
    let paths = '', legend = '';
    const slices = [];
    const cmap = colorMap(items.map(function (it) { return it.label; }));
    items.forEach(function (it, i) {
      const frac = (Number(it.value) || 0) / total;
      const a1 = ang + frac * 2 * Math.PI;
      const color = cmap[it.label];
      slices.push({ a0: ang, a1: a1, item: it, frac: frac });
      if (frac >= 0.9999) {
        paths += '<circle data-i="' + i + '" cx="' + cx + '" cy="' + cy + '" r="' + outer + '" fill="none" stroke="' + color + '" stroke-width="' + (outer - inner) + '"/>';
      } else {
        paths += '<path data-i="' + i + '" d="' + arcPath(cx, cy, outer, inner, ang, a1) + '" fill="' + color + '" stroke="#10141f" stroke-width="2"/>';
      }
      legend += '<span class="li"><span class="dot" style="background:' + color + '"></span>' +
        esc(it.label) + '　' + esc(fmt(it.value)) + '（' + (frac * 100).toFixed(1) + '%）</span>';
      ang = a1;
    });
    paths += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" class="axis donut-title">总支出</text>';
    paths += '<text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" class="axis donut-total">' + esc(fmt(total)) + ' 元</text>';
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="费用构成">' + paths + '</svg>' +
      '<div class="legend">' + legend + '</div>';

    const svgEl = el.querySelector('svg');
    const tip = attachTooltip(el, svgEl);
    const shapes = svgEl.querySelectorAll('[data-i]');
    let hovered = null;
    const reset = function () {
      if (hovered) { hovered.style.opacity = ''; hovered = null; }
    };
    const onMove = function (e) {
      const p = svgPoint(e, svgEl, W, H);
      const dx = p.x - cx, dy = p.y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < inner - 4 || r > outer + 6) { reset(); tip.hide(); return; }
      let a = Math.atan2(dy, dx) + Math.PI / 2;
      if (a < 0) a += 2 * Math.PI;
      let idx = -1;
      for (let i = 0; i < slices.length; i++) {
        const s0 = slices[i].a0 + Math.PI / 2;
        const s1 = slices[i].a1 + Math.PI / 2;
        const inRange = s0 < s1 ? (a >= s0 && a < s1) : (a >= s0 || a < s1);
        if (inRange) { idx = i; break; }
      }
      if (idx < 0) { reset(); tip.hide(); return; }
      reset();
      hovered = shapes[idx];
      if (hovered) hovered.style.opacity = '0.75';
      const it = slices[idx].item;
      tip.show(e, '<b>' + esc(it.label) + '</b><br/>' + esc(fmt(it.value)) + ' 元（' + (slices[idx].frac * 100).toFixed(1) + '%）');
    };
    const onLeave = function () { reset(); tip.hide(); };
    svgEl.addEventListener('pointermove', onMove);
    svgEl.addEventListener('pointerdown', onMove);
    svgEl.addEventListener('pointerleave', onLeave);
  }

  /*
   * 时间轴缩放包装器：滚轮 / 双指捏合 / − ＋ ⟲ 按钮
   */
  function attachZoom(el, data, render, opts) {
    opts = opts || {};
    const minPoints = Math.max(opts.minPoints || 2, 2);
    const maxPoints = data.length;

    if (el._zoomHandlers) {
      el._zoomHandlers.forEach(function (h) {
        el.removeEventListener(h.type, h.fn, h.opts || false);
      });
      el._zoomHandlers = null;
    }
    /* 清空容器内残留内容（旧空状态提示、旧控件、旧画布），重建画布容器 */
    el.innerHTML = '';
    const body = document.createElement('div');
    body.className = 'chart-body';
    el.appendChild(body);

    /* 默认窗口：未保存过缩放状态时，显示最近 defaultWindowDays 天（如近半年） */
    const defaultWin = (function () {
      if (!opts.defaultWindowDays || maxPoints <= minPoints) return null;
      const lastX = String(data[maxPoints - 1].x || '').slice(0, 10);
      const t1 = Date.parse(lastX);
      if (isNaN(t1)) return null;
      const t0 = t1 - opts.defaultWindowDays * 86400000;
      let start = 0;
      for (let i = 0; i < maxPoints; i++) {
        const t = Date.parse(String(data[i].x || '').slice(0, 10));
        if (!isNaN(t) && t >= t0) { start = i; break; }
        start = i + 1;
      }
      if (start >= maxPoints) start = 0;
      if (maxPoints - start < minPoints) return null;
      return { start: start, end: maxPoints };
    })();
    let win = defaultWin ? { start: defaultWin.start, end: defaultWin.end } : { start: 0, end: maxPoints };
    if (opts.win && opts.win.start >= 0 && opts.win.end <= maxPoints &&
        opts.win.end - opts.win.start >= minPoints) {
      win = { start: opts.win.start, end: opts.win.end };
    }
    const notify = function () {
      if (opts.onWin) opts.onWin({ start: win.start, end: win.end });
    };

    if (maxPoints <= minPoints) {
      render(data, body);
      return;
    }

    const controls = document.createElement('div');
    controls.className = 'zoom-controls';
    controls.innerHTML =
      '<span class="zoom-hint">滚轮 / 双指缩放</span>' +
      '<button type="button" class="zoom-btn" data-zoom="panL" title="往前翻">‹</button>' +
      '<button type="button" class="zoom-btn" data-zoom="out" title="缩小">−</button>' +
      '<button type="button" class="zoom-btn" data-zoom="in" title="放大">＋</button>' +
      '<button type="button" class="zoom-btn" data-zoom="reset" title="重置">⟲</button>' +
      '<button type="button" class="zoom-btn" data-zoom="panR" title="往后翻">›</button>' +
      '<input type="date" class="zoom-date" title="跳到日期" />' +
      '<span class="zoom-label"></span>';
    el.insertBefore(controls, body);

    const labelEl = controls.querySelector('.zoom-label');
    const renderWin = function () {
      const slice = data.slice(win.start, win.end);
      render(slice, body);
      const fx = slice.length && slice[0].x != null ? String(slice[0].x).slice(0, 10) : '';
      const lx = slice.length && slice[slice.length - 1].x != null ? String(slice[slice.length - 1].x).slice(0, 10) : '';
      labelEl.textContent = fx ? fx + ' ~ ' + lx : '';
      notify();
    };

    /* 指针在图表上的 x 位置 → 数据索引（用于“以手指所指位置为锚点”缩放） */
    const svgWidthPx = function () {
      const svg = el.querySelector('svg');
      return svg ? svg.getBoundingClientRect().width : 0;
    };
    const idxAt = function (clientX) {
      const svg = el.querySelector('svg');
      const w = svg ? svg.getBoundingClientRect().width : 0;
      if (!w) return (win.start + win.end) / 2;
      const r = svg.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - r.left) / w));
      return win.start + frac * (win.end - win.start);
    };
    const zoomBy = function (factor, anchorIdx) {
      const len = win.end - win.start;
      let newLen = Math.round(len * factor);
      newLen = Math.max(minPoints, Math.min(maxPoints, newLen));
      let anchor = anchorIdx == null ? (win.start + win.end) / 2 : anchorIdx;
      anchor = Math.max(0, Math.min(maxPoints, anchor));
      const anchorFrac = len > 0 ? (anchor - win.start) / len : 0;
      let s = Math.round(anchor - anchorFrac * newLen);
      let e = s + newLen;
      if (s < 0) { s = 0; e = newLen; }
      if (e > maxPoints) { e = maxPoints; s = e - newLen; }
      win = { start: s, end: e };
      renderWin();
    };
    const panBy = function (deltaIdx) {
      const len = win.end - win.start;
      let s = Math.round(win.start + deltaIdx);
      let e = s + len;
      if (s < 0) { s = 0; e = len; }
      if (e > maxPoints) { e = maxPoints; s = e - len; }
      if (s !== win.start) {
        win = { start: s, end: e };
        renderWin();
      }
    };

    const pan = function (dir) {
      const len = win.end - win.start;
      const step = Math.max(1, Math.round(len * 0.5));
      let s = win.start + dir * step;
      let e = s + len;
      if (s < 0) { s = 0; e = len; }
      if (e > maxPoints) { e = maxPoints; s = e - len; }
      win = { start: s, end: e };
      renderWin();
    };

    /* 按日期跳转：定位到数据中离目标日期最近的记录 */
    const dateInput = controls.querySelector('.zoom-date');
    dateInput.addEventListener('change', function () {
      const v = dateInput.value;
      dateInput.value = '';
      if (!v) return;
      const target = Date.parse(v);
      if (isNaN(target)) return;
      let idx = -1, best = Infinity;
      data.forEach(function (it, i) {
        const dx = String(it.x || '').slice(0, 10);
        if (!dx) return;
        const t = Date.parse(dx);
        if (isNaN(t)) return;
        const diff = Math.abs(t - target);
        if (diff < best) { best = diff; idx = i; }
      });
      if (idx < 0) return;
      const len = win.end - win.start;
      let s = idx - Math.round(len / 2);
      let e = s + len;
      if (s < 0) { s = 0; e = len; }
      if (e > maxPoints) { e = maxPoints; s = e - len; }
      win = { start: s, end: e };
      renderWin();
    });

    controls.addEventListener('click', function (ev) {
      const b = ev.target.closest('button[data-zoom]');
      if (!b) return;
      if (b.dataset.zoom === 'in') zoomBy(0.75);
      else if (b.dataset.zoom === 'out') zoomBy(1.35);
      else if (b.dataset.zoom === 'panL') pan(-1);
      else if (b.dataset.zoom === 'panR') pan(1);
      else {
        win = defaultWin ? { start: defaultWin.start, end: defaultWin.end } : { start: 0, end: maxPoints };
        renderWin();
      }
    });

    renderWin();

    /* 缩放事件用委托绑定在容器上：svg 每次缩放重绘都会被替换，容器不会 */
    el.classList.add('zoomable');
    const handlers = [];
    const addHandler = function (type, fn, opts2) {
      el.addEventListener(type, fn, opts2 || false);
      handlers.push({ type: type, fn: fn, opts: opts2 || false });
    };
    const svgContains = function (e) {
      const svg = el.querySelector('svg');
      return svg && e.target && e.target.closest && e.target.closest('svg') === svg;
    };

    addHandler('wheel', function (e) {
      if (!svgContains(e)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.8 : 1.25, idxAt(e.clientX));
    }, { passive: false });

    let pointers = {};
    let pinchDist = null;
    let drag = null;
    let lastActivity = 0;
    const pinch = function () {
      const pts = Object.keys(pointers).map(function (k) { return pointers[k]; });
      return pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : null;
    };
    addHandler('pointerdown', function (e) {
      if (!svgContains(e)) return;
      const now = e.timeStamp || Date.now();
      /* 重绘可能丢失 pointerup 导致状态残留；新手势（间隔>400ms）或指针数异常时清空重建 */
      if (Object.keys(pointers).length >= 2 ||
          (now - lastActivity > 400 && Object.keys(pointers).length > 0)) {
        pointers = {};
        pinchDist = null;
        drag = null;
      }
      lastActivity = now;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pointers).length === 1) drag = { id: e.pointerId, x: e.clientX };
      const d = pinch();
      if (d != null) pinchDist = d;
    });
    addHandler('pointermove', function (e) {
      if (!(e.pointerId in pointers)) return;
      lastActivity = e.timeStamp || Date.now();
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      const d = pinch();
      if (d != null && pinchDist) {
        const f = d / pinchDist;
        /* 距离突变（残留数据）时重新校准，不做缩放 */
        if (f > 4 || f < 0.25) { pinchDist = d; return; }
        if (f > 1.02 || f < 0.98) {
          const keys = Object.keys(pointers);
          const midX = (pointers[keys[0]].x + pointers[keys[1]].x) / 2;
          zoomBy(1 / f, idxAt(midX));
          pinchDist = d;
          drag = null;
        }
      } else if (drag && drag.id === e.pointerId && Object.keys(pointers).length === 1) {
        const dx = e.clientX - drag.x;
        const w = svgWidthPx();
        if (w > 0 && Math.abs(dx) >= 2) {
          panBy(-dx / w * (win.end - win.start));
          drag.x = e.clientX;
        }
      }
    });
    const clearPointer = function (e) {
      lastActivity = e.timeStamp || Date.now();
      delete pointers[e.pointerId];
      if (drag && drag.id === e.pointerId) drag = null;
      if (Object.keys(pointers).length < 2) pinchDist = null;
    };
    addHandler('pointerup', clearPointer);
    addHandler('pointercancel', clearPointer);
    el._zoomHandlers = handlers;
  }

  global.TrackerCharts = {
    lineChart: lineChart,
    barChart: barChart,
    donutChart: donutChart,
    attachZoom: attachZoom,
    colorForLabel: colorForLabel,
    colorMap: colorMap
  };
})(typeof window !== 'undefined' ? window : globalThis);
