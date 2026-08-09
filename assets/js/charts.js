/* ==========================================================================
   charts.js — the two dashboard charts, drawn as inline SVG (no libraries).

   Form: both answer "how do these categories compare in magnitude?" for a
   single series, so both are horizontal bar charts — category labels are long
   and read better on the y-axis. Single series ⇒ no legend (the title names
   it) and one hue per chart, not one hue per bar: colour here carries no
   information beyond "this is the data", so varying it would be decorative.

   Colour: --series-1 (blue) for the status chart, --series-2 (orange) for the
   mission-area chart — the two validated slots for concurrent single-hue
   contexts. Validated against the real chart surface #0e1524:
   lightness band / chroma / CVD ΔE 26.8 / normal-vision ΔE 31.8 / contrast — all PASS.

   Every chart ships direct value labels, a hover tooltip, and a table view.
   ========================================================================== */
(function (global) {
  'use strict';

  var esc = global.ESH.ui.esc;
  var tipEl = null;

  function showTip(evt, html) {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'chart-tip';
      document.body.appendChild(tipEl);
    }
    tipEl.innerHTML = html;
    tipEl.style.display = 'block';
    var pad = 14;
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var x = evt.clientX + pad, y = evt.clientY - h - 8;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y < 8) y = evt.clientY + pad;
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

  /* Bar path with a 4px rounded far end, square against the baseline. */
  function barPath(x0, x1, y, h, r) {
    var w = x1 - x0;
    if (w <= 0.5) return 'M' + x0 + ',' + y + 'h0.5v' + h + 'h-0.5Z';
    if (w < r) return 'M' + x0 + ',' + y + 'H' + x1 + 'V' + (y + h) + 'H' + x0 + 'Z';
    return 'M' + x0 + ',' + y +
           'H' + (x1 - r) + 'A' + r + ',' + r + ' 0 0 1 ' + x1 + ',' + (y + r) +
           'V' + (y + h - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x1 - r) + ',' + (y + h) +
           'H' + x0 + 'Z';
  }

  /* Axis scale for whole-number counts: pick a 1/2/5×10ⁿ step giving roughly
     four intervals, then round the maximum up to a multiple of it. This keeps
     the gridlines evenly spaced and integral — a naive "nice maximum" divided
     into quarters yields ticks like 0,1,3,4,5. */
  function scaleFor(rawMax) {
    if (rawMax <= 0) return { max: 1, ticks: [0, 1] };
    var raw = rawMax / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    if (step < 1) step = 1;                       /* counts are integers */
    var max = Math.ceil(rawMax / step) * step;
    var ticks = [];
    for (var v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v));
    return { max: max, ticks: ticks };
  }

  /**
   * horizontalBars(opts)
   *   opts.title, opts.subtitle, opts.unit
   *   opts.data  = [{ label, value, href? }]
   *   opts.color = CSS custom-property name, e.g. 'var(--series-1)'
   * Returns an HTML string; call bindTips(container) after insertion.
   */
  function horizontalBars(opts) {
    var data = opts.data || [];
    var color = opts.color || 'var(--series-1)';
    var unit = opts.unit || 'reports';

    var total = data.reduce(function (a, d) { return a + d.value; }, 0);
    var scale = scaleFor(Math.max.apply(null, data.map(function (d) { return d.value; }).concat([0])));
    var maxVal = scale.max;

    var rowH = 26, gap = 6, padTop = 22, padBottom = 26;
    var labelW = 168, valueW = 42, rightPad = 8;
    var vw = 640;
    var plotX = labelW;
    var plotW = vw - labelW - valueW - rightPad;
    var vh = padTop + data.length * (rowH + gap) - gap + padBottom;

    function sx(v) { return plotX + (maxVal ? (v / maxVal) * plotW : 0); }

    var ticks = scale.ticks;

    var svg = '<svg viewBox="0 0 ' + vw + ' ' + vh + '" role="img" aria-label="' +
      esc(opts.title + '. ' + data.map(function (d) { return d.label + ': ' + d.value; }).join('; ')) + '">';

    /* recessive gridlines + tick labels */
    ticks.forEach(function (t) {
      var x = sx(t);
      svg += '<line class="c-grid" x1="' + x + '" y1="' + (padTop - 8) + '" x2="' + x + '" y2="' + (vh - padBottom + 4) + '"/>';
      svg += '<text class="c-label" x="' + x + '" y="' + (vh - padBottom + 18) + '" text-anchor="middle">' + t + '</text>';
    });
    /* baseline */
    svg += '<line class="c-axis" x1="' + plotX + '" y1="' + (padTop - 8) + '" x2="' + plotX + '" y2="' + (vh - padBottom + 4) + '"/>';

    data.forEach(function (d, i) {
      var y = padTop + i * (rowH + gap);
      var barH = rowH - 2;                       /* 2px surface gap between adjacent bars */
      var x1 = sx(d.value);
      svg += '<g class="c-row" data-label="' + esc(d.label) + '" data-value="' + d.value +
             '" data-pct="' + (total ? Math.round(d.value / total * 100) : 0) + '">';
      svg += '<text class="c-label" x="' + (labelW - 12) + '" y="' + (y + barH / 2 + 4) + '" text-anchor="end">' +
               esc(d.label.length > 26 ? d.label.slice(0, 25) + '…' : d.label) + '</text>';
      svg += '<path class="c-bar" d="' + barPath(plotX, x1, y, barH, 4) + '" fill="' + color + '"/>';
      svg += '<text class="c-value" x="' + (x1 + 8) + '" y="' + (y + barH / 2 + 4) + '">' + d.value + '</text>';
      svg += '<rect class="c-hit" x="0" y="' + y + '" width="' + vw + '" height="' + barH + '"/>';
      svg += '</g>';
    });

    svg += '</svg>';

    var table = '<details class="chart__table"><summary>View as table</summary>' +
      '<table><thead><tr><th scope="col">Category</th><th scope="col" class="num">' + esc(unit) + '</th>' +
      '<th scope="col" class="num">Share</th></tr></thead><tbody>' +
      data.map(function (d) {
        return '<tr><td>' + esc(d.label) + '</td><td class="num">' + d.value + '</td><td class="num">' +
          (total ? Math.round(d.value / total * 100) : 0) + '%</td></tr>';
      }).join('') +
      '</tbody></table></details>';

    return '<div class="card chart" data-chart data-unit="' + esc(unit) + '">' +
             '<h3 class="chart__title">' + esc(opts.title) + '</h3>' +
             (opts.subtitle ? '<p class="chart__sub">' + esc(opts.subtitle) + '</p>' : '') +
             svg + table +
           '</div>';
  }

  /**
   * columnChart(opts) — vertical bars for a short time series (months). Same
   * feature set as horizontalBars: one hue, direct value labels, a hover
   * tooltip and a table view, so it reads the same and stays accessible.
   *   opts.title, opts.subtitle, opts.unit
   *   opts.data  = [{ label, value }]
   *   opts.color = CSS custom-property name
   */
  function columnChart(opts) {
    var data = opts.data || [];
    var color = opts.color || 'var(--series-1)';
    var unit = opts.unit || '';

    var total = data.reduce(function (a, d) { return a + d.value; }, 0);
    var scale = scaleFor(Math.max.apply(null, data.map(function (d) { return d.value; }).concat([0])));
    var maxVal = scale.max;

    var padTop = 16, padBottom = 28, padLeft = 34, padRight = 10;
    var vw = 640, plotH = 150, vh = padTop + plotH + padBottom;
    var plotW = vw - padLeft - padRight;
    var n = data.length || 1, slot = plotW / n;
    var barW = Math.min(48, slot * 0.62);
    function sy(v) { return padTop + plotH - (maxVal ? (v / maxVal) * plotH : 0); }

    var svg = '<svg viewBox="0 0 ' + vw + ' ' + vh + '" role="img" aria-label="' +
      esc(opts.title + '. ' + data.map(function (d) { return d.label + ': ' + d.value; }).join('; ')) + '">';

    scale.ticks.forEach(function (t) {
      var y = sy(t);
      svg += '<line class="c-grid" x1="' + padLeft + '" y1="' + y + '" x2="' + (vw - padRight) + '" y2="' + y + '"/>';
      svg += '<text class="c-label" x="' + (padLeft - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + t + '</text>';
    });
    svg += '<line class="c-axis" x1="' + padLeft + '" y1="' + (padTop + plotH) + '" x2="' + (vw - padRight) + '" y2="' + (padTop + plotH) + '"/>';

    data.forEach(function (d, i) {
      var cx = padLeft + slot * i + slot / 2;
      var y = sy(d.value);
      var h = Math.max(0, (padTop + plotH) - y);
      var pct = total ? Math.round(d.value / total * 100) : 0;
      svg += '<g class="c-row" data-label="' + esc(d.label) + '" data-value="' + d.value + '" data-pct="' + pct + '">';
      svg += '<rect class="c-hit" x="' + (padLeft + slot * i) + '" y="' + padTop + '" width="' + slot + '" height="' + plotH + '"/>';
      svg += '<rect class="c-bar" x="' + (cx - barW / 2).toFixed(1) + '" y="' + y.toFixed(1) +
             '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + color + '"/>';
      if (d.value > 0) svg += '<text class="c-value" x="' + cx.toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle">' + d.value + '</text>';
      svg += '<text class="c-label" x="' + cx.toFixed(1) + '" y="' + (padTop + plotH + 16) + '" text-anchor="middle">' + esc(d.label) + '</text>';
      svg += '</g>';
    });
    svg += '</svg>';

    var table = '<details class="chart__table"><summary>View as table</summary>' +
      '<table><thead><tr><th scope="col">Period</th><th scope="col" class="num">' + esc(unit) + '</th></tr></thead><tbody>' +
      data.map(function (d) { return '<tr><td>' + esc(d.label) + '</td><td class="num">' + d.value + '</td></tr>'; }).join('') +
      '</tbody></table></details>';

    return '<div class="card chart" data-chart data-unit="' + esc(unit) + '">' +
             '<h3 class="chart__title">' + esc(opts.title) + '</h3>' +
             (opts.subtitle ? '<p class="chart__sub">' + esc(opts.subtitle) + '</p>' : '') +
             svg + table +
           '</div>';
  }

  /* Attach hover tooltips to every chart inside a container. */
  function bindTips(container) {
    container.querySelectorAll('[data-chart]').forEach(function (chart) {
      var unit = chart.getAttribute('data-unit') || '';
      chart.querySelectorAll('.c-row').forEach(function (row) {
        row.addEventListener('mousemove', function (e) {
          showTip(e, '<b>' + esc(row.getAttribute('data-label')) + '</b><br>' +
                     row.getAttribute('data-value') + ' ' + esc(unit) +
                     ' · ' + row.getAttribute('data-pct') + '%');
        });
        row.addEventListener('mouseleave', hideTip);
      });
    });
    container.addEventListener('scroll', hideTip, true);
  }

  function statTile(label, value, sub) {
    return '<div class="stat"><p class="stat__label">' + esc(label) + '</p>' +
           '<div class="stat__value">' + esc(value) + '</div>' +
           (sub ? '<p class="stat__sub">' + esc(sub) + '</p>' : '') + '</div>';
  }

  global.ESH.charts = { horizontalBars: horizontalBars, columnChart: columnChart, bindTips: bindTips, statTile: statTile, hideTip: hideTip };

})(window);
