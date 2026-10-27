import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import type {FastifyReply,FastifyRequest} from 'fastify';
import type {Pool,Queryable} from './db.js';
import {tables} from './db.js';
import type {Config} from './config.js';

export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const randomToken=()=>randomBytes(32).toString('base64url');
export const temporaryPassword=()=>randomBytes(18).toString('base64url');
export const csrfFor=(token:string)=>digest(`recovio-csrf:${token}`);
export async function hashPassword(password:string){
  const salt=randomBytes(16).toString('hex');
  const derived=await new Promise<Buffer>((resolve,reject)=>scryptCallback(password,salt,64,{N:65536,r:8,p:2,maxmem:128*1024*1024},(error,key)=>error?reject(error):resolve(key)));
  return `scrypt-v1$${salt}$${derived.toString('hex')}`;
}
export async function verifyPassword(password:string,encoded:string){
  const [format,salt,hash]=encoded.split('$');
  if(format!=='scrypt-v1'||!salt||!hash)return false;
  const derived=await new Promise<Buffer>((resolve,reject)=>scryptCallback(password,salt,64,{N:65536,r:8,p:2,maxmem:128*1024*1024},(error,key)=>error?reject(error):resolve(key)));
  const expected=Buffer.from(hash,'hex');
  return expected.length===derived.length&&timingSafeEqual(expected,derived);
}
export class HttpError extends Error{constructor(public statusCode:number,public code:string,message:string){super(message);}}
export type Staff={id:string;email:string;name:string;role:'admin'|'doctor';active:boolean;must_change_password:boolean};
declare module 'fastify'{interface FastifyRequest{staff:Staff|null;sessionHash:string|null}}
export const userColumns='id,email,name,role,active,must_change_password,created_at';

export function security(pool:Pool,config:Config){
  const t=tables(config.schema),cookieName=config.production?'__Host-recovio_session':'recovio_session';
  const cookieOptions={path:'/',httpOnly:true,secure:config.production,sameSite:'lax' as const,maxAge:12*60*60};
  function requirePortalOrigin(request:FastifyRequest){
    if(request.headers.origin!==config.portalOrigin)throw new HttpError(403,'ORIGIN_REJECTED','Origine della richiesta non consentita.');
  }
  async function authenticate(request:FastifyRequest,allowTemporary=false){
    const token=request.cookies[cookieName];
    if(!token||token.length>128)throw new HttpError(401,'UNAUTHENTICATED','Accedi per continuare.');
    const result=await pool.query(`SELECT u.*,s.csrf_hash FROM ${t('sessions')} s JOIN ${t('users')} u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,[digest(token)]);
    const user=result.rows[0];
    if(!user)throw new HttpError(401,'UNAUTHENTICATED','La sessione è scaduta. Accedi di nuovo.');
    request.staff={id:user.id,email:user.email,name:user.name,role:user.role,active:user.active,must_change_password:user.must_change_password};request.sessionHash=digest(token);
    if(!['GET','HEAD','OPTIONS'].includes(request.method)){
      requirePortalOrigin(request);
      const supplied=request.headers['x-csrf-token'];
      if(typeof supplied!=='string'||supplied.length!==64||!timingSafeEqual(Buffer.from(digest(supplied)),Buffer.from(user.csrf_hash)))throw new HttpError(403,'CSRF_REJECTED','Ricarica la pagina e riprova.');
    }
    if(user.must_change_password&&!allowTemporary)throw new HttpError(403,'PASSWORD_CHANGE_REQUIRED','Imposta una password personale per continuare.');
  }
  const staff=async(request:FastifyRequest)=>{await authenticate(request);};
  const temporary=async(request:FastifyRequest)=>{await authenticate(request,true);};
  const admin=async(request:FastifyRequest)=>{await authenticate(request);if(request.staff!.role!=='admin')throw new HttpError(403,'FORBIDDEN','Accesso riservato agli amministratori.');};
  async function issueSession(db:Queryable,userId:string,reply:FastifyReply){
    const token=randomToken(),csrfToken=csrfFor(token);
    await db.query(`DELETE FROM ${t('sessions')} WHERE expires_at<now()`);
    await db.query(`INSERT INTO ${t('sessions')}(token_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')`,[digest(token),userId,digest(csrfToken)]);
    reply.setCookie(cookieName,token,cookieOptions);return csrfToken;
  }
  function clearCookie(reply:FastifyReply){reply.clearCookie(cookieName,{path:'/',secure:config.production,httpOnly:true,sameSite:'lax'});}
  return {staff,temporary,admin,requirePortalOrigin,issueSession,clearCookie,csrf:(r:FastifyRequest)=>csrfFor(r.cookies[cookieName]!),cookieName};
}
export async function audit(db:Queryable,schema:string,actor:string|null,action:string,target:string|null,metadata:Record<string,unknown>={}){
  await db.query(`INSERT INTO ${tables(schema)('audit_events')}(actor_id,action,target_id,metadata) VALUES($1,$2,$3,$4)`,[actor,action,target,JSON.stringify(metadata)]);
}
