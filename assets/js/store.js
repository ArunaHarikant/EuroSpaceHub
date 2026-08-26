/* ==========================================================================
   store.js — data model, seed content and persistence.

   PERSISTENCE: browser localStorage. There is no server in this build.
   Everything here runs in the visitor's own browser and is therefore fully
   readable and writable by that visitor. See README.md § Access control.

   Uploaded files are NOT written to localStorage (quota is ~5 MB and PDFs
   would exhaust it immediately). Only file *metadata* is persisted; the
   binary lives in an in-memory blob registry for the current tab session.
   ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'esh.foinghub.v1';
  var SESSION_KEY = 'esh.foinghub.session.v1';

  /* ---------------- controlled vocabulary ----------------
     Defined once in shared/policy.js, which the Node server requires from the
     same file. Re-exported here so existing call sites (store.STATUSES, …)
     keep working, but this module is no longer a second source of truth. */

  var P = global.ESHPolicy;
  if (!P) throw new Error('shared/policy.js must load before assets/js/store.js');

  var MISSION_AREAS  = P.MISSION_AREAS;
  var REPORT_TYPES   = P.REPORT_TYPES;
  var STATUSES       = P.STATUSES;
  var STATUS_ORDER   = P.STATUS_ORDER;
  var TRANSITIONS    = P.TRANSITIONS;
  var STANDING       = P.STANDING;
  var ACCEPTED_FILES = P.ACCEPTED_FILES;
  /* Suggested (not enforced) canonical institutions. Free text is still
     accepted; these drive the datalists and canonicalInstitution() so the same
     place isn't spelled three ways across the roster and filters. */
  var INSTITUTIONS = [
    'International Space University',
    'Vrije Universiteit Amsterdam',
    'Florida Institute of Technology',
    'ISAE-SUPAERO',
    'Delft University of Technology',
    'Technical University of Munich',
    'University of Strathclyde'
  ];
  var INSTITUTION_ALIASES = {
    'isu': 'International Space University',
    'vu': 'Vrije Universiteit Amsterdam',
    'vu amsterdam': 'Vrije Universiteit Amsterdam',
    'fit': 'Florida Institute of Technology',
    'florida tech': 'Florida Institute of Technology',
    'tu delft': 'Delft University of Technology',
    'tum': 'Technical University of Munich'
  };

  /* Optional campaign / programme a report belongs to — a lightweight grouping,
     not a first-class entity. Example labels drawn from Prof. Foing's real
     ILEWG context; the field is free text and never enforced. */
  var CAMPAIGNS = [
    'EuroMoonMars',
    'ILEWG analogue field campaign',
    'ExoGeoLab',
    'Lunar south-pole study',
    'Mars analogue programme'
  ];

  /* ---------------- ids, dates, misc ---------------- */

  var seq = 0;
  function uid(prefix) {
    seq += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + seq.toString(36) +
           Math.random().toString(36).slice(2, 6);
  }
  function nowISO() { return new Date().toISOString(); }
  function daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(9, 30, 0, 0);
    return d.toISOString();
  }
  function isoDate(iso) { return (iso || '').slice(0, 10); }

  /* ---------------- in-memory blob registry (session only) ---------------- */

  var blobs = {};   /* fileId -> { url, blob } */

  function putBlob(file) {
    var id = uid('file');
    blobs[id] = { url: URL.createObjectURL(file), name: file.name };
    return {
      id: id,
      name: file.name,
      size: file.size,
      type: file.type || '',
      uploadedAt: nowISO(),
      inSession: true          /* recomputed on read; see fileHandle() */
    };
  }
  function fileHandle(meta) {
    if (!meta) return null;
    var b = blobs[meta.id];
    return { meta: meta, url: b ? b.url : null, available: !!b };
  }

  /* ==========================================================================
     SEED DATA
     Placeholder people and placeholder reports only. No real intern names and
     no real unpublished research are represented here. Prof. Foing's record
     uses only publicly documented affiliations supplied in the project brief.
     ========================================================================== */

  var SUPERVISOR_ID = 'u_foing';

  function seedUsers() {
    return [
      {
        id: SUPERVISOR_ID,
        role: 'supervisor',
        primarySupervisor: true,
        fullName: 'Prof. Bernard Foing',
        email: 'supervisor@demo.eurospacehub.local',
        password: 'demo',
        institution: 'ILEWG / ESA / VU Amsterdam / Florida Institute of Technology',
        programme: '—',
        supervisorId: null,
        startDate: '', endDate: '',
        researchTopic: 'Lunar and Mars exploration, astrobiology, planetary instrumentation, analogue missions',
        keywords: ['Lunar science & exploration','Mars science & exploration','Astrobiology','Planetary instrumentation','Analogue missions'],
        bio: '',
        photoUrl: '',
        links: { linkedin: '', orcid: '', website: 'https://sci.esa.int/web/ilewg' },
        standing: 'active',
        internalNotes: '',
        createdAt: daysAgo(400)
      },
      {
        id: 'u_cosup',
        role: 'supervisor',
        primarySupervisor: false,
        fullName: 'Co-Supervisor Name',
        email: 'cosupervisor@demo.eurospacehub.local',
        password: 'demo',
        institution: 'Partner Institution',
        programme: '—',
        supervisorId: null,
        startDate: '', endDate: '',
        researchTopic: 'Placeholder co-supervisor account',
        keywords: [],
        bio: 'Placeholder account demonstrating that the supervisor role is extensible to co-supervisors designated by Prof. Foing.',
        photoUrl: '',
        links: { linkedin: '', orcid: '', website: '' },
        standing: 'active',
        internalNotes: '',
        createdAt: daysAgo(300)
      },
      mkIntern('u_i1', 'Intern Name A', 'intern.a@demo.eurospacehub.local',
        'International Space University', 'MSc Space Studies',
        'Lunar regolith geotechnics', ['regolith','ISRU','south pole'], 210, 30, 'active',
        'Placeholder internal note: on track; strong analytical work.'),
      mkIntern('u_i2', 'Intern Name B', 'intern.b@demo.eurospacehub.local',
        'Vrije Universiteit Amsterdam', 'MSc Earth Sciences',
        'Mars surface spectroscopy', ['HRSC','spectroscopy','stratigraphy'], 180, 15, 'active',
        'Placeholder internal note: requested extension to research period.'),
      mkIntern('u_i3', 'Intern Name C', 'intern.c@demo.eurospacehub.local',
        'Florida Institute of Technology', 'BSc Astrobiology',
        'Analogue habitat life-support monitoring', ['analogue','habitat','life support'], 150, -45, 'active', ''),
      mkIntern('u_i4', 'Intern Name D', 'intern.d@demo.eurospacehub.local',
        'International Space University', 'SSP Participant',
        'Lunar polar volatiles', ['volatiles','permanently shadowed regions'], 520, 340, 'alumnus',
        'Placeholder internal note: completed placement; alumnus.'),
      mkIntern('u_i5', 'Intern Name E', 'intern.e@demo.eurospacehub.local',
        'Partner University', 'MSc Aerospace Engineering',
        'Planetary instrumentation calibration', ['instrumentation','calibration'], 95, -120, 'inactive', '')
    ];
  }

  function mkIntern(id, name, email, institution, programme, topic, kw, startedDaysAgo, endsInDays, standing, note) {
    var end = new Date();
    end.setDate(end.getDate() + endsInDays);
    return {
      id: id,
      role: 'intern',
      fullName: name,
      email: email,
      password: 'demo',
      institution: institution,
      programme: programme,
      supervisorId: SUPERVISOR_ID,
      startDate: isoDate(daysAgo(startedDaysAgo)),
      endDate: isoDate(end.toISOString()),
      researchTopic: topic,
      keywords: kw,
      bio: 'Placeholder biography for ' + name + '. Research period supervised by Prof. Bernard Foing.',
      photoUrl: '',
      links: { linkedin: '', orcid: '', website: '' },
      standing: standing,
      internalNotes: note || '',
      createdAt: daysAgo(startedDaysAgo)
    };
  }

  function mkReport(o) {
    return {
      id: o.id,
      ownerId: o.ownerId,
      title: o.title,
      missionArea: o.missionArea,
      reportType: o.reportType,
      campaign: o.campaign || '',            /* optional grouping label */
      abstract: o.abstract,
      keywords: o.keywords || [],
      coAuthors: o.coAuthors || [],          /* [{ name, userId|null }] */
      file: o.file || null,                  /* metadata only in seed data */
      supplementary: o.supplementary || [],  /* [{ label, url }] */
      dataAvailability: o.dataAvailability || '',
      status: o.status,
      featured: !!o.featured,
      createdAt: o.createdAt,
      submittedAt: o.submittedAt || null,
      updatedAt: o.updatedAt || o.createdAt,
      history: o.history || [],
      comments: o.comments || []
    };
  }

  function seedReports() {
    var demoFile = function (n) { return { id: 'seedfile_' + n, name: n, size: 0, type: 'application/pdf', uploadedAt: daysAgo(60), seed: true }; };

    return [
      mkReport({
        id: 'r_1', ownerId: 'u_i1',
        title: 'Sample Lunar Regolith Report — Geotechnical Characterisation of South-Polar Simulants',
        missionArea: 'Lunar', reportType: 'Research paper', campaign: 'EuroMoonMars',
        abstract: 'Placeholder abstract. This sample record demonstrates how an approved research paper appears in the public library. It describes a notional laboratory campaign characterising the shear strength and compaction behaviour of lunar highland regolith simulants under reduced-pressure conditions, and discusses implications for in-situ resource utilisation and surface mobility at the lunar south pole. All content is placeholder text for demonstration purposes and does not represent real research findings.',
        keywords: ['regolith','ISRU','geotechnics','south pole'],
        coAuthors: [{ name: 'Intern Name D', userId: 'u_i4' }, { name: 'External Collaborator', userId: null }],
        file: demoFile('sample-lunar-regolith-report.pdf'),
        dataAvailability: 'Placeholder statement: derived datasets would be deposited in an institutional repository under an open licence.',
        status: 'published', featured: true,
        createdAt: daysAgo(96), submittedAt: daysAgo(90), updatedAt: daysAgo(58),
        history: [
          h(daysAgo(96), 'u_i1', null, 'draft', 'Record created.'),
          h(daysAgo(90), 'u_i1', 'draft', 'submitted', 'Submitted for supervisor review.'),
          h(daysAgo(84), SUPERVISOR_ID, 'submitted', 'review', 'Opened for review.'),
          h(daysAgo(76), SUPERVISOR_ID, 'review', 'revisions', 'Revisions requested — see review comments.'),
          h(daysAgo(68), 'u_i1', 'revisions', 'submitted', 'Revised version resubmitted.'),
          h(daysAgo(62), SUPERVISOR_ID, 'submitted', 'approved', 'Approved.'),
          h(daysAgo(58), SUPERVISOR_ID, 'approved', 'published', 'Published to the public library.')
        ],
        comments: [
          c('c_1', SUPERVISOR_ID, daysAgo(76), 'Placeholder review comment: please expand the discussion of simulant fidelity and state the confidence intervals on the shear-strength results.', null, false),
          c('c_2', 'u_i1', daysAgo(70), 'Placeholder reply: revised section 4 accordingly and added the confidence intervals to Table 2.', 'c_1', false),
          c('c_3', SUPERVISOR_ID, daysAgo(62), 'Placeholder internal note (supervisor only): suitable candidate for the next ILEWG session.', null, true)
        ]
      }),
      mkReport({
        id: 'r_2', ownerId: 'u_i2',
        title: 'Sample Mars Report — Stereo-Derived Topography of a Placeholder Crater Region',
        missionArea: 'Mars', reportType: 'Technical report', campaign: 'Mars analogue programme',
        abstract: 'Placeholder abstract. This sample technical report illustrates a Mars-focused submission. It outlines a notional workflow for deriving digital terrain models from high-resolution stereo imagery, quantifying vertical uncertainty, and comparing the result against an independent laser-altimetry reference. Content is placeholder text and does not represent real results.',
        keywords: ['HRSC','topography','DTM','stereo photogrammetry'],
        coAuthors: [],
        file: demoFile('sample-mars-topography-report.pdf'),
        dataAvailability: 'Placeholder statement: input imagery is publicly archived; derived products available on request.',
        status: 'published', featured: true,
        createdAt: daysAgo(70), submittedAt: daysAgo(64), updatedAt: daysAgo(34),
        history: [
          h(daysAgo(70), 'u_i2', null, 'draft', 'Record created.'),
          h(daysAgo(64), 'u_i2', 'draft', 'submitted', 'Submitted for supervisor review.'),
          h(daysAgo(56), SUPERVISOR_ID, 'submitted', 'review', 'Opened for review.'),
          h(daysAgo(41), SUPERVISOR_ID, 'review', 'approved', 'Approved.'),
          h(daysAgo(34), SUPERVISOR_ID, 'approved', 'published', 'Published to the public library.')
        ],
        comments: [ c('c_4', SUPERVISOR_ID, daysAgo(48), 'Placeholder review comment: please state the co-registration method used for the altimetry comparison.', null, false) ]
      }),
      mkReport({
        id: 'r_3', ownerId: 'u_i3',
        title: 'Sample Analogue Mission Report — Placeholder Habitat Campaign, Environmental Monitoring',
        missionArea: 'Both', reportType: 'Analogue mission report', campaign: 'EuroMoonMars',
        abstract: 'Placeholder abstract. A sample analogue-mission record covering environmental and life-support monitoring during a notional two-week isolated-habitat campaign, with lessons applicable to both lunar and Martian surface operations. Content is placeholder text for demonstration only.',
        keywords: ['analogue','habitat','life support','human factors'],
        coAuthors: [{ name: 'Intern Name A', userId: 'u_i1' }],
        file: demoFile('sample-analogue-campaign-report.pdf'),
        status: 'approved', featured: false,
        createdAt: daysAgo(44), submittedAt: daysAgo(38), updatedAt: daysAgo(12),
        history: [
          h(daysAgo(44), 'u_i3', null, 'draft', 'Record created.'),
          h(daysAgo(38), 'u_i3', 'draft', 'submitted', 'Submitted for supervisor review.'),
          h(daysAgo(26), SUPERVISOR_ID, 'submitted', 'review', 'Opened for review.'),
          h(daysAgo(12), SUPERVISOR_ID, 'review', 'approved', 'Approved; publication pending final file check.')
        ],
        comments: []
      }),
      mkReport({
        id: 'r_4', ownerId: 'u_i4',
        title: 'Sample Poster — Placeholder Survey of Lunar Polar Volatile Indicators',
        missionArea: 'Lunar', reportType: 'Poster',
        abstract: 'Placeholder abstract for a conference poster record. Summarises a notional literature survey of remote-sensing indicators for volatile deposits in permanently shadowed regions. Placeholder content only.',
        keywords: ['volatiles','PSR','remote sensing'],
        coAuthors: [],
        file: demoFile('sample-polar-volatiles-poster.pdf'),
        status: 'published', featured: false,
        createdAt: daysAgo(300), submittedAt: daysAgo(292), updatedAt: daysAgo(270),
        history: [
          h(daysAgo(300), 'u_i4', null, 'draft', 'Record created.'),
          h(daysAgo(292), 'u_i4', 'draft', 'submitted', 'Submitted for supervisor review.'),
          h(daysAgo(281), SUPERVISOR_ID, 'submitted', 'approved', 'Approved.'),
          h(daysAgo(270), SUPERVISOR_ID, 'approved', 'published', 'Published to the public library.')
        ],
        comments: []
      }),
      mkReport({
        id: 'r_5', ownerId: 'u_i2',
        title: 'Sample Dataset Description — Placeholder Spectral Reference Library',
        missionArea: 'Mars', reportType: 'Dataset + description',
        abstract: 'Placeholder abstract describing a notional laboratory spectral reference library assembled for comparison against orbital observations. Includes acquisition parameters, calibration approach and file organisation. Placeholder content only.',
        keywords: ['spectroscopy','dataset','calibration'],
        coAuthors: [],
        file: demoFile('sample-spectral-library-description.pdf'),
        dataAvailability: 'Placeholder statement: dataset deposited under CC BY 4.0 in a public repository.',
        status: 'review', featured: false,
        createdAt: daysAgo(26), submittedAt: daysAgo(20), updatedAt: daysAgo(9),
        history: [
          h(daysAgo(26), 'u_i2', null, 'draft', 'Record created.'),
          h(daysAgo(20), 'u_i2', 'draft', 'submitted', 'Submitted for supervisor review.'),
          h(daysAgo(9), SUPERVISOR_ID, 'submitted', 'review', 'Opened for review.')
        ],
        comments: [ c('c_5', SUPERVISOR_ID, daysAgo(8), 'Placeholder review comment: please add the instrument model and integration times to the acquisition table.', null, false) ]
      }),
      mkReport({
        id: 'r_6', ownerId: 'u_i1',
        title: 'Sample Presentation — Placeholder ISRU Trade Study Slides',
        missionArea: 'Lunar', reportType: 'Presentation slides',
        abstract: 'Placeholder abstract for a slide deck presenting a notional trade study of in-situ resource utilisation approaches for a lunar south-polar outpost. Placeholder content only.',
        keywords: ['ISRU','trade study','outpost'],
        coAuthors: [],
        file: demoFile('sample-isru-trade-study.pptx'),
        status: 'revisions', featured: false,
        createdAt: daysAgo(22), submittedAt: daysAgo(17), updatedAt: daysAgo(6),
        history: [
          h(daysAgo(22), 'u_i1', null, 'draft', 'Record created.'),
          h(daysAgo(17), 'u_i1', 'draft', 'submitted', 'Submitted for supervisor review.'),
          h(daysAgo(6), SUPERVISOR_ID, 'submitted', 'revisions', 'Revisions requested — see review comments.')
        ],
        comments: [ c('c_6', SUPERVISOR_ID, daysAgo(6), 'Placeholder review comment: the trade criteria need explicit weighting and a sensitivity check before this can be approved.', null, false) ]
      }),
      mkReport({
        id: 'r_7', ownerId: 'u_i3',
        title: 'Sample Technical Note — Placeholder Dust Mitigation Concepts',
        missionArea: 'Both', reportType: 'Technical report',
        abstract: 'Placeholder abstract for a short technical note comparing notional dust-mitigation concepts for surface hardware on the Moon and Mars. Placeholder content only.',
        keywords: ['dust','mitigation','surface operations'],
        coAuthors: [],
        file: null,
        status: 'submitted', featured: false,
        createdAt: daysAgo(11), submittedAt: daysAgo(4), updatedAt: daysAgo(4),
        history: [
          h(daysAgo(11), 'u_i3', null, 'draft', 'Record created.'),
          h(daysAgo(4), 'u_i3', 'draft', 'submitted', 'Submitted for supervisor review.')
        ],
        comments: []
      }),
      mkReport({
        id: 'r_8', ownerId: 'u_i5',
        title: 'Sample Draft — Placeholder Calibration Procedure (work in progress)',
        missionArea: 'Other', reportType: 'Technical report',
        abstract: 'Placeholder abstract for an unsubmitted draft. Draft records are visible only to their author and to the supervisor; they never appear in the public library.',
        keywords: ['calibration','instrumentation'],
        coAuthors: [], file: null,
        status: 'draft', featured: false,
        createdAt: daysAgo(7), submittedAt: null, updatedAt: daysAgo(2),
        history: [ h(daysAgo(7), 'u_i5', null, 'draft', 'Record created.') ],
        comments: []
      }),
      mkReport({
        id: 'r_9', ownerId: 'u_i4',
        title: 'Sample Withdrawn Record — Placeholder Superseded Analysis',
        missionArea: 'Lunar', reportType: 'Research paper',
        abstract: 'Placeholder abstract for a withdrawn record, retained for audit purposes and excluded from the public library.',
        keywords: ['superseded'], coAuthors: [], file: null,
        status: 'withdrawn', featured: false,
        createdAt: daysAgo(200), submittedAt: daysAgo(196), updatedAt: daysAgo(150),
        history: [
          h(daysAgo(200), 'u_i4', null, 'draft', 'Record created.'),
          h(daysAgo(196), 'u_i4', 'draft', 'submitted', 'Submitted for supervisor review.'),
          h(daysAgo(150), 'u_i4', 'submitted', 'withdrawn', 'Withdrawn by author; superseded by a later analysis.')
        ],
        comments: []
      })
    ];
  }

  function h(at, by, from, to, note) { return { at: at, by: by, from: from, to: to, note: note }; }
  function c(id, authorId, at, body, parentId, internal) {
    return { id: id, authorId: authorId, at: at, body: body, parentId: parentId || null, internal: !!internal };
  }

  function freshState() {
    return {
      version: 1,
      seededAt: nowISO(),
      users: seedUsers(),
      reports: seedReports()
    };
  }

  /* ---------------- persistence ---------------- */

  var state = null;

  function load() {
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.users)) { state = parsed; return state; }
      } catch (e) { /* corrupt — reseed */ }
    }
    state = freshState();
    save();
    return state;
  }

  /* In API mode the server owns the data; this cache is a read model, so
     persisting it to localStorage would only create a stale second copy. */
  function apiMode() {
    return !!(global.ESH && global.ESH.api && global.ESH.api.enabled());
  }

  function save() {
    if (apiMode()) return;

    try { global.localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) {
      if (global.ESH && global.ESH.ui && global.ESH.ui.toast) {
        global.ESH.ui.toast('Could not save to browser storage (quota or private mode). Changes are in memory only.', 'err');
      }
    }
  }

  /* Restores the seeded placeholder content. Demo-mode only: against a backend
     this would replace the cache with fake reports until the next hydrate, and
     the footer button that calls it is hidden. Guarded here as well so the
     hidden control is not the only thing standing between a live hub and six
     placeholder records. */
  function reset() {
    if (apiMode()) return getState();
    state = freshState();
    save();
    try { global.localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function getState() { return state || load(); }

  /* Replace all data with a previously exported object. Validates the shape
     before committing so a malformed file cannot corrupt the store. Returns
     true on success. */
  /* Wholesale replacement of the local store. In API mode the store is a read
     model, not the source of truth: overwriting it would show imported data
     until the next /bootstrap silently replaced it again, and nothing would
     ever reach the server. Refused rather than half-applied — the UI hides the
     control too, but the guard is here so it cannot be reached another way. */
  function importState(obj) {
    if (apiMode()) return false;
    if (!obj || obj.version !== 1 || !Array.isArray(obj.users) || !Array.isArray(obj.reports)) return false;
    state = { version: 1, seededAt: obj.seededAt || nowISO(), users: obj.users, reports: obj.reports };
    save();
    return true;
  }

  /* ---------------- queries ---------------- */

  function users()   { return getState().users.slice(); }
  function reports() { return getState().reports.slice(); }

  function userById(id) {
    var list = getState().users;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function userByEmail(email) {
    var e = String(email || '').trim().toLowerCase();
    var list = getState().users;
    for (var i = 0; i < list.length; i++) if (list[i].email.toLowerCase() === e) return list[i];
    return null;
  }
  function reportById(id) {
    var list = getState().reports;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function interns() { return getState().users.filter(function (u) { return u.role === 'intern'; }); }
  function supervisors() { return getState().users.filter(function (u) { return u.role === 'supervisor'; }); }
  function reportsByOwner(id) { return getState().reports.filter(function (r) { return r.ownerId === id; }); }

  /* "Released" = Approved or Published: cleared by the supervisor for sharing
     with the rest of the group. Nothing in this hub is visible without a
     session, so this is NOT a public flag. */
  var isReleased = P.isReleased;
  function releasedReports() { return getState().reports.filter(isReleased); }

  /* ---------------- controlled-vocabulary helpers ----------------
     None of these ENFORCE a closed list — unknown values pass through as free
     text. They just fold obvious variants together (aliases, casing, spacing)
     so the roster, filters and library facets don't fragment. */

  function canonicalInstitution(s) {
    var t = String(s || '').trim();
    if (!t) return '';
    var key = t.toLowerCase();
    if (INSTITUTION_ALIASES[key]) return INSTITUTION_ALIASES[key];
    for (var i = 0; i < INSTITUTIONS.length; i++) {
      if (INSTITUTIONS[i].toLowerCase() === key) return INSTITUTIONS[i];
    }
    return t;
  }

  /* Fold a campaign onto a canonical spelling when it matches one, else keep the
     free text. */
  function canonicalCampaign(s) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    var key = t.toLowerCase();
    for (var i = 0; i < CAMPAIGNS.length; i++) {
      if (CAMPAIGNS[i].toLowerCase() === key) return CAMPAIGNS[i];
    }
    return t;
  }

  /* Distinct campaigns actually present on reports — drives the library filter. */
  function campaignsInUse() {
    var set = {};
    getState().reports.forEach(function (r) { if (r.campaign) set[r.campaign] = true; });
    return Object.keys(set).sort();
  }

  /* Trim, collapse inner whitespace, and drop case-insensitive duplicates
     (keeping the first spelling seen). */
  function canonicalKeywords(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (k) {
      var t = String(k || '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(t);
    });
    return out;
  }

  /* Existing keywords across all reports, most-used first — for suggestions. */
  function suggestedKeywords() {
    var freq = {};
    getState().reports.forEach(function (r) {
      (r.keywords || []).forEach(function (k) {
        var t = String(k || '').trim();
        if (!t) return;
        var key = t.toLowerCase();
        if (!freq[key]) freq[key] = { label: t, n: 0 };
        freq[key].n++;
      });
    });
    return Object.keys(freq).map(function (key) { return freq[key]; })
      .sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label); })
      .map(function (x) { return x.label; });
  }

  /* Display name for a report's author line. */
  function authorLine(r) {
    var owner = userById(r.ownerId);
    var names = [owner ? owner.fullName : 'Unknown author'];
    (r.coAuthors || []).forEach(function (ca) { if (ca && ca.name) names.push(ca.name); });
    return names.join(', ');
  }

  /* ---------------- mutations ---------------- */

  /* Local-only account creation, for the demo build. In API mode the server
     owns the user table, so writing here would produce an account that exists
     in one browser and nowhere else — it could never sign in, because sign-in
     goes to the server. Callers must use createUser() instead; this throws
     rather than half-working. */
  function addUser(u) {
    if (apiMode()) {
      throw new Error('addUser() is demo-mode only. Use store.createUser() when a backend is configured.');
    }
    var rec = Object.assign({
      id: uid('u'), role: 'intern', fullName: '', email: '', password: 'demo',
      institution: '', programme: '', supervisorId: SUPERVISOR_ID,
      startDate: '', endDate: '', researchTopic: '', keywords: [], bio: '',
      photoUrl: '', links: { linkedin: '', orcid: '', website: '' },
      standing: 'active', internalNotes: '', createdAt: nowISO()
    }, u);
    getState().users.push(rec);
    save();
    return rec;
  }

  function updateUser(id, patch) {
    var u = userById(id);
    if (!u) return null;
    if (apiMode()) sync(global.ESH.api.users.update(id, patch), 'Saving profile');
    Object.keys(patch).forEach(function (k) { u[k] = patch[k]; });
    save();
    return u;
  }

  /* Marks the point up to which a user has seen their notifications. Anything
     that happened after this timestamp is "unread". A missing value (never
     visited) means everything is unread. */
  function markNotificationsSeen(userId) {
    var u = userById(userId);
    if (!u) return null;
    if (apiMode()) sync(global.ESH.api.users.markNotificationsSeen(userId), 'Marking notifications read');
    u.notificationsSeenAt = nowISO();
    save();
    return u;
  }

  function addReport(r) {
    var rec = mkReport(Object.assign({
      id: uid('r'), ownerId: '', title: '', missionArea: 'Lunar',
      reportType: 'Research paper', campaign: '', abstract: '', keywords: [], coAuthors: [],
      file: null, supplementary: [], dataAvailability: '', status: 'draft',
      featured: false, createdAt: nowISO(), submittedAt: null, updatedAt: nowISO(),
      history: [], comments: []
    }, r));
    getState().reports.push(rec);
    save();
    return rec;
  }

  function updateReport(id, patch, opts) {
    var r = reportById(id);
    if (!r) return null;
    if (apiMode() && !(opts && opts.localOnly)) {
      sync(global.ESH.api.reports.update(id, patch), 'Saving changes');
    }
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    r.updatedAt = nowISO();
    save();
    return r;
  }

  /* Featuring has its OWN endpoint and is NOT a patchable report field: the
     server's PATCH whitelist deliberately excludes `featured`, because pinning
     a record is a supervisor act gated on can('report:feature'), not an edit.
     Routing it through updateReport() therefore looked like it worked and was
     silently discarded server-side. */
  function setFeatured(reportId, on, byUserId) {
    var r = reportById(reportId);
    if (!r) return null;
    if (apiMode()) {
      /* The server writes its own history entry for this action, so adding one
         locally too would show the change twice until the next hydrate. */
      sync(global.ESH.api.reports.feature(reportId, on), 'Updating featured');
    } else {
      r.history.push({ at: nowISO(), by: byUserId || '', from: r.status, to: r.status,
                       note: on ? 'Featured in the report library.' : 'Removed from featured.' });
    }
    r.featured = !!on;
    r.updatedAt = nowISO();
    save();
    return r;
  }

  /* Hard delete. In API mode the server also removes the B2 object, which the
     browser cannot do — dropping the row from the local cache alone left the
     record on the server (it returned on the next reload) and the file orphaned
     in the bucket. Async so callers can navigate only once it is really gone. */
  function deleteReport(reportId) {
    var r = reportById(reportId);
    if (!r) return Promise.resolve(false);

    function dropLocal() {
      var st = getState();
      st.reports = st.reports.filter(function (x) { return x.id !== reportId; });
      save();
      return true;
    }

    if (!apiMode()) return Promise.resolve(dropLocal());
    /* Server first: a refusal must not leave the record missing from the view
       while it still exists. */
    return global.ESH.api.reports.remove(reportId).then(dropLocal);
  }

  function logHistory(reportId, byUserId, from, to, note) {
    var r = reportById(reportId);
    if (!r) return null;
    r.history.push({ at: nowISO(), by: byUserId, from: from, to: to, note: note || '' });
    save();
    return r;
  }

  function setStatus(reportId, to, byUserId, note) {
    var r = reportById(reportId);
    if (!r) return null;
    var from = r.status;
    if (from === to) return r;
    if (apiMode()) sync(global.ESH.api.reports.status(reportId, to, note), 'Changing status');
    r.status = to;
    r.updatedAt = nowISO();
    if (to === 'submitted') r.submittedAt = nowISO();
    if (!STATUSES[to].released) r.featured = false;   /* never feature an unreleased record */
    r.history.push({ at: nowISO(), by: byUserId, from: from, to: to, note: note || '' });
    save();
    return r;
  }

  function addComment(reportId, authorId, body, parentId, internal) {
    var r = reportById(reportId);
    if (!r) return null;
    if (apiMode()) sync(global.ESH.api.reports.comment(reportId, body, parentId, internal), 'Posting comment');
    var rec = { id: uid('c'), authorId: authorId, at: nowISO(), body: body,
                parentId: parentId || null, internal: !!internal };
    r.comments.push(rec);
    r.updatedAt = nowISO();
    save();
    return rec;
  }

  /* ---------------- password reset ----------------
     A real deployment emails a single-use token to the address on file. There
     is no mail server here, so the token is created and stored the same way but
     the UI has to surface the link itself — which of course means anyone can
     reset anyone's password in this build. That is called out loudly on screen;
     see README.md § Password reset. */

  var RESET_TTL_MS = 30 * 60 * 1000;   /* 30 minutes */

  function randomToken() {
    var chars = 'abcdefghijkmnpqrstuvwxyz23456789';   /* 31 symbols */
    /* Reject byte values in the incomplete final block so `% n` is unbiased:
       31 does not divide 256, so a naive modulo would make the first 8 symbols
       ~12.5% likelier. limit = floor(256 / n) * n = 248. */
    var n = chars.length, limit = Math.floor(256 / n) * n;
    var byte = new Uint8Array(1);
    function nextByte() {
      if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(byte);
      else byte[0] = Math.floor(Math.random() * 256);
      return byte[0];
    }
    var out = '';
    while (out.length < 24) {
      var b = nextByte();
      if (b < limit) out += chars[b % n];
    }
    return out;
  }

  /** Issue a reset token. Returns null when no account matches — callers must
      still show the same neutral message either way (no account enumeration). */
  /* Demo-mode only. The token is surfaced on screen because there is no mail
     service; doing that against real accounts is account takeover, so API mode
     routes users to the supervisor instead and this refuses outright. */
  function requestPasswordReset(email) {
    if (apiMode()) return { ok: false, error: 'Self-service reset is unavailable on this hub.' };
    var u = userByEmail(email);
    if (!u) return null;
    u.resetToken = randomToken();
    u.resetExpires = new Date(Date.now() + RESET_TTL_MS).toISOString();
    save();
    return { user: u, token: u.resetToken, expires: u.resetExpires };
  }

  function userByResetToken(token) {
    if (!token) return null;
    var list = getState().users;
    for (var i = 0; i < list.length; i++) {
      var u = list[i];
      if (u.resetToken && u.resetToken === token) {
        if (new Date(u.resetExpires).getTime() < Date.now()) return { expired: true, user: u };
        return { expired: false, user: u };
      }
    }
    return null;
  }

  function completePasswordReset(userId, newPassword) {
    var u = userById(userId);
    if (!u) return null;
    u.password = String(newPassword);
    delete u.resetToken;
    delete u.resetExpires;
    u.passwordChangedAt = nowISO();
    save();
    return u;
  }

  /** Supervisor path: issue a temporary password to hand over out of band.
      Returned once to the caller and never stored anywhere else in readable
      form beyond the account record itself (which is plaintext in this stub). */
  function issueTemporaryPassword(userId) {
    var u = userById(userId);
    if (!u) return null;
    /* With a backend, only the server can actually change a password. Writing
       one into the local cache would print a password to the supervisor that
       the server had never heard of — they would hand over a credential that
       does not work. Returns a Promise here and a string in demo mode; callers
       flatten with Promise.resolve(). */
    if (apiMode()) {
      return global.ESH.api.issueTemporaryPassword(userId).then(function (res) {
        if (!res.ok) throw new Error(res.error || 'The password could not be issued.');
        return res.temporaryPassword;
      });
    }
    var temp = randomToken().slice(0, 10);
    u.password = temp;
    delete u.resetToken;
    delete u.resetExpires;
    u.passwordChangedAt = nowISO();
    save();
    return temp;
  }

  /* ==========================================================================
     API MODE

     With a backend present, this module stops being the source of truth and
     becomes a read model: one /bootstrap call fills the cache with exactly
     what the server says this actor may see, and the views keep reading it
     synchronously, unchanged.

     Writes are applied to the cache immediately and sent to the server in the
     background. If the server refuses — which it will, if the browser's copy
     of the policy ever disagrees with the real one — the optimistic change is
     rolled back by re-hydrating from the server and the user is told. The
     server's answer always wins.
     ========================================================================== */

  var onSyncError = null;   /* set by app.js so the store need not know about the UI */
  function setSyncErrorHandler(fn) { onSyncError = fn; }

  /** Replace the whole cache from the server. Returns a promise. */
  function hydrate() {
    if (!apiMode()) { load(); return Promise.resolve(getState()); }
    return global.ESH.api.bootstrap().then(function (data) {
      state = {
        version: 1,
        seededAt: nowISO(),
        users: (data.users || []).slice(),
        reports: (data.reports || []).slice()
      };
      return state;
    });
  }

  /* Fire a server call for an optimistic local change. On failure, re-sync
     and hand the error to the UI. */
  function sync(promise, what) {
    if (!promise || !promise.then) return promise;
    return promise['catch'](function (err) {
      /* Re-sync so the optimistic change is rolled back. If that ALSO fails —
         the server has gone away entirely — the rollback is what is lost, not
         the report: swallow the second failure so the first one still reaches
         the user, who would otherwise be told nothing at all. */
      return hydrate()['catch'](function () {})
        .then(function () {
          if (onSyncError) onSyncError(err, what);
          else console.error('[store] ' + what + ' failed:', err);
          throw err;
        });
    });
  }

  /* Async, server-first account creation. Supervisor-only on the server side.
     Resolves with { user, initialPassword } — the password is shown once and
     is not retrievable afterwards, so the caller must display it immediately.
     In demo mode it falls back to the local table and reports the seeded
     password, keeping one call signature for both builds. */
  function createUser(patch) {
    if (!apiMode()) {
      var local = addUser(patch);
      return Promise.resolve({ user: local, initialPassword: local.password });
    }
    return global.ESH.api.users.create(patch).then(function (d) {
      getState().users.push(d.user);
      return { user: d.user, initialPassword: d.initialPassword };
    });
  }

  /* Async, server-first creation. Used by the submission form, which must
     have a real report id before it can upload a file against it. */
  function createReport(patch) {
    if (!apiMode()) return Promise.resolve(addReport(patch));
    return global.ESH.api.reports.create(patch).then(function (d) {
      getState().reports.push(d.report);
      return d.report;
    });
  }

  /* ---------------- exports ---------------- */

  global.ESH = global.ESH || {};
  global.ESH.store = {
    KEY: KEY, SESSION_KEY: SESSION_KEY, SUPERVISOR_ID: SUPERVISOR_ID,
    MISSION_AREAS: MISSION_AREAS, REPORT_TYPES: REPORT_TYPES,
    STATUSES: STATUSES, STATUS_ORDER: STATUS_ORDER, TRANSITIONS: TRANSITIONS,
    STANDING: STANDING, ACCEPTED_FILES: ACCEPTED_FILES, INSTITUTIONS: INSTITUTIONS,
    CAMPAIGNS: CAMPAIGNS,
    canonicalInstitution: canonicalInstitution, canonicalKeywords: canonicalKeywords,
    suggestedKeywords: suggestedKeywords, canonicalCampaign: canonicalCampaign,
    campaignsInUse: campaignsInUse,

    load: load, save: save, reset: reset, getState: getState, uid: uid, nowISO: nowISO,
    apiMode: apiMode, hydrate: hydrate, createReport: createReport,
    setSyncErrorHandler: setSyncErrorHandler,
    importState: importState,

    users: users, interns: interns, supervisors: supervisors,
    userById: userById, userByEmail: userByEmail,
    reports: reports, reportById: reportById, reportsByOwner: reportsByOwner,
    releasedReports: releasedReports, isReleased: isReleased, authorLine: authorLine,

    addUser: addUser, createUser: createUser, updateUser: updateUser, markNotificationsSeen: markNotificationsSeen,
    setFeatured: setFeatured, deleteReport: deleteReport,
    addReport: addReport, updateReport: updateReport,
    setStatus: setStatus, logHistory: logHistory, addComment: addComment,

    requestPasswordReset: requestPasswordReset, userByResetToken: userByResetToken,
    completePasswordReset: completePasswordReset, issueTemporaryPassword: issueTemporaryPassword,
    RESET_TTL_MS: RESET_TTL_MS,

    putBlob: putBlob, fileHandle: fileHandle
  };

})(window);
