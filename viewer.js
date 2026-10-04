'use strict';
const REPORT_SECTIONS = ['Visits','Customers','Station Usage','Station Rankings','Activity Logs','Login Logs','Reports'];
let reportRole = null, reportSection = null, reportGeneration = 0, reportTimer = null;
const deviceLabel = () => navigator.userAgent.slice(0,300);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function resetReportView() {
  reportGeneration++;
  clearInterval(reportTimer); reportTimer = null;
  clearInterval(dashboardRefreshTimer); dashboardRefreshTimer = null;
  reportRole = null; reportSection = null;
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('reports').hidden = true;
  document.getElementById('report-content').replaceChildren();
  document.getElementById('report-cards').replaceChildren();
  document.getElementById('stations').replaceChildren();
  document.getElementById('sales-total').textContent = '—';
}
async function enterAccount(eventName = 'Session resumed') {
  resetReportView();
  const generation = reportGeneration;
  let access;
  try { access = await sb.rpc('mf_report_role'); }
  catch (_) { access = {error:true}; }
  const {data:role,error} = access;
  if (generation !== reportGeneration) return;
  if (error || !['owner','operator','viewer'].includes(role)) {
    document.getElementById('login').style.display = 'block';
    document.getElementById('error').textContent = 'Account access is unavailable or disabled. Contact the owner.';
    return;
  }
  reportRole = role;
  if (role !== 'operator') {
    let logResult;
    try { logResult = await sb.rpc('mf_report_event',{p_action:eventName,p_device:deviceLabel()}); }
    catch (_) { logResult = {error:true}; }
    const {error:logError} = logResult;
    if (generation !== reportGeneration) return;
    if (logError) {
      resetReportView();
      document.getElementById('login').style.display = 'block';
      document.getElementById('error').textContent = 'Login could not be recorded. Please retry.';
      return;
    }
  }
  document.getElementById('login').style.display = 'none';
  document.getElementById('owner-reports').hidden = role !== 'owner';
  if (role === 'viewer') openReports();
  else await showDashboard();
}
function openReports() {
  if (!['owner','viewer'].includes(reportRole)) return;
  clearInterval(dashboardRefreshTimer);
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('reports').hidden = false;
  document.getElementById('owner-return').hidden = reportRole !== 'owner';
  document.getElementById('report-title').textContent = reportRole === 'viewer' ? 'Report Viewer' : 'Reports';
  const cards = document.getElementById('report-cards'); cards.replaceChildren();
  for (const name of REPORT_SECTIONS) {
    const button = el('button',name,'report-card');
    button.onclick = () => loadReport(name);
    cards.append(button);
  }
  document.getElementById('report-content').replaceChildren(el('p','Choose a section above.'));
  clearInterval(reportTimer);
  reportTimer = setInterval(() => { if(reportSection) loadReport(reportSection,false); },60000);
}
async function returnToOwner() {
  if (reportRole !== 'owner') return;
  reportGeneration++; clearInterval(reportTimer); reportSection = null;
  document.getElementById('reports').hidden = true;
  await showDashboard();
}
const labels = {
  recorded_sessions:'Recorded gaming sessions',known_customers:'Known customers',
  unknown_customer_sessions:'Sessions with unknown customers',new_known_customers:'New known customers',
  returning_known_customers:'Returning known customers',session_seconds:'Saved session time',
  revenue:'Gaming revenue (Rs.)',sessions:'Station sessions',average_seconds:'Average session',
  playing_seconds:'Measured playing time',idle_seconds:'Measured idle time',paused_seconds:'Measured paused time',
  measured_seconds:'Measured in-service time',utilization_percent:'Measured utilization',
  last_used:'Last known use',busiest_hour:'Busiest measured hour',modes:'Time by mode'
};
function display(key,value) {
  if (value === null || value === undefined) return 'Unknown';
  if (key.endsWith('seconds')) return formatDuration(Math.round(value));
  if (key === 'utilization_percent') return value+'%';
  if (key === 'busiest_hour') return String(value).padStart(2,'0')+':00–'+String((value+1)%24).padStart(2,'0')+':00';
  if (key === 'last_used') return new Date(value).toLocaleString('en-PK',{timeZone:'Asia/Karachi'});
  if (typeof value === 'number') return value.toLocaleString('en-PK',{maximumFractionDigits:2});
  if (typeof value === 'object') return JSON.stringify(value,null,2);
  return String(value);
}
function metrics(data, parent) {
  const list = el('dl',undefined,'metrics');
  for (const [key,value] of Object.entries(data)) {
    if (key === 'station' || key === 'modes') continue;
    list.append(el('dt',labels[key] || key.replaceAll('_',' ')),el('dd',display(key,value)));
  }
  parent.append(list);
  if (data.modes) {
    parent.append(el('h4','Solo / Duo / Trio (Treo) / Squad'));
    for (const [mode,seconds] of Object.entries(data.modes)) parent.append(el('p',mode+': '+formatDuration(Math.round(seconds))));
  }
}
function stationCards(stations,parent,metric='session_seconds') {
  const grid = el('div',undefined,'grid');
  for (const station of stations) {
    const card = el('details',undefined,'card');
    card.append(el('summary',station.station+' · '+display(metric,station[metric])+(metric==='revenue'?' Rs.':'')));
    metrics(station,card); grid.append(card);
  }
  parent.append(grid);
}
function eventCards(events,parent) {
  if (!events.length) parent.append(el('p','No recorded events in this period.'));
  for (const event of events) {
    const card = el('details',undefined,'card');
    const who = event.actor || event.account || event.account_name || 'Unknown account';
    const when = event.occurred_at || event.timestamp || event.date || 'Unknown time';
    card.append(el('summary',who+' · '+(event.action || event.event || 'Event')+' · '+when));
    card.append(el('p','Device: '+(event.device || 'Not recorded')));
    card.append(el('pre',JSON.stringify(event,null,2)));
    parent.append(card);
  }
}
async function loadReport(section,scroll=true) {
  if (!['owner','viewer'].includes(reportRole) || !REPORT_SECTIONS.includes(section)) return;
  reportSection = section;
  const generation = ++reportGeneration;
  const period = document.getElementById('report-period').value;
  const content = document.getElementById('report-content');
  content.replaceChildren(el('h2',section),el('p','Loading…'));
  if (scroll) content.scrollIntoView?.({behavior:'smooth',block:'start'});
  let result;
  try { result = await sb.rpc('mf_read_report',{p_section:section,p_period:period,p_device:deviceLabel()}); }
  catch (_) { result = {error:true}; }
  if (generation !== reportGeneration) return;
  content.replaceChildren(el('h2',section));
  if (result.error) {
    content.append(el('p','This report is unavailable. Your access may have changed; sign in again or contact the owner.'));
    return;
  }
  const {report,updated_at,viewer_events} = result.data;
  if (!report) content.append(el('p','Waiting for the updated desktop app to sync report history.'));
  else {
    const age = Date.now()-Date.parse(updated_at);
    content.append(el('p',(age > 180000 || age < -120000 ? 'Older snapshot — ' : 'Last synced — ')+new Date(updated_at).toLocaleString('en-PK',{timeZone:'Asia/Karachi'})));
    if (report.notes?.length) {
      const notes = el('details'); notes.append(el('summary','How these figures are counted'));
      for (const note of report.notes) notes.append(el('p',note,'report-note'));
      content.append(notes);
    }
    if (report.summary) metrics(report.summary,content);
    if (report.stations) stationCards(report.stations,content);
    if (report.daily) {
      for(const day of report.daily) {
        const card=el('details',undefined,'card'); card.append(el('summary',day.date)); metrics(day,card); content.append(card);
      }
    }
    if (report.rankings) for (const [label,stations] of Object.entries(report.rankings)) {
      content.append(el('h3',label));
      const field = {'Highest revenue':'revenue','Most sessions':'sessions','Most customers':'known_customers','Most popular':'sessions'}[label] || 'session_seconds';
      stationCards(stations,content,field);
    }
    if (report.events) { content.append(el('h3','Desktop history')); eventCards(report.events,content); }
  }
  if (['Activity Logs','Login Logs'].includes(section)) {
    content.append(el('h3','Report account history — latest 500 events')); eventCards(viewer_events || [],content);
  }
}
async function reportLogout() {
  const role = reportRole;
  resetReportView();
  document.getElementById('login').style.display = 'block';
  document.getElementById('password').value = '';
  try {
    if (['owner','viewer'].includes(role)) await sb.rpc('mf_report_event',{p_action:'Logout',p_device:deviceLabel()});
  } finally {
    const {error} = await sb.auth.signOut({scope:'local'});
    document.getElementById('error').textContent = error ? 'Sign-out failed. Close this browser and try again.' : '';
  }
}
document.getElementById('report-period').onchange = () => {if(reportSection) loadReport(reportSection);};
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    resetReportView(); document.getElementById('login').style.display='block';
  }
});
checkLogin();
