const $=(s,root=document)=>root.querySelector(s);
const app=$('#app'),modal=$('#modal');
const state={user:null,csrf:null,view:'requests',page:1,status:'',assignment:'all',doctors:[],website:'',load:0};
const statusNames={new:'Nuova',in_review:'In lavorazione',contacted:'Contattata',closed:'Chiusa'};
const typeNames={consulto:'Primo consulto',servizio:'Appuntamento',informazioni:'Informazioni',noleggio:'Noleggio'};
const serviceNames={'fisioterapia':'Fisioterapia','osteopatia':'Osteopatia','terapie-fisiche':'Terapie fisiche','valutazione-oggettiva':'Valutazione oggettiva','non-so':'Da consigliare'};
const peopleNames={'giorgio-cardoni':'Giorgio Cardoni','elisa-coppolino':'Elisa Coppolino','philippe-mancinelli':'Philippe Mancinelli'};
const actions={'auth.login':'Accesso all’area riservata','auth.password_changed':'Password personale aggiornata','admin.bootstrapped':'Amministratore creato','doctor.created':'Account professionista creato','doctor.updated':'Account professionista aggiornato','doctor.deactivated':'Account professionista disattivato','doctor.password_reset':'Password temporanea generata','application.received':'Nuova richiesta ricevuta','application.viewed':'Dettagli richiesta consultati','application.status_changed':'Stato della richiesta aggiornato','application.assigned':'Assegnazione aggiornata'};
const paths={inbox:'M4 4h16v16H4z M4 13h4l2 3h4l2-3h4',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',arrow:'M5 12h14 M13 6l6 6-6 6',out:'M9 5H4v14h5 M12 12h9 M17 8l4 4-4 4',lock:'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',activity:'M3 12h4l3-8 4 16 3-8h4',close:'M6 6l12 12 M18 6 6 18',plus:'M12 5v14 M5 12h14',back:'M19 12H5 M11 6l-6 6 6 6'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.arrow}"/></svg>`;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'short',year:'numeric',timeZone:'Europe/Rome'}).format(new Date(value));
const initials=name=>name.split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase();
const badge=status=>`<span class="badge ${esc(status)}">${esc(statusNames[status]||status)}</span>`;
let noticeTimer,returnFocus;
function notice(message,error=false){const el=$('#notice');el.textContent=message;el.classList.toggle('is-error',error);el.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{el.hidden=true;},6500);}
async function api(path,{method='GET',body}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(state.csrf?{'X-CSRF-Token':state.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    if(!response.ok){
      if(response.status===401&&path!=='/auth/login'&&state.user){state.user=null;state.csrf=null;state.load++;closeModal();renderLogin();}
      if(data.error==='PASSWORD_CHANGE_REQUIRED'&&state.user){state.user.must_change_password=true;state.view='password';closeModal();shell();}
      const error=new Error(data.message||'Il servizio non è disponibile.');error.status=response.status;throw error;
    }return data;
  }catch(error){if(error.name==='AbortError')throw new Error('Il server sta impiegando troppo tempo. Riprova.');throw error;}
  finally{clearTimeout(timer);}
}
async function submitForm(form,task){
  const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  const error=$('.form-error',form);if(error)error.textContent='';
  try{await task(new FormData(form));}
  catch(e){if(error){error.textContent=e.message;error.focus();}else notice(e.message,true);}
  finally{buttons.forEach(b=>b.disabled=false);}
}
const errorBox='<p class="form-error" role="alert" tabindex="-1"></p>';
function passwordField(name,label,autocomplete='current-password',min=1){return `<label class="field">${label}<span class="password-field"><input name="${name}" type="password" autocomplete="${autocomplete}" required minlength="${min}" maxlength="128"><button type="button" class="password-toggle" aria-label="Mostra ${label.toLowerCase()}" aria-pressed="false">Mostra</button></span></label>`;}
document.addEventListener('click',event=>{const toggle=event.target.closest('.password-toggle');if(toggle){const input=toggle.previousElementSibling,show=input.type==='password';input.type=show?'text':'password';toggle.textContent=show?'Nascondi':'Mostra';toggle.setAttribute('aria-pressed',String(show));}});
function renderLogin(){
  state.load++;history.replaceState(null,'','/login');document.title='Accedi · Studio Recovio';
  app.innerHTML=`<main id="main" class="login"><section class="login-story"><a href="${esc(state.website||'#')}" class="brand">Studio Recovio <i></i></a><div><p class="eyebrow">AREA RISERVATA ALLO STUDIO</p><h1>Prendersi cura.<br/>A partire<br/>dall’ascolto.</h1><p class="story-copy">Uno spazio condiviso per seguire le richieste e accompagnare ogni persona al suo prossimo passo.</p></div><footer>LA TUA SALUTE, IL NOSTRO IMPEGNO.</footer></section><section class="login-form-wrap"><p class="eyebrow">BENTORNATO</p><h2>Il tuo spazio di lavoro.</h2><p class="muted">Accedi con l’account dello studio.<br/>Le persone, prima di tutto.</p><form id="login-form"><label class="field">Email professionale<input name="email" type="email" autocomplete="username" required maxlength="254" placeholder="nome@studio.it"></label>${passwordField('password','Password')}${errorBox}<button class="btn" type="submit">Accedi all’area riservata ${icon('arrow')}</button></form><p class="login-help">Non hai un account o hai dimenticato la password?<br/>Rivolgiti all’amministratore dello studio.</p><a class="login-return" href="${esc(state.website||'#')}">${icon('back')} Torna al sito dello studio</a></section></main>`;
  $('#login-form').addEventListener('submit',event=>{event.preventDefault();void submitForm(event.currentTarget,async data=>{const result=await api('/auth/login',{method:'POST',body:Object.fromEntries(data)});state.user=result.user;state.csrf=result.csrfToken;state.view=result.user.must_change_password?'password':'requests';shell();});});
}
function shell(){
  if(!state.user)return renderLogin();
  const admin=state.user.role==='admin';if(state.user.must_change_password)state.view='password';
  history.replaceState(null,'',admin?'/admin':'/doctor');
  document.title=(admin?'Pannello amministratore':'Le mie richieste')+' · Studio Recovio';
  const nav=state.user.must_change_password?[['password','lock','Imposta password']]:[['requests','inbox',admin?'Richieste':'Le mie richieste'],...(admin?[['doctors','users','Professionisti'],['activity','activity','Attività']]:[]),['password','lock','Il mio account']];
  app.innerHTML=`<div class="workspace"><aside class="sidebar"><a class="brand" href="${esc(state.website)}">Studio Recovio <i></i></a><p class="workspace-label">${admin?'Pannello amministratore':'Area professionisti'}</p><nav class="side-nav" aria-label="Area riservata">${nav.map(([id,mark,label])=>`<button data-nav="${id}" ${state.view===id?'aria-current="page"':''}>${icon(mark)}${label}</button>`).join('')}</nav><div class="sidebar-bottom"><a class="website-link" href="${esc(state.website)}">${icon('out')}Vai al sito dello studio</a><div class="identity"><span class="avatar">${esc(initials(state.user.name))}</span><div><strong>${esc(state.user.name)}</strong><small>${admin?'Amministratore':'Professionista'}</small></div></div><button class="logout" id="logout">${icon('out')}Esci</button></div></aside><main class="workspace-main" id="main"><div class="topline"><span><i class="live-dot"></i>Studio Recovio / Area riservata</span><span>${date(new Date())}</span></div><div id="content" aria-live="polite"></div></main></div>`;
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.nav;state.page=1;state.status='';state.assignment='all';shell();}));
  $('#logout').addEventListener('click',async event=>{event.currentTarget.disabled=true;try{await api('/auth/logout',{method:'POST'});state.user=null;state.csrf=null;renderLogin();}catch(e){notice(e.message,true);if($('#logout'))$('#logout').disabled=false;}});
  void loadView();
}
function heading(eyebrow,title,description,action=''){return `<header class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div>${action}</header>`;}
function empty(title,copy,mark='inbox'){return `<div class="empty"><span class="empty-mark">${icon(mark)}</span><h3>${title}</h3><p>${copy}</p></div>`;}
async function loadView(){
  const load=++state.load,view=state.view,root=$('#content');if(!root)return;
  root.innerHTML='<p class="loading" role="status">Caricamento in corso…</p>';
  try{
    if(view==='password'){renderPassword(root);return;}
    if(view==='requests'){
      const query=new URLSearchParams({page:String(state.page),assignment:state.assignment});if(state.status)query.set('status',state.status);
      const [dashboard,list]=await Promise.all([api('/dashboard'),api('/applications?'+query)]);
      if(load!==state.load)return;renderRequests(root,dashboard.counts,list);
    }else if(view==='doctors'){
      const data=await api('/admin/doctors');if(load!==state.load)return;state.doctors=data.doctors;renderDoctors(root);
    }else if(view==='activity'){
      const data=await api('/admin/audit?page='+state.page);if(load!==state.load)return;renderActivity(root,data);
    }
  }catch(error){if(load===state.load&&root.isConnected){root.innerHTML=`<div class="refresh-error" role="alert"><p>${esc(error.message)}</p><button class="btn secondary" id="retry">Riprova</button></div>`;$('#retry').onclick=()=>void loadView();}}
}
function renderRequests(root,counts,list){
  const admin=state.user.role==='admin';
  root.innerHTML=heading(admin?'LE PERSONE, PRIMA DI TUTTO':'IL TUO SPAZIO DI CURA',admin?'Ogni percorso inizia qui.':'Le tue richieste.',admin?'Una visione d’insieme delle richieste. Assegna ogni persona al professionista che la seguirà.':'Le richieste che lo studio ti ha affidato, raccolte in un unico spazio.')+
  `<section class="stats" aria-label="Riepilogo richieste">${[['Nuove richieste',counts.new],['In lavorazione',counts.in_review],[admin?'Da assegnare':'Contattate',admin?counts.unassigned:counts.contacted],['Richieste totali',counts.total]].map(([title,count])=>`<div class="stat"><span>${title}</span><strong>${count}</strong></div>`).join('')}</section><section class="panel"><div class="panel-heading"><h2>${admin?'Tutte le richieste':'Richieste assegnate'}</h2><div class="filters"><label>Stato<select id="status-filter"><option value="">Tutti gli stati</option>${Object.entries(statusNames).map(([id,label])=>`<option value="${id}" ${state.status===id?'selected':''}>${label}</option>`).join('')}</select></label>${admin?`<label>Assegnazione<select id="assignment-filter"><option value="all">Tutte</option><option value="unassigned" ${state.assignment==='unassigned'?'selected':''}>Da assegnare</option></select></label>`:''}</div></div>${list.applications.length?`<div class="requests">${list.applications.map(r=>`<button class="request" data-request="${r.id}" aria-label="Apri richiesta di ${esc(r.name)}"><div><strong class="request-name">${esc(r.name)}</strong><small>${date(r.created_at)} · ${esc(r.reference)}</small></div><div><span class="request-type">${esc(typeNames[r.type])}</span><small>${esc(serviceNames[r.service]||'Da concordare con lo studio')}</small></div><div>${badge(r.status)}<br/><small class="${r.doctor_name?'':'assignment-note'}">${esc(r.doctor_name||'Da assegnare')}</small></div>${icon('arrow')}</button>`).join('')}</div>`:empty('Tutto pronto per il prossimo passo.',state.status||state.assignment!=='all'?'Non ci sono richieste con questi filtri.':admin?'Le richieste inviate dal sito appariranno qui. Potrai aprirle e assegnarle a un professionista.':'Quando l’amministratore ti assegnerà una richiesta, la troverai qui.')}<div class="pager"><span>${list.total} richieste · Pagina ${list.page}</span><div class="row"><button id="previous" ${state.page===1?'disabled':''}>Precedente</button><button id="next" ${list.page*list.limit>=list.total?'disabled':''}>Successiva</button></div></div></section><p class="footnote">Una richiesta è il primo contatto: giorno e ora dell’appuntamento vanno concordati con la persona.</p>`;
  $('#status-filter').onchange=e=>{state.status=e.target.value;state.page=1;void loadView();};
  if($('#assignment-filter'))$('#assignment-filter').onchange=e=>{state.assignment=e.target.value;state.page=1;void loadView();};
  $('#previous').onclick=()=>{state.page--;void loadView();};$('#next').onclick=()=>{state.page++;void loadView();};
  root.querySelectorAll('[data-request]').forEach(button=>button.onclick=()=>void openRequest(button.dataset.request));
}
function openModal(html){returnFocus=document.activeElement;modal.innerHTML=html;if(!modal.open)modal.showModal();document.body.style.overflow='hidden';$('.close',modal)?.focus();$('.close',modal)?.addEventListener('click',closeModal);}
function closeModal(){if(modal.open)modal.close();modal.replaceChildren();document.body.style.overflow='';if(returnFocus?.isConnected)returnFocus.focus();}
modal.addEventListener('cancel',event=>{event.preventDefault();closeModal();});
const modalHead=(eyebrow,title)=>`<header class="modal-head"><div><p class="eyebrow">${eyebrow}</p><h2 id="modal-title">${title}</h2></div><button class="close" aria-label="Chiudi">${icon('close')}</button></header>`;
async function openRequest(id){
  openModal(modalHead('RICHIESTA','Caricamento…')+'<div class="loading">Preparazione dei dettagli…</div>');
  try{
    const [data,doctors]=await Promise.all([api('/applications/'+id),state.user.role==='admin'?api('/admin/doctors'):Promise.resolve({doctors:[]})]);
    if(!modal.open)return;
    const r=data.application,p=r.payload,admin=state.user.role==='admin';
    const field=(title,value,wide=false)=>`<div ${wide?'class="wide"':''}><dt>${title}</dt><dd>${esc(value||'Non indicato')}</dd></div>`;
    modal.innerHTML=modalHead(esc(r.reference),esc(p.nome))+`<div class="modal-body">${badge(r.status)}<dl class="detail-grid">${field('Telefono',p.telefono)}${field('Email',p.email)}${field('Contatto preferito',p.contatto)}${field('Ricevuta il',date(r.created_at))}${field('Richiesta',typeNames[p.tipo])}${field('Servizio',serviceNames[p.servizio])}${field('Professionista preferito',peopleNames[p.professionista])}${field('Dove',({studio:'In studio',casa:'A casa, da discutere',indifferente:'Nessuna preferenza'})[p.dove])}${field('Giorni preferiti',p.giorni?.join(', '))}${field('Momento della giornata',p.subito?'Il prima possibile':p.fasce?.join(', '))}${p.perAltraPersona?field('Richiesta per',p.perAltraPersona,true):''}${p.tipo==='noleggio'?field('Dispositivo',p.dispositivo)+field('Periodo',p.periodo):''}</dl>${p.note?`<p class="eyebrow">NOTE DELLA PERSONA</p><p class="detail-note">${esc(p.note)}</p>`:''}<p class="footnote">Preferenze da concordare. Informativa privacy accettata al momento dell’invio.</p>${admin?`<section class="detail-control"><h3>Chi seguirà questa richiesta?</h3><form id="assign-form"><label class="field">Professionista<select name="doctorId"><option value="">Da assegnare</option>${doctors.doctors.filter(d=>d.active||d.id===r.assigned_doctor_id).map(d=>`<option value="${d.id}" ${r.assigned_doctor_id===d.id?'selected':''} ${!d.active?'disabled':''}>${esc(d.name)}${!d.active?' (non attivo)':''}</option>`).join('')}</select></label><button type="submit" class="btn">Assegna</button>${errorBox}</form></section>`:`<p class="footnote">Assegnata a ${esc(r.doctor_name)}</p>`}<section class="detail-control"><h3>A che punto siamo?</h3><form id="status-form"><label class="field">Stato della richiesta<select name="status">${Object.entries(statusNames).map(([key,name])=>`<option value="${key}" ${key===r.status?'selected':''}>${name}</option>`).join('')}</select></label><button type="submit" class="btn">Salva stato</button>${errorBox}</form></section></div>`;
    $('.close',modal).onclick=closeModal;$('.close',modal).focus();
    $('#status-form').onsubmit=event=>{event.preventDefault();void submitForm(event.currentTarget,async data=>{const result=await api('/applications/'+id,{method:'PATCH',body:{status:data.get('status'),version:r.version}});r.version=result.version;notice('Stato aggiornato.');closeModal();void loadView();});};
    if(admin)$('#assign-form').onsubmit=event=>{event.preventDefault();void submitForm(event.currentTarget,async data=>{const result=await api('/applications/'+id+'/assignment',{method:'PUT',body:{doctorId:data.get('doctorId')||null,version:r.version}});r.version=result.version;notice('Assegnazione aggiornata.');closeModal();void loadView();});};
  }catch(error){if(modal.open){modal.innerHTML=modalHead('RICHIESTA','Non disponibile')+`<div class="modal-body"><p role="alert">${esc(error.message)}</p></div>`;$('.close',modal).onclick=closeModal;}}
}
function renderDoctors(root){
  root.innerHTML=heading('IL TEAM DELLO STUDIO','Le persone che curano.','Crea gli accessi del team e gestisci chi può ricevere le richieste.','<button class="btn" id="new-doctor">'+icon('plus')+'Aggiungi professionista</button>')+
  (state.doctors.length?`<div class="doctor-grid">${state.doctors.map(d=>`<article class="doctor-card"><div class="doctor-card-header"><span class="avatar">${esc(initials(d.name))}</span><div><h2>${esc(d.name)}</h2><p>${esc(d.email)}</p></div></div><div class="row"><span class="badge">${d.active?(d.must_change_password?'Primo accesso da completare':'Account attivo'):'Account non attivo'}</span><button class="text-button" data-doctor="${d.id}">Gestisci account</button></div></article>`).join('')}</div>`:'<section class="panel">'+empty('Il tuo team prende forma.','Aggiungi il primo professionista. Riceverai una password temporanea da condividere personalmente.','users')+'</section>')+'<p class="footnote">Solo l’amministratore crea gli account. Ogni professionista vede esclusivamente le richieste assegnate.</p>';
  $('#new-doctor').onclick=()=>editDoctor();root.querySelectorAll('[data-doctor]').forEach(b=>b.onclick=()=>editDoctor(state.doctors.find(d=>d.id===b.dataset.doctor)));
}
function showCredentials(email,password){
  modal.innerHTML=modalHead('ACCOUNT PRONTO','Un accesso, personale.')+`<div class="modal-body"><p>Condividi queste credenziali direttamente con il professionista. Al primo accesso dovrà impostare una nuova password.</p><div class="credential-box"><p>Email<br/><strong>${esc(email)}</strong></p><p>Password temporanea, mostrata solo ora</p><code>${esc(password)}</code><button class="btn secondary" id="copy-password">Copia password</button></div><p>Nessuna email è stata inviata automaticamente.</p><button class="btn" id="done">Ho salvato le credenziali ${icon('arrow')}</button></div>`;
  $('.close',modal).onclick=closeModal;$('#done').onclick=closeModal;
  $('#copy-password').onclick=async()=>{try{await navigator.clipboard.writeText(password);notice('Password copiata.');}catch{notice('Seleziona la password e copiala manualmente.',true);}};
  $('#done').focus();
}
function editDoctor(doctor){
  openModal(modalHead('GESTIONE TEAM',doctor?'Gestisci account':'Un nuovo professionista')+`<div class="modal-body"><form id="doctor-form"><label class="field">Nome e cognome<input name="name" autocomplete="name" required minlength="2" maxlength="100" value="${esc(doctor?.name||'')}"></label><label class="field">Email professionale<input name="email" type="email" autocomplete="email" required maxlength="254" value="${esc(doctor?.email||'')}"></label>${doctor?`<label class="check-label"><input type="checkbox" name="active" ${doctor.active?'checked':''}>Account attivo</label><p class="footnote">Le modifiche chiudono le sessioni aperte. Disattivando l’account, le richieste restano visibili all’amministratore e possono essere riassegnate.</p>`:'<p class="footnote">Genereremo una password temporanea. Il professionista dovrà cambiarla al primo accesso.</p>'}${errorBox}<button class="btn" type="submit">${doctor?'Salva account':'Crea account'} ${icon('arrow')}</button></form>${doctor?'<div class="modal-actions"><button class="btn secondary" id="reset-password">Genera nuova password temporanea</button></div>':''}</div>`);
  $('#doctor-form').onsubmit=event=>{event.preventDefault();void submitForm(event.currentTarget,async data=>{
    const payload={name:data.get('name'),email:data.get('email')};if(doctor)payload.active=data.has('active');
    const result=await api('/admin/doctors'+(doctor?'/'+doctor.id:''),{method:doctor?'PATCH':'POST',body:payload});
    if(doctor){notice('Account aggiornato.');closeModal();}else showCredentials(result.doctor.email,result.temporaryPassword);
    void loadView();
  });};
  if(doctor)$('#reset-password').onclick=async event=>{
    if(!confirm('Generare una nuova password? Le sessioni attive verranno chiuse e la password precedente non funzionerà più.'))return;
    const button=event.currentTarget;button.disabled=true;
    try{const result=await api('/admin/doctors/'+doctor.id+'/reset-password',{method:'POST'});showCredentials(doctor.email,result.temporaryPassword);void loadView();}catch(error){notice(error.message,true);button.disabled=false;}
  };
}
function renderPassword(root){
  const required=state.user.must_change_password;
  root.innerHTML=heading('UN ACCESSO PERSONALE',required?'Cominciamo dalla tua password.':'Il tuo account.',required?'Per il primo accesso, sostituisci la password temporanea con una conosciuta solo da te.':esc(state.user.email))+`<section class="panel settings"><h2>${required?'Imposta la nuova password':'Cambia password'}</h2><p>Usa almeno 12 caratteri. Puoi scegliere una frase lunga e facile da ricordare. Il salvataggio chiude le altre sessioni del tuo account.</p><form id="password-form">${passwordField('currentPassword',required?'Password temporanea':'Password attuale')}${passwordField('newPassword','Nuova password','new-password',12)}${passwordField('confirmPassword','Conferma nuova password','new-password',12)}${errorBox}<button type="submit" class="btn">${required?'Salva ed entra':'Aggiorna password'} ${icon('arrow')}</button></form></section>`;
  $('#password-form').onsubmit=event=>{event.preventDefault();void submitForm(event.currentTarget,async data=>{
    if(data.get('newPassword')!==data.get('confirmPassword'))throw new Error('Le due password non coincidono.');
    const result=await api('/auth/password',{method:'POST',body:{currentPassword:data.get('currentPassword'),newPassword:data.get('newPassword')}});state.user=result.user;state.csrf=result.csrfToken;state.view='requests';shell();notice('Password aggiornata. Benvenuto nel tuo spazio.');
  });};
}
function renderActivity(root,data){
  root.innerHTML=heading('UNO STUDIO, UN LAVORO CONDIVISO','Le attività dello studio.','Accessi e aggiornamenti, per sapere chi ha fatto cosa.')+`<section class="panel">${data.events.length?data.events.map(e=>`<div class="activity-row"><div><strong>${esc(actions[e.action]||e.action)}</strong><small>${esc(e.actor_name||'Richiesta dal sito')}${e.metadata?.to?' · '+esc(statusNames[e.metadata.to]||e.metadata.to):''}</small></div><time datetime="${esc(e.created_at)}">${date(e.created_at)} · ${new Intl.DateTimeFormat('it-IT',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}).format(new Date(e.created_at))}</time></div>`).join(''):empty('Nessuna attività da mostrare.','Gli aggiornamenti verranno raccolti qui.','activity')}<div class="pager"><span>Pagina ${state.page}</span><div class="row"><button id="previous" ${state.page===1?'disabled':''}>Precedente</button><button id="next" ${data.events.length<50?'disabled':''}>Successiva</button></div></div></section>`;
  $('#previous').onclick=()=>{state.page--;void loadView();};$('#next').onclick=()=>{state.page++;void loadView();};
}
async function start(){
  try{const config=await api('/config');state.website=config.websiteUrl;const session=await api('/auth/me');state.user=session.user;state.csrf=session.csrfToken;shell();}
  catch(error){if(error.status===401)renderLogin();else{app.innerHTML='<main id="main" class="boot"><span class="brand">Studio Recovio <i></i></span><p role="alert">Non riusciamo a collegarci allo studio.</p><button class="btn" id="reconnect">Riprova</button></main>';$('#reconnect').onclick=start;}}
}
window.addEventListener('pageshow',event=>{if(event.persisted)void start();});
void start();
