/* 通用小工具：DOM 快捷操作、日期数字格式化、文件下载等 */
(function (global) {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* 两个日期之间的天数差（按自然日，b - a），无法解析返回 null */
  function daysBetween(a, b) {
    const da = a instanceof Date ? a : parseDate(a);
    const db = b instanceof Date ? b : parseDate(b);
    if (!da || !db) return null;
    const t1 = new Date(da.getFullYear(), da.getMonth(), da.getDate()).getTime();
    const t2 = new Date(db.getFullYear(), db.getMonth(), db.getDate()).getTime();
    return Math.round((t2 - t1) / 86400000);
  }

  function todayStr() { return fmtDate(new Date()); }

  function nowTimeStr() {
    const d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* 解析 "2024-03-01" / "2024/3/1" / "2024年3月1日" 等常见日期 */
  function parseDate(s) {
    if (!s) return null;
    const m = String(s).trim().match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})日?/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }

  function parseTime(s) {
    if (!s) return '';
    const m = String(s).trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return '';
    return pad2(+m[1]) + ':' + pad2(+m[2]) + (m[3] ? ':' + pad2(+m[3]) : '');
  }

  /* 数字解析：自动去掉货币符号、逗号等干扰字符；空值返回 null */
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? null : n;
  }

  function fmt(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    digits = digits === undefined ? 1 : digits;
    return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: digits });
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  global.Util = {
    $: $, $$: $$, uid: uid, pad2: pad2, fmtDate: fmtDate,
    todayStr: todayStr, nowTimeStr: nowTimeStr, daysBetween: daysBetween,
    parseDate: parseDate, parseTime: parseTime, toNum: toNum,
    fmt: fmt, esc: esc, download: download, readFileAsText: readFileAsText
  };
})(typeof window !== 'undefined' ? window : globalThis);
