import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Pool} from './db.js';
import {tables,transaction} from './db.js';
import type {Config} from './config.js';
import {security,hashPassword,verifyPassword,digest,audit,HttpError} from './security.js';
import {email,password} from './validation.js';

export async function authRoutes(app:FastifyInstance,pool:Pool,config:Config){
  const auth=security(pool,config),t=tables(config.schema);
  const dummyHash=await hashPassword('nonexistent-account-'+crypto.randomUUID());
  app.post('/api/auth/login',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(request,reply)=>{
    auth.requirePortalOrigin(request);
    const input=z.object({email,password:z.string().min(1).max(128)}).strict().parse(request.body);
    const key=digest(input.email);
    const result=await transaction(pool,async db=>{
      await db.query(`INSERT INTO ${t('login_attempts')}(identifier_hash) VALUES($1) ON CONFLICT DO NOTHING`,[key]);
      const attempts=(await db.query(`SELECT * FROM ${t('login_attempts')} WHERE identifier_hash=$1 FOR UPDATE`,[key])).rows[0];
      if(attempts.locked_until&&new Date(attempts.locked_until)>new Date())return {blocked:true as const};
      const user=(await db.query(`SELECT * FROM ${t('users')} WHERE email=$1 FOR UPDATE`,[input.email])).rows[0];
      const valid=await verifyPassword(input.password,user?.password_hash??dummyHash);
      if(!valid||!user?.active){
        await db.query(`UPDATE ${t('login_attempts')} SET failures=CASE WHEN window_started<now()-interval '15 minutes' THEN 1 ELSE failures+1 END,locked_until=CASE WHEN window_started>=now()-interval '15 minutes' AND failures>=9 THEN now()+interval '15 minutes' ELSE NULL END,window_started=CASE WHEN window_started<now()-interval '15 minutes' THEN now() ELSE window_started END WHERE identifier_hash=$1`,[key]);
        return {invalid:true as const};
      }
      await db.query(`DELETE FROM ${t('login_attempts')} WHERE identifier_hash=$1 OR window_started<now()-interval '1 day'`,[key]);
      const csrfToken=await auth.issueSession(db,user.id,reply);
      await audit(db,config.schema,user.id,'auth.login',user.id);
      return {user:{id:user.id,name:user.name,email:user.email,role:user.role,must_change_password:user.must_change_password},csrfToken};
    });
    if('blocked' in result){reply.header('Retry-After','900');throw new HttpError(429,'LOGIN_LIMIT','Troppi tentativi. Riprova fra 15 minuti.');}
    if('invalid' in result)throw new HttpError(401,'INVALID_CREDENTIALS','Email o password non valide.');
    return result;
  });
  app.get('/api/auth/me',{preHandler:auth.temporary},async request=>({user:request.staff,csrfToken:auth.csrf(request)}));
  app.post('/api/auth/logout',{preHandler:auth.temporary},async(request,reply)=>{
    await pool.query(`DELETE FROM ${t('sessions')} WHERE token_hash=$1`,[request.sessionHash]);auth.clearCookie(reply);return {ok:true};
  });
  app.post('/api/auth/password',{preHandler:auth.temporary,config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(request,reply)=>{
    const input=z.object({currentPassword:z.string().min(1).max(128),newPassword:password}).strict().parse(request.body);
    if(input.currentPassword===input.newPassword)throw new HttpError(400,'SAME_PASSWORD','Scegli una password diversa.');
    const result=await transaction(pool,async db=>{
      const user=(await db.query(`SELECT * FROM ${t('users')} WHERE id=$1 FOR UPDATE`,[request.staff!.id])).rows[0];
      if(!user.active||!await verifyPassword(input.currentPassword,user.password_hash))throw new HttpError(400,'WRONG_PASSWORD','La password attuale non è corretta.');
      await db.query(`UPDATE ${t('users')} SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2`,[await hashPassword(input.newPassword),user.id]);
      await db.query(`DELETE FROM ${t('sessions')} WHERE user_id=$1`,[user.id]);
      const csrfToken=await auth.issueSession(db,user.id,reply);
      await audit(db,config.schema,user.id,'auth.password_changed',user.id);
      return {csrfToken,user:{...request.staff,must_change_password:false}};
    });return result;
  });
}
