import pg from 'pg';
import type {Config} from './config.js';
export function createPool(config:Config){
  const url=new URL(config.databaseUrl);
  // Explicit TLS verification cannot be overwritten by pg's URL SSL options.
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert','channel_binding'])url.searchParams.delete(key);
  return new pg.Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true},enableChannelBinding:true,max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000,statement_timeout:15000});
}
export type Pool=pg.Pool;
export type Client=pg.PoolClient;
export type Queryable=Pick<Pool,'query'>;
export function tables(schema:string){
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error('Invalid database schema');
  return (name:string)=>`"${schema}"."${name}"`;
}
export async function transaction<T>(pool:Pool,fn:(client:Client)=>Promise<T>){
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
