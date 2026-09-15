import { connect, one, query } from './db.js';
import { z } from 'zod';
const url = process.env.DATABASE_ADMIN_URL; if (!url) throw new Error('Defina DATABASE_ADMIN_URL.');
const email = z.email().parse(process.env.INITIAL_ADMIN_EMAIL).toLowerCase();
const name = process.env.ORGANIZATION_NAME ?? 'Equipe de RH';
const db = connect(url);
try {
  await db.transaction().execute(async tx => {
    const existing = await query<{ id: string }>(tx, 'select id from users where lower(email)=$1', [email]);
    if (existing.length > 1) throw new Error('Há identidades duplicadas para o administrador. Revise o cadastro.');
    const user = existing[0] ?? await one<{ id: string }>(tx, 'insert into users(subject,name,email) values($1,$2,$3) returning id', [`pending:${email}`, 'Administrador', email]);
    let org = (await query<{ id: string }>(tx, 'select o.id from organizations o join memberships m on m.organization_id=o.id where m.user_id=$1 and o.name=$2', [user.id, name]))[0];
    if (!org) { org = await one<{ id: string }>(tx, 'insert into organizations(name) values($1) returning id', [name]); await query(tx, "insert into memberships(organization_id,user_id,role) values($1,$2,'admin')", [org.id, user.id]); }
    process.stdout.write(`Organização provisionada: ${org.id}\n`);
  });
} finally { await db.destroy(); }
