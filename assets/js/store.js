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

  /* ---------------- controlled vocabularies ---------------- */

  var MISSION_AREAS = ['Lunar', 'Mars', 'Both', 'Other'];

  var REPORT_TYPES = [
    'Research paper',
    'Technical report',
    'Poster',
    'Presentation slides',
    'Dataset + description',
    'Analogue mission report'
  ];

  /* Workflow states. `terminal` states admit no further transitions.
     `internEditable` marks the states in which the author may still change the
     record: up to and including Submitted (the supervisor has not opened it
     yet), and again when revisions are requested. Once it is Under Review the
     supervisor is reading it, so it locks. */
  var STATUSES = {
    draft:      { key: 'draft',      label: 'Draft',              badge: 'draft',      order: 1, released: false, internEditable: true  },
    submitted:  { key: 'submitted',  label: 'Submitted',          badge: 'submitted',  order: 2, released: false, internEditable: true  },
    review:     { key: 'review',     label: 'Under Review',       badge: 'review',     order: 3, released: false, internEditable: false },
    revisions:  { key: 'revisions',  label: 'Revisions Requested',badge: 'revisions',  order: 4, released: false, internEditable: true  },
    approved:   { key: 'approved',   label: 'Approved',           badge: 'approved',   order: 5, released: true,  internEditable: false },
    published:  { key: 'published',  label: 'Published',          badge: 'published',  order: 6, released: true,  internEditable: false },
    rejected:   { key: 'rejected',   label: 'Rejected',           badge: 'rejected',   order: 7, released: false, internEditable: false, terminal: true },
    withdrawn:  { key: 'withdrawn',  label: 'Withdrawn',          badge: 'withdrawn',  order: 8, released: false, internEditable: false, terminal: true }
  };

  var STATUS_ORDER = ['draft','submitted','review','revisions','approved','published','rejected','withdrawn'];

  /* Legal transitions, by the role permitted to make them.
     Enforced in auth.js#canTransition and in the UI. */
  var TRANSITIONS = {
    draft:     { intern: ['submitted', 'withdrawn'],            supervisor: [] },
    submitted: { intern: ['withdrawn'],                          supervisor: ['review','revisions','approved','rejected'] },
    review:    { intern: ['withdrawn'],                          supervisor: ['revisions','approved','rejected','submitted'] },
    revisions: { intern: ['submitted','withdrawn'],              supervisor: ['review','rejected'] },
    approved:  { intern: [],                                     supervisor: ['published','revisions','rejected'] },
    published: { intern: [],                                     supervisor: ['approved'] },
    rejected:  { intern: [],                                     supervisor: [] },
    withdrawn: { intern: [],                                     supervisor: [] }
  };

  var STANDING = ['active', 'inactive', 'alumnus'];

  var ACCEPTED_FILES = '.pdf,.docx,.pptx,application/pdf,' +
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
    'application/vnd.openxmlformats-officedocument.presentationml.presentation';

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
        missionArea: 'Lunar', reportType: 'Research paper',
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
        missionArea: 'Mars', reportType: 'Technical report',
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
        missionArea: 'Both', reportType: 'Analogue mission report',
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

  function save() {
    try { global.localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) {
      if (global.ESH && global.ESH.ui && global.ESH.ui.toast) {
        global.ESH.ui.toast('Could not save to browser storage (quota or private mode). Changes are in memory only.', 'err');
      }
    }
  }

  function reset() {
    state = freshState();
    save();
    try { global.localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function getState() { return state || load(); }

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
  function isReleased(r) { return !!(STATUSES[r.status] && STATUSES[r.status].released); }
  function releasedReports() { return getState().reports.filter(isReleased); }

  /* Display name for a report's author line. */
  function authorLine(r) {
    var owner = userById(r.ownerId);
    var names = [owner ? owner.fullName : 'Unknown author'];
    (r.coAuthors || []).forEach(function (ca) { if (ca && ca.name) names.push(ca.name); });
    return names.join(', ');
  }

  /* ---------------- mutations ---------------- */

  function addUser(u) {
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
    Object.keys(patch).forEach(function (k) { u[k] = patch[k]; });
    save();
    return u;
  }

  function addReport(r) {
    var rec = mkReport(Object.assign({
      id: uid('r'), ownerId: '', title: '', missionArea: 'Lunar',
      reportType: 'Research paper', abstract: '', keywords: [], coAuthors: [],
      file: null, supplementary: [], dataAvailability: '', status: 'draft',
      featured: false, createdAt: nowISO(), submittedAt: null, updatedAt: nowISO(),
      history: [], comments: []
    }, r));
    getState().reports.push(rec);
    save();
    return rec;
  }

  function updateReport(id, patch) {
    var r = reportById(id);
    if (!r) return null;
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    r.updatedAt = nowISO();
    save();
    return r;
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
    var rec = { id: uid('c'), authorId: authorId, at: nowISO(), body: body,
                parentId: parentId || null, internal: !!internal };
    r.comments.push(rec);
    r.updatedAt = nowISO();
    save();
    return rec;
  }

  /* ---------------- exports ---------------- */

  global.ESH = global.ESH || {};
  global.ESH.store = {
    KEY: KEY, SESSION_KEY: SESSION_KEY, SUPERVISOR_ID: SUPERVISOR_ID,
    MISSION_AREAS: MISSION_AREAS, REPORT_TYPES: REPORT_TYPES,
    STATUSES: STATUSES, STATUS_ORDER: STATUS_ORDER, TRANSITIONS: TRANSITIONS,
    STANDING: STANDING, ACCEPTED_FILES: ACCEPTED_FILES,

    load: load, save: save, reset: reset, getState: getState, uid: uid, nowISO: nowISO,

    users: users, interns: interns, supervisors: supervisors,
    userById: userById, userByEmail: userByEmail,
    reports: reports, reportById: reportById, reportsByOwner: reportsByOwner,
    releasedReports: releasedReports, isReleased: isReleased, authorLine: authorLine,

    addUser: addUser, updateUser: updateUser,
    addReport: addReport, updateReport: updateReport,
    setStatus: setStatus, logHistory: logHistory, addComment: addComment,

    putBlob: putBlob, fileHandle: fileHandle
  };

})(window);
