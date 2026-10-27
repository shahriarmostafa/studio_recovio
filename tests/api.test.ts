import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readConfig} from '../src/config.js';
import {createPool,tables} from '../src/db.js';
import {migrate} from '../src/migrate.js';
import {buildApp} from '../src/app.js';
import {hashPassword} from '../src/security.js';

test('Postgres-backed staff, intake, session and authorization flows',async t=>{
  const schema='recovio_test_'+randomUUID().replaceAll('-','');
  const config={...readConfig(),schema,portalOrigin:'http://localhost:4001',websiteOrigins:['http://localhost:3003'],applicationsEnabled:true};
  const pool=createPool(config),table=tables(schema);
  const adminPassword='Integration admin password 123!';
  let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  try{
    await migrate(pool,schema);await migrate(pool,schema);
    const adminId=(await pool.query(`INSERT INTO ${table('users')}(email,name,role,password_hash,must_change_password) VALUES($1,'Test Admin','admin',$2,false) RETURNING id`,['admin@example.test',await hashPassword(adminPassword)])).rows[0].id;
    app=await buildApp(config,{pool,logger:false,rateLimit:false});await app.ready();
    type Session={cookie:string;csrf:string};
    const call=(method:string,url:string,body?:unknown,session?:Session,headers:Record<string,string>={})=>app!.inject({method:method as 'GET',url,payload:body as string,headers:{origin:config.portalOrigin,...(session?{cookie:session.cookie,'x-csrf-token':session.csrf}:{}),...headers}});
    const sessionFrom=(r:Awaited<ReturnType<typeof call>>)=>({cookie:String(r.headers['set-cookie']).split(';')[0]!,csrf:r.json().csrfToken});
    async function login(email:string,password:string){const r=await call('POST','/api/auth/login',{email,password});assert.equal(r.statusCode,200,r.body);return sessionFrom(r);}
    let admin=await login('admin@example.test',adminPassword);
    await t.test('No public sign-up, no unauthenticated data, TLS/database ready, no-store',async()=>{
      assert.equal((await call('GET','/ready')).statusCode,200);
      assert.equal((await call('GET','/api/applications')).statusCode,401);
      assert.equal((await call('POST','/api/auth/register',{})).statusCode,404);
      assert.equal((await call('GET','/api/auth/me',undefined,admin)).headers['cache-control'],'no-store');
      const me=await call('GET','/api/auth/me',undefined,admin);assert.equal(me.json().user.role,'admin');assert.equal(me.body.includes('password_hash'),false);
    });
    await t.test('Origin, CSRF, credential errors and role overposting rejected',async()=>{
      assert.equal((await call('POST','/api/auth/login',{email:'admin@example.test',password:adminPassword},undefined,{origin:'https://evil.example'})).statusCode,403);
      assert.equal((await call('POST','/api/admin/doctors',{email:'bad@example.test',name:'Bad Account'},admin,{'x-csrf-token':'wrong'})).statusCode,403);
      assert.equal((await call('POST','/api/admin/doctors',{email:'bad@example.test',name:'Bad Account',role:'admin'},admin)).statusCode,400);
      assert.equal((await call('POST','/api/auth/login',{email:'admin@example.test',password:'wrong'})).statusCode,401);
      assert.equal((await call('POST','/api/auth/login',{email:'absent@example.test',password:'wrong'})).json().message,'Email o password non valide.');
    });
    const created=await call('POST','/api/admin/doctors',{email:'doctor@example.test',name:'Test Doctor'},admin);
    assert.equal(created.statusCode,201,created.body);const doctorId=created.json().doctor.id,temp=created.json().temporaryPassword;
    let doctor=await login('doctor@example.test',temp);
    const second=await call('POST','/api/admin/doctors',{email:'other@example.test',name:'Other Doctor'},admin);
    const otherId=second.json().doctor.id;let other=await login('other@example.test',second.json().temporaryPassword);
    await t.test('First login requires password change; rotation revokes previous session',async()=>{
      assert.equal((await call('GET','/api/applications',undefined,doctor)).json().error,'PASSWORD_CHANGE_REQUIRED');
      assert.equal((await call('POST','/api/auth/password',{currentPassword:temp,newPassword:'short'},doctor)).statusCode,400);
      const changed=await call('POST','/api/auth/password',{currentPassword:temp,newPassword:'Doctor personal password 123!'},doctor);assert.equal(changed.statusCode,200,changed.body);
      assert.equal((await call('GET','/api/auth/me',undefined,doctor)).statusCode,401);doctor=sessionFrom(changed);
      const changedOther=await call('POST','/api/auth/password',{currentPassword:second.json().temporaryPassword,newPassword:'Other doctor password 123!'},other);other=sessionFrom(changedOther);
      assert.equal((await call('GET','/api/admin/doctors',undefined,doctor)).statusCode,403);
      assert.equal((await call('POST','/api/admin/doctors',{email:'x@example.test',name:'No Access'},doctor)).statusCode,403);
    });
    const payload={tipo:'consulto',servizio:'valutazione-oggettiva',nome:'Synthetic Test Person',telefono:'+39 000 000 0000',contatto:'email',email:'patient@example.test',giorni:['lun','gio'],fasce:['mattina'],privacy:true,professionista:'giorgio-cardoni',note:'Synthetic request only'};
    const key=randomUUID(),headers={'idempotency-key':key,origin:'http://localhost:3003'};
    let applicationId:string;
    await t.test('Intake validates consent, email, origin, honeypot and prevents duplicates',async()=>{
      assert.equal((await call('POST','/api/public/applications',{...payload,privacy:false},undefined,headers)).statusCode,400);
      assert.equal((await call('POST','/api/public/applications',{...payload,email:undefined},undefined,headers)).statusCode,400);
      assert.equal((await call('POST','/api/public/applications',{...payload,sito:'spam'},undefined,headers)).statusCode,400);
      assert.equal((await call('POST','/api/public/applications',payload,undefined,{...headers,origin:'https://evil.example'})).statusCode,403);
      assert.equal((await call('POST','/api/public/applications',{...payload,assigned_doctor_id:doctorId},undefined,headers)).statusCode,400);
      const responses=await Promise.all([call('POST','/api/public/applications',payload,undefined,headers),call('POST','/api/public/applications',payload,undefined,headers)]);
      assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,201]);assert.equal(responses[0]!.json().reference,responses[1]!.json().reference);
      assert.equal((await call('POST','/api/public/applications',{...payload,nome:'Changed'},undefined,headers)).statusCode,409);
      const rows=await pool.query(`SELECT * FROM ${table('applications')}`);assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].assigned_doctor_id,null);applicationId=rows.rows[0].id;
      const stored=(await call('GET','/api/applications/'+applicationId,undefined,admin)).json().application;assert.equal(stored.payload.note,payload.note);assert.equal(stored.payload_hash,undefined);
    });
    await t.test('Doctors see only assigned requests; admins assign and use version checks',async()=>{
      assert.equal((await call('GET','/api/applications',undefined,doctor)).json().total,0);
      assert.equal((await call('GET','/api/applications/'+applicationId,undefined,doctor)).statusCode,404);
      assert.equal((await call('PUT','/api/applications/'+applicationId+'/assignment',{doctorId,version:1},doctor)).statusCode,403);
      assert.equal((await call('PUT','/api/applications/'+applicationId+'/assignment',{doctorId:adminId,version:1},admin)).statusCode,400);
      assert.equal((await call('PUT','/api/applications/'+applicationId+'/assignment',{doctorId,version:1},admin)).statusCode,200);
      assert.equal((await call('GET','/api/applications',undefined,doctor)).json().total,1);
      assert.equal((await call('GET','/api/dashboard',undefined,other)).json().counts.total,0);
      assert.equal((await call('GET','/api/applications/'+applicationId,undefined,other)).statusCode,404);
      assert.equal((await call('PATCH','/api/applications/'+applicationId,{status:'closed',version:2},other)).statusCode,404);
      assert.equal((await call('PATCH','/api/applications/'+applicationId,{status:'in_review',version:1},doctor)).statusCode,409);
      assert.equal((await call('PATCH','/api/applications/'+applicationId,{status:'in_review',version:2},doctor)).statusCode,200);
      assert.equal((await call('PATCH','/api/applications/'+applicationId,{status:'closed',version:2},admin)).statusCode,409);
      assert.equal((await call('GET','/api/applications?status=in_review&limit=1',undefined,admin)).json().total,1);
      assert.equal((await call('GET','/api/applications?limit=50000',undefined,admin)).statusCode,400);
      const events=(await call('GET','/api/admin/audit',undefined,admin)).json().events;assert(events.some((e:{action:string})=>e.action==='application.assigned'));
    });
    await t.test('Reset/deactivation/reassignment revoke access and protect other roles',async()=>{
      const reset=await call('POST','/api/admin/doctors/'+doctorId+'/reset-password',undefined,admin);assert.equal(reset.statusCode,200);
      assert.equal((await call('GET','/api/auth/me',undefined,doctor)).statusCode,401);
      doctor=await login('doctor@example.test',reset.json().temporaryPassword);
      assert.equal((await call('GET','/api/applications',undefined,doctor)).json().error,'PASSWORD_CHANGE_REQUIRED');
      assert.equal((await call('PATCH','/api/admin/doctors/'+doctorId,{name:'Test Doctor',email:'doctor@example.test',active:false},admin)).statusCode,200);
      assert.equal((await call('GET','/api/auth/me',undefined,doctor)).statusCode,401);
      assert.equal((await call('PUT','/api/applications/'+applicationId+'/assignment',{doctorId,version:3},admin)).statusCode,400);
      assert.equal((await call('PUT','/api/applications/'+applicationId+'/assignment',{doctorId:otherId,version:3},admin)).statusCode,200);
      assert.equal((await call('GET','/api/applications/'+applicationId,undefined,other)).statusCode,200);
      assert.equal((await call('PATCH','/api/admin/doctors/'+adminId,{name:'Hack',email:'hack@example.test',active:false},admin)).statusCode,404);
      assert.equal((await call('GET','/api/admin/doctors',undefined,admin)).body.includes('password_hash'),false);
    });
    await t.test('Database account lockout persists and successful logout revokes cookie',async()=>{
      for(let i=0;i<10;i++)assert.equal((await call('POST','/api/auth/login',{email:'locked@example.test',password:'wrong'})).statusCode,401);
      assert.equal((await call('POST','/api/auth/login',{email:'locked@example.test',password:'wrong'})).statusCode,429);
      assert.equal((await call('POST','/api/auth/logout',undefined,admin)).statusCode,200);
      assert.equal((await call('GET','/api/auth/me',undefined,admin)).statusCode,401);
      admin=await login('admin@example.test',adminPassword);
      await pool.query(`UPDATE ${table('sessions')} SET expires_at=now()-interval '1 minute'`);
      assert.equal((await call('GET','/api/auth/me',undefined,admin)).statusCode,401);
    });
    await t.test('Production cookies, persistent sessions and intake disabled configuration',async()=>{
      const prod=await buildApp({...config,production:true,portalOrigin:'https://staff.example.test',applicationsEnabled:false},{pool,logger:false,rateLimit:false});
      try{
        const result=await prod.inject({method:'POST',url:'/api/auth/login',headers:{origin:'https://staff.example.test'},payload:{email:'admin@example.test',password:adminPassword}});
        assert.equal(result.statusCode,200);const cookie=String(result.headers['set-cookie']);assert(cookie.includes('__Host-recovio_session'));assert(cookie.includes('Secure'));assert(cookie.includes('HttpOnly'));assert(cookie.includes('SameSite=Lax'));
        assert.equal((await prod.inject({method:'POST',url:'/api/public/applications',payload})).statusCode,503);
      }finally{await prod.close();}
    });
    await t.test('Per-IP login rate limits are enforced',async()=>{
      const limited=await buildApp(config,{pool,logger:false});
      try{for(let i=0;i<10;i++)assert.equal((await limited.inject({method:'POST',url:'/api/auth/login',headers:{origin:config.portalOrigin},payload:{email:'rate@example.test',password:'wrong'}})).statusCode,401);
        assert.equal((await limited.inject({method:'POST',url:'/api/auth/login',headers:{origin:config.portalOrigin},payload:{email:'rate@example.test',password:'wrong'}})).statusCode,429);
      }finally{await limited.close();}
    });
  }finally{
    await app?.close();
    assert.match(schema,/^recovio_test_[a-f0-9]{32}$/);
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
