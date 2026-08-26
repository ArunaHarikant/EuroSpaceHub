/* ==========================================================================
   seed-demo.js — fill a database with placeholder people and placeholder
   reports, so the hub can be shown to someone without a real research group
   behind it.

   This replaces the old client-side demo mode. That version was a second data
   layer in the browser, which meant every write needed two correct code paths
   and the wrong one failed silently; several features were discarded by the
   server for months without an error anywhere. Here the demo is DATA, not a
   parallel implementation: the same server, the same policy gate, the same
   session cookies, the same queries. What you are shown is what the app does.

   Run:  npm run seed:demo

   It REFUSES to touch a database that already holds accounts it did not
   create, and refuses outright unless ALLOW_DEMO_SEED=1 is set. Placeholder
   people appearing in a real supervisor's roster is exactly the accident this
   file has to be incapable of causing.
   ========================================================================== */
'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });

const db = require('./db.js');
const session = require('./session.js');

const DEMO_PASSWORD = 'demo-password';   /* stated on screen; this data is fake */

const now = Date.now();
const daysAgo = (n) => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  d.setHours(9, 30, 0, 0);
  return d.toISOString();
};

function mkUser(u) {
  const { hash, salt } = session.hashPassword(DEMO_PASSWORD);
  return db.insertUser(Object.assign({
    passwordHash: hash, passwordSalt: salt, standing: 'active', createdAt: daysAgo(200)
  }, u));
}

