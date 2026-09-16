(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const localDate = () => new Intl.DateTimeFormat("en-CA", { timeZone:"America/Santiago", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
  const shift = (date, n) => new Date(Date.parse(date + "T12:00:00Z") + n * 86400000).toISOString().slice(0,10);
  const dateLabel = d => new Date(d + "T12:00:00Z").toLocaleDateString("es-CL", {day:"numeric",month:"short",timeZone:"UTC"});
  const monday = date => shift(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
  const fmt = (v, digits=1) => v == null ? "—" : Number(v).toFixed(digits);
  const hours = v => v == null ? "—" : `${Math.floor(Math.round(v*60)/60)}:${String(Math.round(v*60)%60).padStart(2,"0")}`;
  const best = e => { const marks=e.attempts.map(a=>a.distance).filter(v=>v!=null); return marks.length ? Math.max(...marks) : null; };
  const wind = w => w == null ? "viento no registrado" : `${w > 0 ? "+" : ""}${w.toFixed(1)} m/s`;
  let entries=[], selected=null, week=monday(localDate()), windowSize=14, days=window.dashboardDays || [], requestId=0;
  const cache = new Map();
  async function api(path, options={}) {
    const token = new URLSearchParams(location.search).get("token");
    const url = new URL(path, location.origin);
    if(token) url.searchParams.set("token",token);
    const response = await fetch(url,options);
    if(!response.ok) throw new Error(response.status===401 ? "Sesión no autorizada. Revisa el token del dashboard." : `No se pudo completar la solicitud (${response.status}).`);
    return response.json();
  }
  const competitions = () => entries.filter(e=>e.kind==="competition").sort((a,b)=>a.date.localeCompare(b.date));
  const sessions = date => entries.filter(e=>e.kind==="training" && e.date===date);
  function renderCompetitions() {
    const all=competitions();
    if(!selected || !all.some(e=>e.id===selected)) selected=all.at(-1)?.id;
    $("competition-list").innerHTML=all.length ? all.map(e=>`<button class="record competition-pick" data-event="${e.id}" aria-pressed="${e.id===selected}"><small>${dateLabel(e.date)} ${e.date.slice(0,4)} · ${esc(e.discipline)}</small><strong>${fmt(best(e),2)} m</strong><span>${esc(e.title)}</span><small>${e.bestOnly ? "Solo mejor marca" : `${e.attempts.length} intentos registrados`}</small></button>`).join("") : '<p class="hint">Registra tu primera competencia para ver cómo llegaste.</p>';
    $("competition-list").querySelectorAll("[data-event]").forEach(b=>b.onclick=()=>{selected=b.dataset.event;renderCompetitions();});
    renderDetail();
    markCalendar();
  }
  async function eventDays(event) {
    const key=event.date+":"+windowSize;
    if(!cache.has(key)) cache.set(key,api(`/api/days?start=${shift(event.date,-windowSize)}&end=${event.date}`).catch(error=>{cache.delete(key);throw error;}));
    return cache.get(key);
  }
  function summary(event, data) {
    const prior=data.filter(d=>d.date<event.date), n=windowSize;
    const mean=field=>{const vs=prior.map(d=>d[field]).filter(v=>v!=null);return {v:vs.length?vs.reduce((a,b)=>a+b,0)/vs.length:null,n:vs.length};};
    const cell=(field,unit,format=v=>fmt(v))=>{const m=mean(field);return `${format(m.v)}${m.v==null?"":unit} <small>(${m.n}/${n} días)</small>`;};
    const onDay=data.find(d=>d.date===event.date);
    const done=entries.filter(e=>e.kind==="training" && e.status==="Realizado" && e.date>=shift(event.date,-n) && e.date<event.date);
    return `<tr><td>${dateLabel(event.date)} · ${fmt(best(event),2)} m</td><td>${cell("sleepHours"," h",hours)}</td><td>${cell("recovery","%")}</td><td>${cell("hrv"," ms")}</td><td>${cell("strain","")}</td><td>${fmt(onDay?.recovery,0)}%</td><td>${done.length} registradas</td></tr>`;
  }
  async function renderDetail() {
    const seq=++requestId, event=competitions().find(e=>e.id===selected), el=$("competition-detail");
    if(!event){el.innerHTML="";return;}
    el.innerHTML=`<div class="section-heading"><h3>${esc(event.title)} · ${dateLabel(event.date)}</h3><button id="edit-event">Editar resultado</button></div>
      <div class="scroll-table"><table><thead><tr><th>${event.bestOnly?"Registro":"Intento"}</th><th>Distancia</th><th>Viento</th></tr></thead><tbody>${event.attempts.map((a,i)=>`<tr><td>${event.bestOnly?"Mejor marca":i+1}</td><td>${a.distance==null?"Nulo":fmt(a.distance,2)+" m"}</td><td>${wind(a.wind)}</td></tr>`).join("")}</tbody></table></div>
      <p class="event-note">${esc(event.notes)}</p>
      <div class="journal-controls"><label>Días previos<select id="event-window"><option value="7" ${windowSize===7?"selected":""}>7 días</option><option value="14" ${windowSize===14?"selected":""}>14 días</option></select></label>
      <label>Comparar con<select id="compare-event"><option value="">Sin comparación</option>${competitions().filter(e=>e.id!==event.id&&e.discipline===event.discipline).map(e=>`<option value="${e.id}">${dateLabel(e.date)} · ${fmt(best(e),2)} m</option>`).join("")}</select></label></div>
      <p class="hint">Los promedios excluyen el día de competencia. Cada métrica muestra su cobertura. Las diferencias ayudan a explorar asociaciones; no explican por sí solas una marca.</p>
      <div id="event-analysis" role="status">Cargando los días previos…</div>`;
    $("edit-event").onclick=()=>openForm("competition",event);
    $("event-window").onchange=e=>{windowSize=Number(e.target.value);renderDetail();};
    $("compare-event").onchange=()=>drawAnalysis();
    async function drawAnalysis() {
      const compareId=$("compare-event")?.value;
      const other=competitions().find(e=>e.id===compareId);
      $("event-analysis").textContent="Cargando los días previos…";
      try {
        const [data, otherData]=await Promise.all([eventDays(event),other?eventDays(other):Promise.resolve([])]);
        if(seq!==requestId || $("compare-event")?.value!==compareId)return;
        $("event-analysis").innerHTML=`<div class="scroll-table"><table><thead><tr><th>Competencia</th><th>Sueño previo</th><th>Recovery previo</th><th>HRV previo</th><th>Strain previo</th><th>Recovery al competir</th><th>Sesiones previas</th></tr></thead><tbody>${summary(event,data)}${other?summary(other,otherData):""}</tbody></table></div>
          <div class="grid-2"><div><h4>Sueño previo · horas</h4><div id="event-sleep-chart"></div></div><div><h4>Recovery · %</h4><div id="event-recovery-chart"></div></div></div>
          <p class="hint">D−${windowSize} → D0 (competencia) · línea verde: ${dateLabel(event.date)}${other?` · línea gris: ${dateLabel(other.date)}`:""}</p>
          <div class="scroll-table"><table><thead><tr><th>Día</th><th>Fecha</th><th>Sueño</th><th>Recovery</th><th>HRV</th><th>Strain</th><th>Bitácora</th></tr></thead><tbody>${Array.from({length:windowSize+1},(_,i)=>{
            const relative=i-windowSize,date=shift(event.date,relative),d=data.find(d=>d.date===date);
            return `<tr><td>${relative===0?"D0 · Competencia":"D"+relative}</td><td>${dateLabel(date)}</td><td>${hours(d?.sleepHours)}</td><td>${fmt(d?.recovery,0)}</td><td>${fmt(d?.hrv)}</td><td>${fmt(d?.strain)}</td><td>${sessions(date).map(s=>`${esc(s.type)} · ${esc(s.status)}${s.rpe?` · RPE ${s.rpe}`:""}`).join("<br>")||"Sin registro"}</td></tr>`;
          }).join("")}</tbody></table></div>`;
        relativeChart($("event-sleep-chart"),event,data,other,otherData,"sleepHours",12);
        relativeChart($("event-recovery-chart"),event,data,other,otherData,"recovery",100);
      } catch(error){if(seq===requestId) {$("event-analysis").textContent=error.message+" ";const retry=document.createElement("button");retry.textContent="Reintentar";retry.onclick=drawAnalysis;$("event-analysis").append(retry);}}
    }
    drawAnalysis();
  }
  function relativeChart(el,event,data,other,otherData,field,max) {
    max=Math.max(max,...[...data,...otherData].map(d=>d[field]??0));
    const W=480,H=155,left=28,right=12,top=12,bottom=26;
    const x=i=>left+i/windowSize*(W-left-right), y=v=>H-bottom-v/max*(H-top-bottom);
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${field==='recovery'?'Recovery':'Sueño'} en días relativos a la competencia">`;
    for(const v of [0,max/2,max]) svg+=`<line x1="${left}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="2" y="${y(v)+3}">${v}</text>`;
    for(const i of [0,Math.floor(windowSize/2),windowSize])svg+=`<text x="${x(i)}" y="${H-5}" text-anchor="middle">D${i-windowSize}</text>`;
    for(const [e,ds,color] of [[event,data,"var(--series-1)"],[other,otherData,"var(--muted)"]]){
      if(!e)continue;let previous=null;
      for(let i=0;i<=windowSize;i++){
        const d=ds.find(d=>d.date===shift(e.date,i-windowSize)),v=d?.[field];
        if(v==null){previous=null;continue;}
        if(previous)svg+=`<line x1="${previous.x}" y1="${previous.y}" x2="${x(i)}" y2="${y(v)}" stroke="${color}" stroke-width="2"/>`;
        svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${color}"><title>${dateLabel(d.date)}: ${fmt(v)}</title></circle>`;
        previous={x:x(i),y:y(v)};
      }
    }
    el.innerHTML=svg+"</svg>";
  }
  function renderWeek() {
    $("week-label").textContent=`${dateLabel(week)} – ${dateLabel(shift(week,6))} ${week.slice(0,4)}`;
    const all=entries.filter(e=>e.kind==="training"&&e.date>=week&&e.date<=shift(week,6)),done=all.filter(e=>e.status==="Realizado");
    $("week-summary").textContent=`${all.filter(e=>e.status==="Planificado").length} planificadas · ${done.length} realizadas · ${done.reduce((s,e)=>s+(e.minutes||0),0)} min registrados`;
    $("training-week").innerHTML=Array.from({length:7},(_,i)=>{
      const date=shift(week,i),name=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"][i];
      return `<div class="training-day"><h3>${name} ${dateLabel(date)}</h3>${competitions().filter(e=>e.date===date).map(e=>`<small>🏁 ${esc(e.discipline)} · ${fmt(best(e),2)} m</small>`).join("")}${sessions(date).map(s=>`<button data-session="${s.id}" class="${s.status==="Planificado"?"planned":""}">${esc(s.type)}<small>${esc(s.status)}${s.minutes!=null?` · ${s.minutes} min`:""}${s.rpe!=null?` · RPE ${s.rpe}`:""}</small></button>`).join("")}<button data-new-date="${date}" aria-label="Agregar sesión el ${date}">+</button></div>`;
    }).join("");
    $("training-week").querySelectorAll("[data-session]").forEach(b=>b.onclick=()=>openForm("training",entries.find(e=>e.id===b.dataset.session)));
    $("training-week").querySelectorAll("[data-new-date]").forEach(b=>b.onclick=()=>openForm("training",null,b.dataset.newDate));
  }
  function renderSleep() {
    const count=Number($("sleep-range").value), last=days.at(-1)?.date;
    if(!last){$("sleep-schedule").textContent="Sin datos de sueño disponibles.";return;}
    const rows=Array.from({length:count},(_,i)=>{const date=shift(last,i-count+1);return days.find(d=>d.date===date)||{date};});
    const clock=value=>new Intl.DateTimeFormat("es-CL",{timeZone:"America/Santiago",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value));
    const position=value=>{
      const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
      const get=t=>parts.find(p=>p.type===t).value;
      return {date:`${get("year")}-${get("month")}-${get("day")}`,hour:Number(get("hour"))+Number(get("minute"))/60};
    };
    const coverage=rows.filter(d=>d.sleepStart&&d.sleepEnd).length;
    $("sleep-schedule").innerHTML=`<p class="hint">${coverage}/${count} noches con horarios · ventana de 18:00 del día anterior a 18:00 del día indicado. Pasa sobre una barra para ver el intervalo completo.</p><div class="sleep-row"><span></span><div class="sleep-axis"><span>18:00</span><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span></div><span></span></div>`+rows.map(d=>{
      if(!d.sleepStart||!d.sleepEnd)return `<div class="sleep-row"><span>${dateLabel(d.date)}</span><span class="muted">Sin horario registrado</span></div>`;
      const s=position(d.sleepStart),e=position(d.sleepEnd),start=(Date.parse(s.date)-Date.parse(d.date))/86400000*24+s.hour+6,end=(Date.parse(e.date)-Date.parse(d.date))/86400000*24+e.hour+6;
      const l=Math.max(0,Math.min(24,start)),r=Math.max(l,Math.min(24,end));
      const label=`${s.date} ${clock(d.sleepStart)} → ${e.date} ${clock(d.sleepEnd)} · sueño efectivo ${hours(d.sleepHours)} h`;
      return `<div class="sleep-row"><span>${dateLabel(d.date)}${competitions().some(e=>e.date===d.date)?" 🏁":""}</span><div class="sleep-track" title="${esc(label)}" role="img" aria-label="${esc(label)}"><span class="sleep-bar" style="left:${l/24*100}%;width:${(r-l)/24*100}%"></span></div><small>${clock(d.sleepStart)}–${clock(d.sleepEnd)}${start<0||end>24?" *":""}</small></div>`;
    }).join("");
  }
  function markCalendar() {
    document.querySelectorAll("#heatmap [data-date]").forEach(cell=>{
      const event=competitions().find(e=>e.date===cell.dataset.date);
      cell.classList.toggle("has-milestone",Boolean(event));
      if(!event){cell.removeAttribute("tabindex");cell.removeAttribute("role");cell.removeAttribute("aria-label");cell.onclick=null;cell.onkeydown=null;return;}
      cell.tabIndex=0;cell.setAttribute("role","button");cell.setAttribute("aria-label",`Competencia ${dateLabel(event.date)}: ${fmt(best(event),2)} m`);
      cell.onclick=()=>{selected=event.id;renderCompetitions();$("milestones").scrollIntoView({behavior:"smooth"});};
      cell.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();cell.click();}};
    });
    let strip=$("calendar-milestones");
    if(!strip){strip=document.createElement("div");strip.id="calendar-milestones";strip.className="journal journal-controls";$("heatmap").after(strip);}
    strip.innerHTML=competitions().filter(e=>days.some(d=>d.date===e.date)).map(e=>`<button data-event="${e.id}">🏁 ${dateLabel(e.date)} · ${fmt(best(e),2)} m</button>`).join("");
    strip.querySelectorAll("button").forEach(b=>b.onclick=()=>{selected=b.dataset.event;renderCompetitions();$("milestones").scrollIntoView({behavior:"smooth"});});
  }
  const options=(values,current)=>values.map(v=>`<option ${v===current?"selected":""}>${esc(v)}</option>`).join("");
  function openForm(kind,entry=null,date=localDate()) {
    const e=entry||{date,discipline:"Largo",type:"Pista",status:"Planificado",attempts:[]};
    $("entry-error").textContent="";
    $("entry-fields").innerHTML=`<h2>${entry?"Editar":"Registrar"} ${kind==="competition"?"competencia":"sesión"}</h2><div class="form-grid"><label>Fecha<input name="date" type="date" required value="${esc(e.date)}"></label>${kind==="competition"?`<label>Prueba<select name="discipline">${options(["Largo","Triple"],e.discipline)}</select></label><label>Nombre<input name="title" maxlength="120" required value="${esc(e.title||"Competencia")}"></label><label>Registro<select name="bestOnly"><option value="false" ${!e.bestOnly?"selected":""}>Intentos</option><option value="true" ${e.bestOnly?"selected":""}>Solo mejor marca</option></select></label>`:`<label>Trabajo<select name="type">${options(["Pista","Fuerza","Técnica","Movilidad","Descanso"],e.type)}</select></label><label>Estado<select name="status">${options(["Planificado","Realizado"],e.status)}</select></label><label>Duración (min)<input name="minutes" type="number" min="0" max="600" step="1" value="${e.minutes??""}"></label><label>Esfuerzo percibido (1–10)<input name="rpe" type="number" min="1" max="10" step="1" value="${e.rpe??""}"><small>1 muy fácil · 10 máximo. Déjalo vacío si aún no entrenaste.</small></label>`}</div>
      ${kind==="competition"?`<p class="hint">Distancia en metros o X para nulo. Viento opcional; 0 significa sin viento. Deja vacíos los intentos no registrados.</p>${Array.from({length:6},(_,i)=>`<div class="attempt-row"><span>${i+1}</span><input name="distance${i}" aria-label="Distancia intento ${i+1}" placeholder="6.20 o X" value="${e.attempts[i]?(e.attempts[i].distance??"X"):""}"><input name="wind${i}" aria-label="Viento intento ${i+1}" placeholder="Viento m/s" type="number" min="-20" max="20" step="0.1" value="${e.attempts[i]?.wind??""}"></div>`).join("")}`:""}
      <label>Notas<textarea name="notes" maxlength="3000" placeholder="${kind==="competition"?"Sensaciones, condiciones, técnica…":"Ejercicios, series × repeticiones × kg, saltos, sprints y sensaciones…"}">${esc(e.notes||"")}</textarea></label>`;
    const form=$("entry-form");
    if(kind==="competition"){
      const update=()=>form.querySelectorAll(".attempt-row").forEach((row,i)=>{const hidden=form.elements.bestOnly.value==="true"&&i>0;row.hidden=hidden;row.style.display=hidden?"none":"";row.querySelectorAll("input").forEach(input=>input.disabled=hidden);});
      form.elements.bestOnly.onchange=update;update();
    }
    form.onsubmit=async ev=>{
      ev.preventDefault();const f=new FormData(form), number=name=>f.get(name)===""?null:Number(f.get(name));
      const result={id:entry?.id||crypto.randomUUID(),kind,date:f.get("date"),notes:f.get("notes")};
      try {
        if(kind==="competition"){
          Object.assign(result,{title:f.get("title"),discipline:f.get("discipline"),bestOnly:f.get("bestOnly")==="true",attempts:[]});
          for(let i=0;i<(result.bestOnly?1:6);i++){
            const raw=String(f.get("distance"+i)||"").trim().replace(",",".");
            if(!raw){if(f.get("wind"+i))throw new Error(`Falta la distancia del intento ${i+1}.`);continue;}
            const distance=raw.toUpperCase()==="X"?null:Number(raw);
            if(distance!==null&&(!Number.isFinite(distance)||distance<=0||distance>25))throw new Error(`Revisa la distancia del intento ${i+1}.`);
            result.attempts.push({distance,wind:number("wind"+i)});
          }
          if(!result.attempts.length)throw new Error("Registra al menos una marca o un intento nulo.");
        }else Object.assign(result,{type:f.get("type"),status:f.get("status"),minutes:number("minutes"),rpe:number("rpe")});
        const button=form.querySelector('[type="submit"]');button.disabled=true;
        try {const saved=await api("/api/journal",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(result)});entries=saved.entries;}finally{button.disabled=false;}
        if(kind==="competition")selected=result.id;else week=monday(result.date);
        $("entry-dialog").close();renderCompetitions();renderWeek();renderSleep();
      }catch(error){$("entry-error").textContent=error.message;}
    };
    $("entry-dialog").showModal();
  }
  $("entry-cancel").onclick=()=>$("entry-dialog").close();
  $("add-competition").onclick=()=>openForm("competition");
  $("add-training").onclick=()=>openForm("training");
  $("week-prev").onclick=()=>{week=shift(week,-7);renderWeek();};
  $("week-next").onclick=()=>{week=shift(week,7);renderWeek();};
  $("week-today").onclick=()=>{week=monday(localDate());renderWeek();};
  $("sleep-range").onchange=renderSleep;
  window.addEventListener("dashboard-days",e=>{days=e.detail;renderSleep();markCalendar();});
  window.addEventListener("dashboard-calendar",markCalendar);
  async function init(){
    try {entries=(await api("/api/journal")).entries;$("journal-status").textContent="Guardado local · hitos y sesiones independientes del rango de Whoop";renderCompetitions();renderWeek();renderSleep();}
    catch(error){$("journal-status").textContent=error.message+" ";const b=document.createElement("button");b.textContent="Reintentar";b.onclick=init;$("journal-status").append(b);}
  }
  init();
})();
