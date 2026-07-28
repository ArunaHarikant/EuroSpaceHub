/* ==========================================================================
   backdrop.js — decorative mission backdrop rendered as inline SVG.

   Depicts European (ESA) and United States (NASA) lunar and Mars missions:
   orbiters ride orbit rings around the Moon and Mars, surface missions are
   marked on the discs. The two missions Prof. Foing is personally associated
   with — SMART-1 and Mars Express — are drawn emphasised.

   Every mission named here is a real, publicly documented ESA or NASA
   mission. Nothing is invented; planned missions are labelled as such in the
   MISSIONS table below and drawn in a dimmer weight.

   ACCESSIBILITY: the layer is purely decorative and is marked aria-hidden.
   The hero carries a visible caption naming what the backdrop shows, so the
   information is not conveyed by the artwork alone. It is hidden entirely in
   print and under forced-colors.

   Two variants:
     'full'    — the landing page: bodies, orbit rings, mission labels
     'ambient' — every other route: starfield and two faint limbs only, so
                 dense views (dashboard tables, forms) stay uncluttered
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH;
  var esc = ESH.ui.esc;

  var VW = 1600, VH = 900;

  /* ---------------- mission data (real missions only) ---------------- */

  var MISSIONS = {
    /* Lunar orbiters — innermost ring first */
    lunarOrbit: [
      { name: 'SMART-1',                       agency: 'esa',  foing: true },
      { name: 'Lunar Reconnaissance Orbiter',  agency: 'nasa', short: 'LRO' },
      { name: 'GRAIL',                         agency: 'nasa' }
    ],
    /* Lunar surface missions */
    lunarSurface: [
      { name: 'Apollo',   agency: 'nasa' },
      { name: 'Artemis',  agency: 'nasa', planned: true }
    ],
    /* Mars orbiters — innermost ring first */
    marsOrbit: [
      { name: 'Mars Express',                 agency: 'esa',  foing: true },
      { name: 'ExoMars Trace Gas Orbiter',    agency: 'esa',  short: 'ExoMars TGO' },
      { name: 'Mars Reconnaissance Orbiter',  agency: 'nasa', short: 'MRO' },
      { name: 'MAVEN',                        agency: 'nasa' }
    ],
    /* Mars surface missions */
    marsSurface: [
      { name: 'Viking',           agency: 'nasa' },
      { name: 'Mars Pathfinder',  agency: 'nasa' },
      { name: 'Curiosity',        agency: 'nasa' },
      { name: 'Perseverance',     agency: 'nasa' },
      { name: 'Rosalind Franklin',agency: 'esa', planned: true }
    ]
  };

  /* ---------------- deterministic starfield ---------------- */

  function lcg(seed) {
    var s = seed;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  var STARS = (function () {
    var rnd = lcg(20260728), out = [], i;
    for (i = 0; i < 130; i++) {
      out.push({
        x: +(rnd() * VW).toFixed(1),
        y: +(rnd() * VH).toFixed(1),
        r: +(0.6 + rnd() * 1.5).toFixed(2),
        o: +(0.12 + rnd() * 0.45).toFixed(2)
      });
    }
    return out;
  })();

  function starfield(scale) {
    return '<g class="bd-stars">' + STARS.map(function (s) {
      return '<circle cx="' + s.x + '" cy="' + s.y + '" r="' + s.r +
             '" opacity="' + (s.o * scale).toFixed(2) + '"/>';
    }).join('') + '</g>';
  }

  /* ---------------- geometry helpers ---------------- */

  /* An ellipse as a path, so text can be set along it with <textPath>. */
  function ellipsePath(cx, cy, rx, ry) {
    return 'M' + (cx - rx) + ',' + cy +
           'a' + rx + ',' + ry + ' 0 1,0 ' + (2 * rx) + ',0' +
           'a' + rx + ',' + ry + ' 0 1,0 ' + (-2 * rx) + ',0';
  }

  /* Point at parametric angle t on an ellipse rotated by `rot` degrees. */
  function onEllipse(cx, cy, rx, ry, rot, t) {
    var c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180);
    var x = rx * Math.cos(t), y = ry * Math.sin(t);
    return { x: cx + x * c - y * s, y: cy + x * s + y * c };
  }

  /* A small orbiter glyph: bus plus two solar wings. */
  function orbiter(x, y, cls, angle) {
    return '<g class="' + cls + '" transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) +
           ') rotate(' + (angle || 0).toFixed(1) + ')">' +
             '<rect x="-3.5" y="-3" width="7" height="6" rx="1.5"/>' +
             '<rect x="-11" y="-1.6" width="6" height="3.2" rx="0.8" opacity=".75"/>' +
             '<rect x="5" y="-1.6" width="6" height="3.2" rx="0.8" opacity=".75"/>' +
           '</g>';
  }

  /* A lander/rover marker on a disc: dot, leader line, label. */
  function surfaceMark(cx, cy, r, angleDeg, m, side) {
    var a = angleDeg * Math.PI / 180;
    var px = cx + Math.cos(a) * r * 0.82;
    var py = cy + Math.sin(a) * r * 0.82;
    var lx = cx + Math.cos(a) * (r + 46);
    var ly = cy + Math.sin(a) * (r + 46);
    var cls = 'bd-' + m.agency + (m.planned ? ' bd-planned' : '');
    return '<g class="' + cls + '">' +
      '<circle class="bd-mark" cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="2.6"/>' +
      '<line class="bd-leader" x1="' + px.toFixed(1) + '" y1="' + py.toFixed(1) +
        '" x2="' + lx.toFixed(1) + '" y2="' + ly.toFixed(1) + '"/>' +
      '<text class="bd-label" x="' + (lx + (side === 'end' ? -6 : 6)).toFixed(1) + '" y="' + (ly + 3.5).toFixed(1) +
        '" text-anchor="' + (side === 'end' ? 'end' : 'start') + '">' + esc((m.short || m.name).toUpperCase()) + '</text>' +
    '</g>';
  }

  /* ---------------- bodies ---------------- */

  function moon(cx, cy, r) {
    var craters = [
      [-0.34, -0.30, 0.17], [0.26, -0.16, 0.11], [-0.10, 0.30, 0.13],
      [0.38, 0.34, 0.08], [-0.52, 0.14, 0.07], [0.06, -0.48, 0.06],
      [0.50, -0.42, 0.05], [-0.28, 0.58, 0.05]
    ];
    return '<g class="bd-body">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="url(#bdMoon)"/>' +
      craters.map(function (c) {
        return '<circle class="bd-crater" cx="' + (cx + c[0] * r).toFixed(1) + '" cy="' + (cy + c[1] * r).toFixed(1) +
               '" r="' + (c[2] * r).toFixed(1) + '"/>';
      }).join('') +
      '<circle class="bd-limb" cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>' +
    '</g>';
  }

  function mars(cx, cy, r) {
    return '<g class="bd-body">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="url(#bdMars)"/>' +
      /* albedo shading and a polar cap — suggestive, not cartographic */
      '<ellipse class="bd-albedo" cx="' + (cx - r * 0.18).toFixed(1) + '" cy="' + (cy + r * 0.10).toFixed(1) +
        '" rx="' + (r * 0.52).toFixed(1) + '" ry="' + (r * 0.30).toFixed(1) + '" transform="rotate(-14 ' + cx + ' ' + cy + ')"/>' +
      '<ellipse class="bd-albedo" cx="' + (cx + r * 0.34).toFixed(1) + '" cy="' + (cy - r * 0.34).toFixed(1) +
        '" rx="' + (r * 0.26).toFixed(1) + '" ry="' + (r * 0.15).toFixed(1) + '"/>' +
      '<ellipse class="bd-cap" cx="' + cx + '" cy="' + (cy - r * 0.86).toFixed(1) +
        '" rx="' + (r * 0.34).toFixed(1) + '" ry="' + (r * 0.13).toFixed(1) + '"/>' +
      '<circle class="bd-limb" cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>' +
    '</g>';
  }

  /* ---------------- orbit rings carrying mission names ---------------- */

  function orbitSystem(id, cx, cy, baseRx, baseRy, rot, step, list, startOffsets, labelOffsets) {
    var out = '';
    list.forEach(function (m, i) {
      var rx = baseRx + i * step, ry = baseRy + i * step * 0.42;
      var pid = id + '_' + i;
      var cls = 'bd-' + m.agency + (m.planned ? ' bd-planned' : '') + (m.foing ? ' bd-foing' : '');
      var t = (startOffsets && startOffsets[i] !== undefined) ? startOffsets[i] : (0.6 + i * 0.9);
      var p = onEllipse(cx, cy, rx, ry, rot, t);
      /* tangent direction, for pointing the glyph along its track */
      var q = onEllipse(cx, cy, rx, ry, rot, t + 0.05);
      var ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;

      /* Keep every label on the first half of the path: on the far half a
         <textPath> runs right-to-left and the glyphs render mirrored. */
      var defaults = [3, 15, 27, 38];
      var off = (labelOffsets && labelOffsets[i] !== undefined) ? labelOffsets[i]
              : (defaults[i] !== undefined ? defaults[i] : 3);
      out += '<g class="' + cls + '" transform="rotate(' + rot + ' ' + cx + ' ' + cy + ')">' +
               '<path id="' + pid + '" class="bd-orbit" d="' + ellipsePath(cx, cy, rx, ry) + '"/>' +
               '<text class="bd-label"><textPath href="#' + pid + '" startOffset="' + off + '%">' +
                 esc((m.short || m.name).toUpperCase()) + '</textPath></text>' +
             '</g>';
      out += orbiter(p.x, p.y, cls + ' bd-craft', ang);
    });
    return out;
  }

  /* ---------------- variants ---------------- */

  function defs() {
    return '<defs>' +
      '<radialGradient id="bdMoon" cx="34%" cy="30%" r="80%">' +
        '<stop offset="0%" stop-color="#46536f"/><stop offset="58%" stop-color="#2a344c"/>' +
        '<stop offset="100%" stop-color="#151d2f"/></radialGradient>' +
      '<radialGradient id="bdMars" cx="34%" cy="30%" r="80%">' +
        '<stop offset="0%" stop-color="#8d5031"/><stop offset="58%" stop-color="#573020"/>' +
        '<stop offset="100%" stop-color="#2a1a14"/></radialGradient>' +
    '</defs>';
  }

  function full() {
    /* Kept to the lower-left and upper-right corners so the centre column,
       where the hero copy sits, stays clear. */
    var moonC = { x: 216, y: 716, r: 168 };
    var marsC = { x: 1398, y: 300, r: 128 };

    return '<svg class="bd-svg" viewBox="0 0 ' + VW + ' ' + VH + '" preserveAspectRatio="xMidYMid slice" ' +
           'aria-hidden="true" focusable="false">' +
      defs() +
      starfield(1) +

      /* ---- Moon system, lower left ---- */
      orbitSystem('bdL', moonC.x, moonC.y, 262, 110, -16, 58, MISSIONS.lunarOrbit, [0.5, 2.3, 4.1], [31, 41, 21]) +
      moon(moonC.x, moonC.y, moonC.r) +
      surfaceMark(moonC.x, moonC.y, moonC.r, -58, MISSIONS.lunarSurface[0], 'start') +
      surfaceMark(moonC.x, moonC.y, moonC.r, -14, MISSIONS.lunarSurface[1], 'start') +

      /* ---- Mars system, upper right ---- */
      orbitSystem('bdM', marsC.x, marsC.y, 204, 84, 13, 50, MISSIONS.marsOrbit, [3.5, 2.1, 0.4, 4.6]) +
      mars(marsC.x, marsC.y, marsC.r) +
      surfaceMark(marsC.x, marsC.y, marsC.r, 168, MISSIONS.marsSurface[0], 'end') +
      surfaceMark(marsC.x, marsC.y, marsC.r, 140, MISSIONS.marsSurface[2], 'end') +
      surfaceMark(marsC.x, marsC.y, marsC.r, 112, MISSIONS.marsSurface[3], 'end') +
      surfaceMark(marsC.x, marsC.y, marsC.r, 84,  MISSIONS.marsSurface[4], 'end') +
    '</svg>';
  }

  function ambient() {
    return '<svg class="bd-svg bd-svg--ambient" viewBox="0 0 ' + VW + ' ' + VH + '" ' +
           'preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
      defs() +
      starfield(0.62) +
      '<g opacity=".55">' + moon(112, 858, 172) + '</g>' +
      '<g opacity=".45">' + mars(1516, 92, 128) + '</g>' +
    '</svg>';
  }

  /* ---------------- public API ---------------- */

  var currentVariant = null;

  function render(variant) {
    var host = document.getElementById('backdrop');
    if (!host) return;
    if (variant === currentVariant) return;      /* avoid needless re-paint */
    currentVariant = variant;
    host.className = 'backdrop backdrop--' + variant;
    host.innerHTML = variant === 'full' ? full() : ambient();
  }

  ESH.backdrop = { render: render, MISSIONS: MISSIONS };

})(window);
