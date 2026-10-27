import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Pool} from './db.js';
import {tables,transaction} from './db.js';
import type {Config} from './config.js';
import {security,hashPassword,temporaryPassword,audit,HttpError,userColumns} from './security.js';
import {email,uuid} from './validation.js';

export async function adminRoutes(app:FastifyInstance,pool:Pool,config:Config){
  const auth=security(pool,config),t=tables(config.schema);
  app.get('/api/admin/doctors',{preHandler:auth.admin},async()=>({doctors:(await pool.query(`SELECT ${userColumns} FROM ${t('users')} WHERE role='doctor' ORDER BY name,id`)).rows}));
  app.post('/api/admin/doctors',{preHandler:auth.admin,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(request,reply)=>{
    const input=z.object({email,name:z.string().trim().min(2).max(100)}).strict().parse(request.body);
    const initialPassword=temporaryPassword(),hash=await hashPassword(initialPassword);
    const doctor=await transaction(pool,async db=>{
      const doctor=(await db.query(`INSERT INTO ${t('users')}(email,name,role,password_hash) VALUES($1,$2,'doctor',$3) RETURNING ${userColumns}`,[input.email,input.name,hash])).rows[0];
      await audit(db,config.schema,request.staff!.id,'doctor.created',doctor.id);return doctor;
    });return reply.code(201).send({doctor,temporaryPassword:initialPassword});
  });
  app.patch('/api/admin/doctors/:id',{preHandler:auth.admin},async request=>{
    const id=uuid.parse((request.params as {id:string}).id);
    const input=z.object({name:z.string().trim().min(2).max(100),email,active:z.boolean()}).strict().parse(request.body);
    return transaction(pool,async db=>{
      const old=(await db.query(`SELECT id FROM ${t('users')} WHERE id=$1 AND role='doctor' FOR UPDATE`,[id])).rows[0];
      if(!old)throw new HttpError(404,'NOT_FOUND','Professionista non trovato.');
      const doctor=(await db.query(`UPDATE ${t('users')} SET name=$1,email=$2,active=$3,updated_at=now() WHERE id=$4 RETURNING ${userColumns}`,[input.name,input.email,input.active,id])).rows[0];
      // Profile changes revoke sessions too; the next login uses the current account details.
      await db.query(`DELETE FROM ${t('sessions')} WHERE user_id=$1`,[id]);
      await audit(db,config.schema,request.staff!.id,input.active?'doctor.updated':'doctor.deactivated',id);return {doctor};
    });
  });
  app.post('/api/admin/doctors/:id/reset-password',{preHandler:auth.admin,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async request=>{
    const id=uuid.parse((request.params as {id:string}).id),initialPassword=temporaryPassword(),hash=await hashPassword(initialPassword);
    await transaction(pool,async db=>{
      const result=await db.query(`UPDATE ${t('users')} SET password_hash=$1,must_change_password=true,updated_at=now() WHERE id=$2 AND role='doctor' RETURNING id`,[hash,id]);
      if(!result.rowCount)throw new HttpError(404,'NOT_FOUND','Professionista non trovato.');
      await db.query(`DELETE FROM ${t('sessions')} WHERE user_id=$1`,[id]);
      await audit(db,config.schema,request.staff!.id,'doctor.password_reset',id);
    });return {temporaryPassword:initialPassword};
  });
  app.get('/api/admin/audit',{preHandler:auth.admin},async request=>{
    const query=z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).strict().parse(request.query);
    const rows=(await pool.query(`SELECT a.id,a.action,a.target_id,a.created_at,a.metadata,u.name AS actor_name FROM ${t('audit_events')} a LEFT JOIN ${t('users')} u ON a.actor_id=u.id ORDER BY a.id DESC LIMIT 50 OFFSET $1`,[(query.page-1)*50])).rows;
    return {events:rows,page:query.page};
  });
}
