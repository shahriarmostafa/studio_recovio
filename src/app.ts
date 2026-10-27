import Fastify, {LogController} from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import {fileURLToPath} from 'node:url';
import {ZodError} from 'zod';
import type {Config} from './config.js';
import {createPool,type Pool} from './db.js';
import {authRoutes} from './auth-routes.js';
import {adminRoutes} from './admin-routes.js';
import {applicationRoutes} from './application-routes.js';
import {HttpError} from './security.js';

export async function buildApp(config:Config,options:{pool?:Pool;logger?:boolean;rateLimit?:boolean}={}){
  const pool=options.pool??createPool(config);
  const app=Fastify({logger:options.logger===false?false:{level:'info',redact:['req.headers.cookie','req.headers.authorization','res.headers["set-cookie"]'],serializers:{req:r=>({method:r.method,url:r.url?.split('?')[0],id:r.id})}},logController:new LogController({disableRequestLogging:true}),bodyLimit:16384,trustProxy:config.trustProxy,requestTimeout:20000});
  pool.on('error',()=>app.log.error('Database pool connection failed'));
  app.decorateRequest('staff',null);app.decorateRequest('sessionHash',null);
  await app.register(cookie);
  await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],fontSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],frameAncestors:["'none'"],formAction:["'self'"],upgradeInsecureRequests:config.production?[]:null}}});
  await app.register(cors,{origin:[config.portalOrigin,...config.websiteOrigins],credentials:false,methods:['GET','POST','PUT','PATCH','OPTIONS'],allowedHeaders:['Content-Type','X-CSRF-Token','Idempotency-Key']});
  await app.register(rateLimit,{global:options.rateLimit!==false,max:120,timeWindow:'1 minute',skipOnError:false,allowList:options.rateLimit===false?()=>true:undefined});
  app.addHook('onSend',async(request,reply,payload)=>{
    reply.header('X-Robots-Tag','noindex, nofollow');
    if(request.url.startsWith('/api/'))reply.header('Cache-Control','no-store');
    return payload;
  });
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ZodError)return reply.code(400).send({error:'INVALID_INPUT',message:'Controlla i campi inseriti.',fields:[...new Set(error.issues.map(i=>i.path.join('.')))]});
    if(error instanceof HttpError)return reply.code(error.statusCode).send({error:error.code,message:error.message});
    if((error as {code?:string}).code==='23505')return reply.code(409).send({error:'CONFLICT',message:'Esiste già un account con questa email.'});
    const code=(error as {statusCode?:number}).statusCode??500;
    if(code>=500)app.log.error({requestId:request.id,errorCode:(error as {code?:string}).code??'INTERNAL'},'Request failed');
    return reply.code(code>=400&&code<600?code:500).send({error:code===429?'RATE_LIMIT':'REQUEST_FAILED',message:code===429?'Troppi tentativi. Attendi prima di riprovare.':code>=500?'Servizio temporaneamente non disponibile. Riprova.':'Richiesta non valida.'});
  });
  app.get('/health',async()=>({status:'ok'}));
  app.get('/ready',async(request,reply)=>{try{await pool.query('SELECT 1');return {status:'ready'};}catch{return reply.code(503).send({status:'unavailable'});}});
  app.get('/api/config',async()=>({websiteUrl:config.websiteUrl}));
  await authRoutes(app,pool,config);await adminRoutes(app,pool,config);await applicationRoutes(app,pool,config);
  await app.register(staticFiles,{root:fileURLToPath(new URL('../public/',import.meta.url)),prefix:'/',index:'index.html',maxAge:0});
  for(const route of ['/login','/admin','/doctor'])app.get(route,async(request,reply)=>reply.sendFile('index.html'));
  app.setNotFoundHandler((request,reply)=>reply.code(404).send({error:'NOT_FOUND',message:'Pagina non trovata.'}));
  app.addHook('onClose',async()=>{if(!options.pool)await pool.end();});
  return app;
}
