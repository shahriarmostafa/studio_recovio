import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {tables,transaction,type Pool} from './db.js';

export async function migrate(pool:Pool,schema:string){
  const t=tables(schema);
  const folder=fileURLToPath(new URL('../migrations/',import.meta.url));
  await transaction(pool,async db=>{
    // Transaction-level lock works with Neon's transaction pooler; no session state.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recovio-migrations:${schema}`]);
    await db.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await db.query(`CREATE TABLE IF NOT EXISTS ${t('migrations')}(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
    for(const name of (await readdir(folder)).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
      const source=await readFile(folder+name,'utf8');
      const checksum=createHash('sha256').update(source).digest('hex');
      const existing=await db.query(`SELECT checksum FROM ${t('migrations')} WHERE name=$1`,[name]);
      if(existing.rowCount){if(existing.rows[0].checksum!==checksum)throw new Error(`Migration checksum mismatch: ${name}`);continue;}
      await db.query(source.replaceAll('__SCHEMA__',`"${schema}"`));
      await db.query(`INSERT INTO ${t('migrations')}(name,checksum) VALUES($1,$2)`,[name,checksum]);
    }
  });
}
