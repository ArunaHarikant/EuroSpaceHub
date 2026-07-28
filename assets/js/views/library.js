/* ==========================================================================
   views/library.js — the shared report library. MEMBERS ONLY.

   ACCESS: route-guarded to authenticated users and re-checked here through
   auth.can('library:view'). The listing is built from store.releasedReports()
   — the Approved + Published set the supervisor has cleared for sharing — and
   NOT from auth.visibleReports(), so an unreleased record cannot reach this
   page through a permission bug: it was never in the result set. A member's
   own drafts live on their profile; the supervisor's all-states view is the
   dashboard.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth, router = ESH.router;
  var esc = ui.esc;

  function matches(r, f) {
    if (f.area && f.area !== 'all' && r.missionArea !== f.area) return false;
    if (f.type && f.type !== 'all' && r.reportType !== f.type) return false;
    if (f.author && f.author !== 'all' && r.ownerId !== f.author) return false;
    if (f.year && f.year !== 'all' && ui.year(r.submittedAt || r.createdAt) !== f.year) return false;
    if (f.q) {
      var hay = [r.title, r.abstract, store.authorLine(r), (r.keywords || []).join(' '),
                 r.reportType, r.missionArea].join(' ').toLowerCase();
      var terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) === -1) return false;
    }
    return true;
  }

  function sortReports(list, sort) {
    var out = list.slice();
    switch (sort) {
      case 'oldest': out.sort(function (a, b) { return date(a) - date(b); }); break;
      case 'title':  out.sort(function (a, b) { return a.title.localeCompare(b.title); }); break;
      case 'author': out.sort(function (a, b) { return store.authorLine(a).localeCompare(store.authorLine(b)); }); break;
      default:       out.sort(function (a, b) {
                       if (a.featured !== b.featured) return a.featured ? -1 : 1;
                       return date(b) - date(a);
                     });
    }
    return out;
  }
  function date(r) { return new Date(r.submittedAt || r.createdAt).getTime(); }

  function render(ctx) {
    if (!auth.can('library:view', null, auth.user())) { router.navigate('#/signin', true); return; }

    var all = store.releasedReports();

    var f = {
      area:   ctx.query.area   || 'all',
      type:   ctx.query.type   || 'all',
      author: ctx.query.author || 'all',
      year:   ctx.query.year   || 'all',
      q:      ctx.query.q      || '',
      sort:   ctx.query.sort   || 'recent'
    };

    var years = {};
    all.forEach(function (r) { years[ui.year(r.submittedAt || r.createdAt)] = 1; });
    var yearList = Object.keys(years).sort().reverse();

    var authorIds = {};
    all.forEach(function (r) { authorIds[r.ownerId] = 1; });
    var authors = Object.keys(authorIds).map(function (id) {
      var u = store.userById(id);
      return { value: id, label: u ? u.fullName : 'Unknown' };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });

    var results = sortReports(all.filter(function (r) { return matches(r, f); }), f.sort);

    var supHint = auth.isSupervisor()
      ? ui.notice('info', 'You are viewing the shared library',
          'This page shows only Approved and Published records — what the rest of the group can see. ' +
          'To see drafts and items under review, open the <a href="#/dashboard">supervisor dashboard</a>.')
      : '';

    ctx.el.innerHTML =
    '<div class="wrap">' +
      '<p class="eyebrow">Members only</p>' +
      '<h1>Report library</h1>' +
      '<p class="lede">Research outputs approved by Prof. Bernard Foing and shared with the ' +
        'research group. Visible only to signed-in members — this library is not published ' +
        'outside the group. Drafts, submissions under review and internal review ' +
        'correspondence are not listed here.</p>' +
      supHint +

      '<form class="filters" id="libFilters" role="search" aria-label="Filter the report library">' +
        '<div class="field filters__search">' +
          '<label for="fq">Search</label>' +
          '<input type="search" id="fq" name="q" placeholder="Title, abstract, author, keyword…" value="' + esc(f.q) + '">' +
        '</div>' +
        '<div class="field"><label for="farea">Mission area</label><select id="farea" name="area">' +
          '<option value="all">All areas</option>' + ui.selectOptions(store.MISSION_AREAS, f.area) + '</select></div>' +
        '<div class="field"><label for="ftype">Report type</label><select id="ftype" name="type">' +
          '<option value="all">All types</option>' + ui.selectOptions(store.REPORT_TYPES, f.type) + '</select></div>' +
        '<div class="field"><label for="fauthor">Author</label><select id="fauthor" name="author">' +
          '<option value="all">All authors</option>' + ui.selectOptions(authors, f.author) + '</select></div>' +
        '<div class="field"><label for="fyear">Year</label><select id="fyear" name="year">' +
          '<option value="all">All years</option>' + ui.selectOptions(yearList, f.year) + '</select></div>' +
        '<div class="field"><label for="fsort">Sort</label><select id="fsort" name="sort">' +
          ui.selectOptions([
            { value: 'recent', label: 'Featured, then newest' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'title',  label: 'Title A–Z' },
            { value: 'author', label: 'Author A–Z' }
          ], f.sort) + '</select></div>' +
        '<div class="filters__reset"><button class="btn btn--sm btn--ghost" type="button" id="fReset">Clear filters</button></div>' +
      '</form>' +

      '<p class="meta" role="status" style="margin-bottom:14px">' +
        'Showing <strong>' + results.length + '</strong> of ' + all.length + ' shared record' +
        (all.length === 1 ? '' : 's') + '.</p>' +

      (results.length
        ? '<div class="grid grid--2">' + results.map(function (r) { return ui.reportCard(r); }).join('') + '</div>'
        : ui.empty('No records match these filters', 'Try widening the mission area, type or year, or clearing the search box.')) +
    '</div>';

    var form = document.getElementById('libFilters');
    function apply() {
      var data = {
        q: form.elements.q.value.trim(), area: form.elements.area.value, type: form.elements.type.value,
        author: form.elements.author.value, year: form.elements.year.value,
        sort: form.elements.sort.value === 'recent' ? '' : form.elements.sort.value
      };
      router.navigate('#/library' + router.buildQuery(data));
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); apply(); });
    ['area','type','author','year','sort'].forEach(function (n) {
      form.elements[n].addEventListener('change', apply);
    });
    var t;
    form.elements.q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(apply, 320); });
    document.getElementById('fReset').addEventListener('click', function () { router.navigate('#/library'); });
  }

  ESH.views = ESH.views || {};
  ESH.views.library = render;

})(window);
