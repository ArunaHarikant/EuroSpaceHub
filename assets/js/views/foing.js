/* ==========================================================================
   views/foing.js — the public-facing hub landing page: Prof. Bernard Foing's
   profile, research focus, outbound links, and a curated feed of his interns'
   approved research outputs.

   CONTENT NOTE: every credential on this page is limited to the publicly
   documented record supplied in the project brief. Nothing here is inferred
   or embellished, and there are no quotations.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth;
  var esc = ui.esc;

  /* Each focus area carries the library query it should filter by — the
     display label contains characters ("&") that would not match as search
     terms, so label and query are kept separate. */
  var FOCUS_TAGS = [
    { label: 'Lunar science & exploration', href: '#/library?area=Lunar' },
    { label: 'Mars science & exploration',  href: '#/library?area=Mars' },
    { label: 'Astrobiology',                href: '#/library?q=astrobiology' },
    { label: 'Planetary instrumentation',   href: '#/library?q=instrumentation' },
    { label: 'Analogue missions',           href: '#/library?type=' + encodeURIComponent('Analogue mission report') }
  ];

  /* Linked to the library only for members: an unauthenticated visitor would
     just be bounced to sign-in, so they get plain tags. */
  function focusTags() {
    var member = auth.isAuthenticated();
    return '<div class="tags">' + FOCUS_TAGS.map(function (t) {
      return member
        ? '<a class="tag" href="' + esc(t.href) + '">' + esc(t.label) + '</a>'
        : '<span class="tag">' + esc(t.label) + '</span>';
    }).join('') + '</div>';
  }

  var EXTERNAL_LINKS = [
    { label: 'ILEWG — International Lunar Exploration Working Group', url: 'https://sci.esa.int/web/ilewg',
      note: 'The working group Prof. Foing directs.' },
    { label: 'European Space Agency', url: 'https://www.esa.int/',
      note: 'ESA Research & Scientific Support Department.' },
    { label: 'International Space University', url: 'https://www.isunet.edu/',
      note: 'Partner institution for student placements.' },
    { label: 'Vrije Universiteit Amsterdam', url: 'https://vu.nl/en',
      note: 'Research professorship.' },
    { label: 'Florida Institute of Technology', url: 'https://www.fit.edu/',
      note: 'Research professorship.' }
  ];

  function portrait() {
    return '<div class="portrait" role="img" aria-label="Portrait placeholder for Prof. Bernard Foing">' +
      '<svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">' +
        '<circle cx="12" cy="8.5" r="4"/><path d="M3.5 21c0-4.4 3.8-7 8.5-7s8.5 2.6 8.5 7"/>' +
      '</svg>' +
      '<span>Portrait placeholder<br>(supply an approved photograph)</span></div>';
  }

  function hero() {
    return '' +
    '<section class="hero"><div class="wrap"><div class="hero__grid">' +
      '<div>' + portrait() + '</div>' +
      '<div>' +
        '<p class="eyebrow">EuroSpaceHub · Research Hub</p>' +
        '<h1>Prof. Bernard Foing — Lunar &amp; Mars Research Hub</h1>' +
        '<p class="lede">The working space for interns and student researchers <em>currently ' +
          'undertaking</em> a supervised research period with Prof. Bernard Foing, across ISU, ' +
          'ILEWG campaigns, VU Amsterdam and partner institutions. They hold a profile here, ' +
          'submit their lunar and Mars research outputs for review, and — once approved — share ' +
          'that work with the rest of the group. Access is restricted to members of the ' +
          'research group.</p>' +
        '<ul class="titles">' +
          '<li><strong>Executive Director</strong>, International Lunar Exploration Working Group (ILEWG)</li>' +
          '<li><strong>Senior Research Coordinator</strong>, ESA Research &amp; Scientific Support Department</li>' +
          '<li><strong>Principal Project Scientist</strong>, SMART-1 — ESA\'s first mission to the Moon</li>' +
          '<li><strong>Co-Investigator</strong>, Mars Express High Resolution Stereo Camera (HRSC)</li>' +
          '<li><strong>Research Professor</strong>, VU Amsterdam and Florida Institute of Technology</li>' +
        '</ul>' +
        /* Textual equivalent for the aria-hidden decorative backdrop. */
        '<p class="hero__caption">Backdrop: selected lunar and Mars missions.<br>' +
          '<span class="key key--esa">European (ESA)</span>' +
          '<span class="key key--nasa">United States (NASA)</span><br>' +
          'SMART-1 and Mars Express, drawn emphasised, are the two missions on which ' +
          'Prof. Foing served as Principal Project Scientist and co-investigator respectively.</p>' +
      '</div>' +
    '</div></div></section>';
  }

  function bio() {
    return '' +
    '<section class="section" id="biography">' +
      '<div class="section__head"><h2>Biography</h2></div>' +
      '<div class="split">' +
        '<div class="card">' +
          '<p>Prof. Bernard Foing holds a PhD in Astrophysics and Space Techniques. He has been ' +
            'a researcher with the Centre National de la Recherche Scientifique (CNRS) since 1986 ' +
            'and has worked at the European Space Agency since 1993, where he serves as Senior ' +
            'Research Coordinator in the Research and Scientific Support Department.</p>' +
          '<p>He was Principal Project Scientist for SMART-1, ESA\'s first mission to the Moon, and ' +
            'is a co-investigator on the High Resolution Stereo Camera aboard Mars Express. He is ' +
            'Executive Director of the International Lunar Exploration Working Group (ILEWG) and ' +
            'holds research professorships at VU Amsterdam and the Florida Institute of Technology.</p>' +
          '<p>His publication record comprises more than 400 articles, of which approximately 160 are ' +
            'refereed papers spanning lunar and planetary science, astrobiology, and solar-stellar ' +
            'physics. He has edited 16 books and organised more than 50 international conferences.</p>' +
          '<p class="meta">Biographical details are limited to the publicly documented record.</p>' +
        '</div>' +
        '<div>' +
          '<div class="card" style="margin-bottom:20px">' +
            '<h3>Research focus</h3>' +
            focusTags() +
            (auth.isAuthenticated()
              ? '<p class="field__hint" style="margin-top:12px">Select a focus area to filter the report library.</p>'
              : '') +
          '</div>' +
          '<div class="card">' +
            '<h3>Record at a glance</h3>' +
            '<dl class="dl">' +
              '<dt>Articles</dt><dd>400+</dd>' +
              '<dt>Refereed papers</dt><dd>approx. 160</dd>' +
              '<dt>Books edited</dt><dd>16</dd>' +
              '<dt>Conferences organised</dt><dd>50+</dd>' +
              '<dt>CNRS</dt><dd>since 1986</dd>' +
              '<dt>ESA</dt><dd>since 1993</dd>' +
            '</dl>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function links() {
    return '' +
    '<section class="section" id="links">' +
      '<div class="section__head"><h2>Affiliations &amp; external resources</h2></div>' +
      '<div class="grid grid--3">' +
        EXTERNAL_LINKS.map(function (l) {
          return '<a class="card" href="' + esc(l.url) + '" rel="noopener" style="text-decoration:none">' +
            '<h3 style="margin-bottom:4px">' + esc(l.label) + ' &rarr;</h3>' +
            '<p class="meta" style="margin:0">' + esc(l.note) + '</p></a>';
        }).join('') +
      '</div>' +
    '</section>';
  }

  /* The landing page is the only surface an unauthenticated visitor reaches.
     It carries Prof. Foing's own profile and nothing else: no report feed, no
     researcher roster, no counts. Members get their entry points instead. */
  function accessPanel() {
    if (auth.isSupervisor()) {
      return '' +
      '<section class="section"><div class="card">' +
        '<h2>Supervisor</h2>' +
        '<p class="lede">Every researcher, every submission and every review thread is in the dashboard.</p>' +
        '<div class="btn-row">' +
          '<a class="btn btn--primary" href="#/dashboard">Open the supervisor dashboard</a>' +
          '<a class="btn" href="#/library">Report library</a>' +
        '</div>' +
      '</div></section>';
    }
    if (auth.isIntern()) {
      return '' +
      '<section class="section"><div class="card">' +
        '<h2>Your work</h2>' +
        '<p class="lede">Submit a report, track it through review, and read the work your ' +
          'colleagues have had approved.</p>' +
        '<div class="btn-row">' +
          '<a class="btn btn--primary" href="#/submit">Submit a report</a>' +
          '<a class="btn" href="#/me">My profile</a>' +
          '<a class="btn" href="#/library">Report library</a>' +
        '</div>' +
      '</div></section>';
    }
    return '' +
    '<section class="section">' +
      '<div class="card" style="text-align:center">' +
        '<h2>This research hub is private</h2>' +
        '<p class="lede" style="margin-inline:auto">Research reports, the report library and ' +
          'researcher profiles are available only to interns currently working with ' +
          'Prof. Foing and to Prof. Foing himself. Nothing on this page is a public archive, ' +
          'and no submitted work is published outside the group.</p>' +
        '<p class="lede" style="margin-inline:auto">Already placed with Prof. Foing? Sign in, or ' +
          'create your researcher account. This hub is not an application route — placements are ' +
          'arranged separately.</p>' +
        '<div class="btn-row" style="justify-content:center">' +
          '<a class="btn btn--primary" href="#/signin">Sign in</a>' +
          '<a class="btn" href="#/register">Create a researcher account</a>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function render(ctx) {
    ctx.el.innerHTML = hero() +
      '<div class="wrap">' + accessPanel() + bio() + links() + '</div>';
  }

  ESH.views = ESH.views || {};
  ESH.views.foing = render;

})(window);
