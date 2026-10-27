import {config as dotenv} from 'dotenv';
import {z} from 'zod';
dotenv({quiet:true});

const envSchema=z.object({
  DATABASE_URL:z.string().url(),
  DB_SCHEMA:z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).default('studio_recovio'),
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  HOST:z.string().default('127.0.0.1'),
  PORT:z.coerce.number().int().min(1).max(65535).default(4000),
  PORTAL_ORIGIN:z.string().url().default('http://localhost:4000'),
  WEBSITE_ORIGINS:z.string().default('http://localhost:3003'),
  WEBSITE_URL:z.string().url().default('http://localhost:3003'),
  TRUST_PROXY:z.string().default(''),
  APPLICATIONS_ENABLED:z.enum(['true','false']).optional(),
});
export function readConfig(env:NodeJS.ProcessEnv=process.env){
  const parsed=envSchema.safeParse(env);
  if(!parsed.success)throw new Error('Invalid configuration: '+parsed.error.issues.map(i=>i.path.join('.')).join(', '));
  const e=parsed.data;
  const portalOrigin=new URL(e.PORTAL_ORIGIN).origin;
  const websiteOrigins=e.WEBSITE_ORIGINS.split(',').filter(Boolean).map(v=>new URL(v.trim()).origin);
  if(e.NODE_ENV==='production'&&[portalOrigin,...websiteOrigins,e.WEBSITE_URL].some(v=>!v.startsWith('https://')))throw new Error('Production URLs must use HTTPS');
  return {databaseUrl:e.DATABASE_URL,schema:e.DB_SCHEMA,production:e.NODE_ENV==='production',host:e.HOST,port:e.PORT,portalOrigin,websiteOrigins,websiteUrl:e.WEBSITE_URL,trustProxy:e.TRUST_PROXY?e.TRUST_PROXY.split(',').map(s=>s.trim()):false as false,applicationsEnabled:e.APPLICATIONS_ENABLED?e.APPLICATIONS_ENABLED==='true':e.NODE_ENV!=='production'};
}
export type Config=ReturnType<typeof readConfig>;
