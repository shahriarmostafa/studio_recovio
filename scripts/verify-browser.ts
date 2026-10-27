import {chromium,webkit,type Page,type BrowserContext} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {readConfig} from '../src/config.js';
import {createPool,tables,transaction} from '../src/db.js';
import {hashPassword} from '../src/security.js';

const config=readConfig(),pool=createPool(config),table=tables(config.schema);
assert.equal(config.production,false,'Browser verification uses local servers and synthetic data only.');
assert.equal(config.portalOrigin,'http://localhost:4000');
const tag='browser-'+randomUUID().slice(0,8),email=tag+'@example.test',doctorEmail=tag+'-doctor@example.test',patientEmail=tag+'-patient@example.test';
const adminPassword='Synthetic administrator password 123!',doctorPassword='Synthetic doctor password 123!';
const folder='verification/browser-'+new Date().toISOString().slice(0,10);await mkdir(folder,{recursive:true});
const contexts:BrowserContext[]=[],errors:string[]=[],checks:unknown[]=[];
const chrome=await chromium.launch({channel:'chrome',headless:true});
let safari:Awaited<ReturnType<typeof webkit.launch>>|undefined;
async function context(browser=chrome,viewport={width:1440,height:1000},isMobile=false){const c=await browser.newContext({viewport,isMobile,hasTouch:isMobile,recordVideo:{dir:folder+'/motion'}});contexts.push(c);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));return {c,p};}
async function login(p:Page,address:string,password:string){await p.goto(config.portalOrigin+'/login');await p.getByLabel('Email professionale').fill(address);await p.locator('[name=password]').fill(password);await p.getByRole('button',{name:'Accedi all’area riservata'}).click();}
async function verifyLayout(p:Page,label:string){
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');
  const result=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  checks.push({label,violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});
  await p.screenshot({path:folder+'/'+label+'.png',fullPage:true});
  assert.equal(result.violations.length,0,JSON.stringify(checks.at(-1)));
}
try{
  await pool.query(`INSERT INTO ${table('users')}(email,name,role,password_hash,must_change_password) VALUES($1,'Amministratore di prova','admin',$2,false)`,[email,await hashPassword(adminPassword)]);
  const {p:admin}=await context();
  await admin.goto(config.portalOrigin+'/login');await admin.getByRole('heading',{name:'Il tuo spazio di lavoro.'}).waitFor();await verifyLayout(admin,'desktop-login');
  await login(admin,email,adminPassword);await admin.getByRole('heading',{name:'Ogni percorso inizia qui.'}).waitFor();await verifyLayout(admin,'desktop-empty-dashboard');
  await admin.getByRole('button',{name:'Professionisti',exact:true}).click();await admin.getByRole('button',{name:'Aggiungi professionista'}).click();
  await admin.getByLabel('Nome e cognome').fill('Professionista di prova');await admin.getByLabel('Email professionale').fill(doctorEmail);
  await admin.getByRole('button',{name:'Crea account',exact:true}).click();await admin.getByRole('heading',{name:'Un accesso, personale.'}).waitFor();
  const initialPassword=(await admin.locator('.credential-box code').textContent())!;
  await admin.getByRole('button',{name:'Ho salvato le credenziali'}).click();await admin.getByRole('heading',{name:'Professionista di prova',exact:true}).waitFor();await verifyLayout(admin,'desktop-doctors');
  // Real exported public-site form → Fastify → Neon, using only a synthetic applicant.
  const {p:publicPage}=await context();await publicPage.addInitScript(()=>localStorage.setItem('recovio-light','true'));
  await publicPage.goto('http://localhost:3003/prenota');await publicPage.locator('.booking-form[data-guided=true]').waitFor();
  await publicPage.locator('.booking-progress button').nth(3).click();
  await publicPage.getByLabel('Nome e cognome *',{exact:true}).fill('Persona di prova backend');
  await publicPage.getByLabel('Telefono *',{exact:true}).fill('+39 000 000 0000');
  await publicPage.locator('#email').fill(patientEmail);await publicPage.locator('#note').fill('Verifica sintetica del flusso; nessun appuntamento reale.');await publicPage.locator('#privacy').check();
  await publicPage.getByRole('button',{name:'Invia la richiesta'}).click();await publicPage.getByRole('heading',{name:'Richiesta inviata',exact:true}).waitFor({timeout:30000});
  const receipt=await publicPage.locator('.booking-sent .eyebrow').textContent();assert.match(receipt!,/RCV-[A-F0-9]{12}/);await publicPage.screenshot({path:folder+'/public-form-receipt.png',fullPage:true});
  await admin.getByRole('button',{name:'Richieste',exact:true}).click();await admin.getByRole('button',{name:'Apri richiesta di Persona di prova backend'}).click();
  await admin.locator('#assign-form select').selectOption({label:'Professionista di prova'});await admin.getByRole('button',{name:'Assegna',exact:true}).click();await admin.locator('#modal').waitFor({state:'hidden'});
  await admin.getByRole('button',{name:'Apri richiesta di Persona di prova backend'}).waitFor();await verifyLayout(admin,'desktop-assigned-dashboard');
  const {p:doctor}=await context(chrome,{width:390,height:844},true);await login(doctor,doctorEmail,initialPassword);
  await doctor.getByRole('heading',{name:'Cominciamo dalla tua password.'}).waitFor();
  await doctor.locator('[name=currentPassword]').fill(initialPassword);await doctor.locator('[name=newPassword]').fill(doctorPassword);await doctor.locator('[name=confirmPassword]').fill(doctorPassword);
  await doctor.getByRole('button',{name:'Salva ed entra'}).click();await doctor.getByRole('heading',{name:'Le tue richieste.'}).waitFor();await verifyLayout(doctor,'phone-doctor-dashboard');
  assert.equal(await doctor.getByRole('button',{name:'Professionisti',exact:true}).count(),0);
  await doctor.getByRole('button',{name:'Apri richiesta di Persona di prova backend'}).click();await doctor.getByRole('heading',{name:'Persona di prova backend'}).waitFor();await verifyLayout(doctor,'phone-request-detail');
  await doctor.locator('#status-form select').selectOption('contacted');await doctor.getByRole('button',{name:'Salva stato'}).click();await doctor.locator('#modal').waitFor({state:'hidden'});await doctor.locator('.request .badge').filter({hasText:'Contattata'}).waitFor();
  await doctor.reload();await doctor.getByRole('heading',{name:'Le tue richieste.'}).waitFor();assert.equal(await doctor.locator('.request .badge').textContent(),'Contattata');
  await doctor.getByRole('button',{name:'Esci',exact:true}).click();await doctor.getByRole('heading',{name:'Il tuo spazio di lavoro.'}).waitFor();
  await doctor.setViewportSize({width:320,height:740});await verifyLayout(doctor,'small-phone-login');
  const {p:phoneAdmin}=await context(chrome,{width:390,height:844},true);await login(phoneAdmin,email,adminPassword);await phoneAdmin.getByRole('heading',{name:'Ogni percorso inizia qui.'}).waitFor();await verifyLayout(phoneAdmin,'phone-admin-dashboard');
  await phoneAdmin.getByRole('button',{name:'Professionisti',exact:true}).click();await phoneAdmin.getByRole('heading',{name:'Le persone che curano.'}).waitFor();await verifyLayout(phoneAdmin,'phone-doctors');
  await admin.getByRole('button',{name:'Attività',exact:true}).click();await admin.getByRole('heading',{name:'Le attività dello studio.'}).waitFor();await verifyLayout(admin,'desktop-activity');
  safari=await webkit.launch({headless:true});const {p:mac}=await context(safari,{width:1280,height:900});await login(mac,email,adminPassword);await mac.getByRole('heading',{name:'Ogni percorso inizia qui.'}).waitFor();await verifyLayout(mac,'webkit-desktop-dashboard');
  await mac.getByRole('button',{name:'Apri richiesta di Persona di prova backend'}).click();await mac.getByRole('heading',{name:'Persona di prova backend'}).waitFor();await mac.keyboard.press('Escape');assert.equal(await mac.locator('#modal').isVisible(),false);
  assert.deepEqual(errors,[]);checks.push({fullWorkflow:'passed',publicForm:'persisted in Neon; assigned by admin; doctor updated status',pageErrors:errors});
}finally{
  await writeFile(folder+'/checks.json',JSON.stringify(checks,null,2));
  for(const c of contexts)await c.close();await chrome.close();await safari?.close();
  await transaction(pool,async db=>{
    const accounts=(await db.query(`SELECT id FROM ${table('users')} WHERE email=ANY($1::text[])`,[[email,doctorEmail]])).rows.map(r=>r.id);
    const applications=(await db.query(`SELECT id FROM ${table('applications')} WHERE payload->>'email'=$1`,[patientEmail])).rows.map(r=>r.id);
    await db.query(`DELETE FROM ${table('audit_events')} WHERE actor_id=ANY($1::uuid[]) OR target_id=ANY($1::uuid[]) OR target_id=ANY($2::uuid[])`,[accounts,applications]);
    await db.query(`DELETE FROM ${table('applications')} WHERE id=ANY($1::uuid[])`,[applications]);
    await db.query(`DELETE FROM ${table('users')} WHERE id=ANY($1::uuid[])`,[accounts]);
  });await pool.end();
}
console.log('Browser verification passed; synthetic users, requests and audit records removed. Evidence: '+folder);
