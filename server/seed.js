/* ==========================================================================
   seed.js — create the first supervisor account.

   Deliberately minimal. This is a real build now, so it does NOT install the
   placeholder interns and sample reports the demo used: seeding a production
   database with fake people is how fake people end up in real reports.

   Run once:  npm run seed
   ========================================================================== */
'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });

const crypto = require('node:crypto');
const db = require('./db.js');
const session = require('./session.js');

function main() {
  const email = (process.env.SEED_SUPERVISOR_EMAIL || '').trim();
  if (!email) {
    console.error('Set SEED_SUPERVISOR_EMAIL in server/.env first.');
    process.exit(1);
  }

  const existing = db.userByEmail(email);
  if (existing) {
    console.log('An account already exists for %s (%s). Nothing to do.', email, existing.role);
    console.log('To reset its password, sign in as another supervisor, or delete data/hub.db and re-seed.');
    return;
  }

  /* A generated password is better than a weak one typed into .env, so it is
     only read from there if explicitly set. */
  const password = process.env.SEED_SUPERVISOR_PASSWORD || crypto.randomBytes(12).toString('base64url');
  const { hash, salt } = session.hashPassword(password);

  db.insertUser({
    id: 'u_foing',
    role: 'supervisor',
    fullName: 'Prof. Bernard Foing',
    email,
    passwordHash: hash,
    passwordSalt: salt,
    institution: 'ILEWG / ESA / VU Amsterdam / Florida Institute of Technology',
    programme: '—',
    supervisorId: null,
    researchTopic: 'Lunar and Mars exploration, astrobiology, planetary instrumentation, analogue missions',
    keywords: ['Lunar science & exploration', 'Mars science & exploration', 'Astrobiology',
               'Planetary instrumentation', 'Analogue missions'],
    bio: '',
    links: { linkedin: '', orcid: '', website: 'https://sci.esa.int/web/ilewg' },
    standing: 'active',
    createdAt: db.nowISO()
  });

  console.log('\n  Supervisor account created.');
  console.log('  Email:    %s', email);
  console.log('  Password: %s', password);
  console.log('\n  Sign in and change it immediately. This is the only time it is shown.\n');
}

main();
