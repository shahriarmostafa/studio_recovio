import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {randomBytes} from 'node:crypto';
import type {Pool} from './db.js';
import {tables,transaction} from './db.js';
import type {Config} from './config.js';
import {security,audit,HttpError,digest} from './security.js';
import {applicationInput,listQuery,statuses,uuid} from './validation.js';

export async function applicationRoutes(app:FastifyInstance,pool:Pool,config:Config){
  const t=tables(config.schema),auth=security(pool,config);
  app.post('/api/public/applications',{config:{rateLimit:{max:5,timeWindow:'10 minutes'}}},async(request,reply)=>{
    if(!config.applicationsEnabled)throw new HttpError(503,'INTAKE_DISABLED','Le richieste online non sono ancora attive.');
    if(!request.headers.origin||![config.portalOrigin,...config.websiteOrigins].includes(request.headers.origin))throw new HttpError(403,'ORIGIN_REJECTED','Origine non consentita.');
    const input=applicationInput.parse(request.body);
    if(input.sito)throw new HttpError(400,'INVALID_REQUEST','Richiesta non valida.');
    const key=uuid.parse(request.headers['idempotency-key']);
    const {sito,...payload}=input;
    const hash=digest(JSON.stringify(payload)),reference='RCV-'+randomBytes(6).toString('hex').toUpperCase();
    const result=await transaction(pool,async db=>{
      const inserted=await db.query(`INSERT INTO ${t('applications')}(reference,payload,idempotency_key,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id,reference`,[reference,JSON.stringify(payload),key,hash]);
      if(inserted.rowCount){await audit(db,config.schema,null,'application.received',inserted.rows[0].id);return {reference:inserted.rows[0].reference,created:true};}
      const previous=(await db.query(`SELECT reference,payload_hash FROM ${t('applications')} WHERE idempotency_key=$1`,[key])).rows[0];
      if(previous.payload_hash!==hash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT','La richiesta è cambiata. Ricarica il modulo e riprova.');
      return {reference:previous.reference,created:false};
    });return reply.code(result.created?201:200).send({reference:result.reference,message:'Richiesta ricevuta. Lo studio ti contatterà per concordare giorno e ora.'});
  });
  app.get('/api/dashboard',{preHandler:auth.staff},async request=>{
    const doctor=request.staff!.role==='doctor'?request.staff!.id:null;
    const counts=(await pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='new')::int AS new,count(*) FILTER(WHERE status='in_review')::int AS in_review,count(*) FILTER(WHERE status='contacted')::int AS contacted,count(*) FILTER(WHERE status='closed')::int AS closed,count(*) FILTER(WHERE assigned_doctor_id IS NULL AND status<>'closed')::int AS unassigned FROM ${t('applications')} WHERE ($1::uuid IS NULL OR assigned_doctor_id=$1)`,[doctor])).rows[0];return {counts};
  });
  app.get('/api/applications',{preHandler:auth.staff},async request=>{
    const query=listQuery.parse(request.query),doctor=request.staff!.role==='doctor'?request.staff!.id:null;
    const where=`($1::uuid IS NULL OR a.assigned_doctor_id=$1) AND ($2::text IS NULL OR a.status=$2) AND ($3::boolean=false OR a.assigned_doctor_id IS NULL)`;
    const values=[doctor,query.status??null,query.assignment==='unassigned'];
    const rows=(await pool.query(`SELECT a.id,a.reference,a.status,a.version,a.created_at,a.updated_at,a.assigned_doctor_id,u.name AS doctor_name,a.payload->>'nome' AS name,a.payload->>'tipo' AS type,a.payload->>'servizio' AS service FROM ${t('applications')} a LEFT JOIN ${t('users')} u ON u.id=a.assigned_doctor_id WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT $4 OFFSET $5`,[...values,query.limit,(query.page-1)*query.limit])).rows;
    const total=(await pool.query(`SELECT count(*)::int AS n FROM ${t('applications')} a WHERE ${where}`,values)).rows[0].n;
    return {applications:rows,total,page:query.page,limit:query.limit};
  });
  app.get('/api/applications/:id',{preHandler:auth.staff},async request=>{
    const id=uuid.parse((request.params as {id:string}).id),doctor=request.staff!.role==='doctor'?request.staff!.id:null;
    const row=(await pool.query(`SELECT a.id,a.reference,a.payload,a.status,a.version,a.created_at,a.updated_at,a.assigned_doctor_id,u.name AS doctor_name FROM ${t('applications')} a LEFT JOIN ${t('users')} u ON u.id=a.assigned_doctor_id WHERE a.id=$1 AND ($2::uuid IS NULL OR a.assigned_doctor_id=$2)`,[id,doctor])).rows[0];
    if(!row)throw new HttpError(404,'NOT_FOUND','Richiesta non trovata.');
    await audit(pool,config.schema,request.staff!.id,'application.viewed',id);
    return {application:row};
  });
  app.patch('/api/applications/:id',{preHandler:auth.staff},async request=>{
    const id=uuid.parse((request.params as {id:string}).id),doctor=request.staff!.role==='doctor'?request.staff!.id:null;
    const input=z.object({status:z.enum(statuses),version:z.number().int().min(1)}).strict().parse(request.body);
    return transaction(pool,async db=>{
      const row=(await db.query(`SELECT status,version FROM ${t('applications')} WHERE id=$1 AND ($2::uuid IS NULL OR assigned_doctor_id=$2) FOR UPDATE`,[id,doctor])).rows[0];
      if(!row)throw new HttpError(404,'NOT_FOUND','Richiesta non trovata.');
      if(row.version!==input.version)throw new HttpError(409,'STALE_VERSION','La richiesta è stata aggiornata. Ricarica i dettagli prima di salvare.');
      const result=await db.query(`UPDATE ${t('applications')} SET status=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING version`,[input.status,id]);
      await audit(db,config.schema,request.staff!.id,'application.status_changed',id,{from:row.status,to:input.status});return {version:result.rows[0].version};
    });
  });
  app.put('/api/applications/:id/assignment',{preHandler:auth.admin},async request=>{
    const id=uuid.parse((request.params as {id:string}).id);
    const input=z.object({doctorId:uuid.nullable(),version:z.number().int().min(1)}).strict().parse(request.body);
    return transaction(pool,async db=>{
      // Lock the doctor first, consistently with account deactivation.
      if(input.doctorId){
        const doctor=await db.query(`SELECT id FROM ${t('users')} WHERE id=$1 AND role='doctor' AND active=true FOR UPDATE`,[input.doctorId]);
        if(!doctor.rowCount)throw new HttpError(400,'INVALID_DOCTOR','Seleziona un professionista attivo.');
      }
      const row=(await db.query(`SELECT version FROM ${t('applications')} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if(!row)throw new HttpError(404,'NOT_FOUND','Richiesta non trovata.');
      if(row.version!==input.version)throw new HttpError(409,'STALE_VERSION','La richiesta è stata aggiornata. Ricarica i dettagli prima di salvare.');
      const result=await db.query(`UPDATE ${t('applications')} SET assigned_doctor_id=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING version`,[input.doctorId,id]);
      await audit(db,config.schema,request.staff!.id,'application.assigned',id,{doctorId:input.doctorId});return {version:result.rows[0].version};
    });
  });
}