function main() {
  if (process.env.ALLOW_DEMO_SEED !== '1') {
    console.error('Refusing to seed placeholder data.');
    console.error('This writes fake researchers and fake reports into %s.', db.DB_PATH);
    console.error('If that is what you want, run it with ALLOW_DEMO_SEED=1.');
    process.exit(1);
  }

  const existing = db.allUsers();
  const foreign = existing.filter((u) => !u.email.endsWith('@demo.eurospacehub.local'));
  if (foreign.length) {
    console.error('Refusing: %s already holds %d account(s) this script did not create.',
      db.DB_PATH, foreign.length);
    console.error('Point DB_PATH at a scratch database instead — never seed a live one.');
    process.exit(1);
  }
  if (existing.length) {
    console.log('Demo data is already present in %s. Nothing to do.', db.DB_PATH);
    return;
  }

  /* ---- people ---- */
  const sup = mkUser({
    id: 'u_demo_sup', role: 'supervisor',
    fullName: 'Prof. Bernard Foing',
    email: 'supervisor@demo.eurospacehub.local',
    institution: 'ILEWG / ESA / VU Amsterdam',
    programme: '—', researchTopic: 'Lunar and Mars exploration, analogue missions',
    keywords: ['Lunar science & exploration', 'Mars science & exploration', 'Analogue missions'],
    createdAt: daysAgo(400)
  });

  mkUser({
    id: 'u_demo_cosup', role: 'supervisor',
    fullName: 'Co-Supervisor Name',
    email: 'cosupervisor@demo.eurospacehub.local',
    institution: 'Partner Institution', programme: '—',
    researchTopic: 'Placeholder co-supervisor account',
    bio: 'Placeholder account showing that the supervisor role is not tied to one person.',
    createdAt: daysAgo(300)
  });

  const interns = [
    ['u_demo_i1', 'Intern Name A', 'intern.a@demo.eurospacehub.local',
     'International Space University', 'MSc Space Studies',
     'Lunar regolith geotechnics', ['regolith', 'ISRU', 'south pole'], 210, 30,
     'Placeholder internal note: on track; strong analytical work.'],
    ['u_demo_i2', 'Intern Name B', 'intern.b@demo.eurospacehub.local',
     'Vrije Universiteit Amsterdam', 'MSc Earth Sciences',
     'Mars surface spectroscopy', ['HRSC', 'spectroscopy', 'stratigraphy'], 180, 15,
     'Placeholder internal note: requested an extension to the research period.'],
    ['u_demo_i3', 'Intern Name C', 'intern.c@demo.eurospacehub.local',
     'Florida Institute of Technology', 'BSc Astrobiology',
     'Analogue habitat life-support monitoring', ['analogue', 'habitat', 'life support'], 150, -45, '']
  ];
  for (const [id, fullName, email, institution, programme, topic, kw, started, ends, note] of interns) {
    const end = new Date(now);
    end.setDate(end.getDate() + ends);
    mkUser({
      id, role: 'intern', fullName, email, institution, programme,
      supervisorId: sup.id,
      startDate: daysAgo(started).slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      researchTopic: topic, keywords: kw, internalNotes: note,
      createdAt: daysAgo(started)
    });
  }

  /* ---- reports ----
     Spread across the workflow so every state, badge and dashboard figure has
     something behind it. No file is attached: the binary would have to live in
     B2, and a demo should not need credentials to be worth looking at. */
  const ABSTRACT =
    'Placeholder abstract. This sample record exists to demonstrate how a report appears in the ' +
    'hub; the content is invented and does not represent real research findings.';

  const reports = [
    { id: 'r_demo_1', ownerId: 'u_demo_i1', title: 'Sample Lunar Regolith Report',
      missionArea: 'Lunar', reportType: 'Research paper', campaign: 'EuroMoonMars',
      status: 'published', featured: true, keywords: ['regolith', 'ISRU'], created: 120, submitted: 90 },
    { id: 'r_demo_2', ownerId: 'u_demo_i2', title: 'Sample Mars Topography Report',
      missionArea: 'Mars', reportType: 'Technical report', campaign: 'Mars analogue programme',
      status: 'published', featured: true, keywords: ['HRSC', 'topography'], created: 95, submitted: 70 },
    { id: 'r_demo_3', ownerId: 'u_demo_i3', title: 'Sample Analogue Campaign Report',
      missionArea: 'Both', reportType: 'Analogue mission report', campaign: 'EuroMoonMars',
      status: 'approved', featured: false, keywords: ['analogue', 'habitat'], created: 60, submitted: 40 },
    { id: 'r_demo_4', ownerId: 'u_demo_i1', title: 'Sample Polar Volatiles Poster',
      missionArea: 'Lunar', reportType: 'Conference poster', campaign: 'Lunar south-pole study',
      status: 'review', featured: false, keywords: ['volatiles'], created: 20, submitted: 12 },
    { id: 'r_demo_5', ownerId: 'u_demo_i2', title: 'Sample Spectral Library Description',
      missionArea: 'Mars', reportType: 'Dataset description', campaign: '',
      status: 'revisions', featured: false, keywords: ['spectroscopy'], created: 18, submitted: 9 },
    { id: 'r_demo_6', ownerId: 'u_demo_i3', title: 'Sample ISRU Trade Study',
      missionArea: 'Lunar', reportType: 'Research paper', campaign: 'ExoGeoLab',
      status: 'draft', featured: false, keywords: ['ISRU'], created: 4, submitted: null }
  ];

  for (const r of reports) {
    const createdAt = daysAgo(r.created);
    const history = [{ at: createdAt, by: r.ownerId, from: null, to: 'draft', note: 'Record created.' }];
    if (r.submitted !== null) {
      history.push({ at: daysAgo(r.submitted), by: r.ownerId, from: 'draft', to: 'submitted',
                     note: 'Submitted for supervisor review.' });
      if (r.status !== 'submitted') {
        history.push({ at: daysAgo(Math.max(1, r.submitted - 4)), by: sup.id,
                       from: 'submitted', to: r.status, note: 'Placeholder transition.' });
      }
    }

    const comments = [];
    if (r.status === 'revisions') {
      comments.push({ id: 'c_demo_1', authorId: sup.id, at: daysAgo(6),
                      body: 'Placeholder review comment: the trade criteria need explicit weighting.',
                      parentId: null, internal: false });
    }
    if (r.status === 'published' && r.id === 'r_demo_1') {
      comments.push({ id: 'c_demo_2', authorId: sup.id, at: daysAgo(80),
                      body: 'Placeholder internal note (supervisor only): a good candidate for the next session.',
                      parentId: null, internal: true });
    }

    db.insertReport({
      id: r.id, ownerId: r.ownerId, title: r.title, missionArea: r.missionArea,
      reportType: r.reportType, campaign: r.campaign, abstract: ABSTRACT,
      keywords: r.keywords, coAuthors: [], file: null, supplementary: [],
      dataAvailability: 'Placeholder — no data is attached to this sample record.',
      status: r.status, featured: r.featured,
      createdAt, submittedAt: r.submitted === null ? null : daysAgo(r.submitted),
      updatedAt: createdAt, history, comments
    });
  }

  console.log('');
  console.log('  Demo data written to %s', db.DB_PATH);
  console.log('');
  console.log('  Every account uses the password: %s', DEMO_PASSWORD);
  console.log('');
  console.log('    supervisor@demo.eurospacehub.local    Supervisor — full access');
  console.log('    cosupervisor@demo.eurospacehub.local  Supervisor — a second one');
  console.log('    intern.a@demo.eurospacehub.local      Researcher');
  console.log('    intern.b@demo.eurospacehub.local      Researcher');
  console.log('    intern.c@demo.eurospacehub.local      Researcher');
  console.log('');
  console.log('  Every person and every report here is a placeholder.');
  console.log('');
}

main();
