'use strict';
const REPORT_SECTIONS = ['Visits','Customers','Station Usage','Station Rankings','Activity Logs','Login Logs','Reports'];
let reportRole = null, reportSection = null, reportGeneration = 0, reportTimer = null;
let savedPeriods = [], exportedReport = null, lastReportKey = null, historyRequest = 0;
const deviceLabel = () => navigator.userAgent.slice(0,300);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function resetReportView() {
  reportGeneration++; historyRequest++;
  savedPeriods = []; exportedReport = null; lastReportKey = null; setExportEnabled(false);
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
  document.getElementById('owner-reports').hidden = role !== 'viewer';
  if (role === 'viewer') openReports();
  else await showDashboard();
}
function openReports() {
  if (reportRole !== 'viewer') return;
  clearInterval(dashboardRefreshTimer);
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('reports').hidden = false;
  document.getElementById('owner-return').hidden = reportRole !== 'viewer';
  document.getElementById('owner-return').textContent = 'View live stations';
  document.getElementById('report-title').textContent = reportRole === 'viewer' ? 'Report Viewer' : 'Reports';
  const cards = document.getElementById('report-cards'); cards.replaceChildren();
  for (const name of REPORT_SECTIONS) {
    const button = el('button',name,'report-card');
    button.onclick = () => loadReport(name);
    cards.append(button);
  }
  document.getElementById('report-content').replaceChildren(el('p','Choose a section above.'));
  clearInterval(reportTimer);
  refreshHistoryOptions();
  loadReport(reportSection || 'Reports', false);
  reportTimer = setInterval(async () => {
    await refreshHistoryOptions();
    if(reportRole === 'viewer' && reportSection && !document.getElementById('reports').hidden) loadReport(reportSection,false);
  },60000);
}
async function returnToOwner() {
  if (reportRole !== 'viewer') return;
  reportGeneration++; historyRequest++; clearInterval(reportTimer); reportSection = null;
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
  if (reportRole !== 'viewer' || !REPORT_SECTIONS.includes(section)) return;
  reportSection = section;
  const generation = ++reportGeneration;
  const period = selectedPeriod();
  const archived = !['today','week','month'].includes(period);
  const key = section + '|' + period;
  const content = document.getElementById('report-content');
  const keepPrevious = !scroll && lastReportKey === key && exportedReport;
  if (!keepPrevious) {
    exportedReport = null; setExportEnabled(false);
    content.replaceChildren(el('h2',section),el('p','Loading…'));
  }
  if (!period) {
    content.replaceChildren(el('h2',section),el('p','This period has not been uploaded yet. Keep the desktop app open and connected while history uploads.'));
    return;
  }
  for (const button of document.querySelectorAll('#report-cards button')) button.setAttribute('aria-pressed',String(button.textContent === section));
  if (scroll) content.scrollIntoView?.({behavior:'smooth',block:'start'});
  let result;
  try { result = archived
    ? await sb.rpc('mf_read_report_period',{p_section:section,p_period:period})
    : await sb.rpc('mf_read_report',{p_section:section,p_period:period,p_device:deviceLabel()}); }
  catch (_) { result = {error:true}; }
  if (generation !== reportGeneration) return;
  if (result.error && keepPrevious && !/denied|permission|JWT|expired/i.test(result.error.message || '')) {
    let status = document.getElementById('report-status');
    if (!status) { status = el('p'); status.id = 'report-status'; content.prepend(status); }
    status.textContent = 'Refresh failed. Showing the previously loaded report; its saved time is shown below.';
    return;
  }
  content.replaceChildren(el('h2',section));
  if (result.error) {
    exportedReport = null; setExportEnabled(false);
    content.append(el('p','This report is unavailable. Your access may have changed; sign in again or contact the owner.'));
    return;
  }
  const {report,updated_at,viewer_events} = result.data || {};
  lastReportKey = key;
  exportedReport = report ? {section,period,...result.data} : null;
  setExportEnabled(Boolean(report));
  const title = archived ? period === 'all' ? 'All saved records' : period : document.getElementById('report-period').selectedOptions[0].textContent;
  content.append(el('h3', title));
  if (result.data?.start_date) content.append(el('p','Record dates: '+result.data.start_date+' to '+result.data.end_date,'history-note'));
  if (result.data?.coverage) content.append(el('p',result.data.coverage,'history-note'));
  if (!report) content.append(el('p','Waiting for the updated desktop app to sync report history.'));
  else {
    const age = Date.now()-Date.parse(updated_at);
    content.append(el('p',(archived ? 'Saved to cloud — ' : age > 180000 || age < -120000 ? 'Older snapshot — ' : 'Last synced — ')+new Date(updated_at).toLocaleString('en-PK',{timeZone:'Asia/Karachi'})));
    if (report.notes?.length) {
      const notes = el('details'); notes.append(el('summary','How these figures are counted'));
      for (const note of report.notes) notes.append(el('p',note,'report-note'));
      content.append(notes);
    }
    if (report.summary) metrics(report.summary,content);
    if (report.daily) {
      renderSalesChart(report.daily,content);
      for(const day of report.daily) {
        const card=el('details',undefined,'card'); card.append(el('summary',day.date)); metrics(day,card); content.append(card);
      }
    }
    if (report.stations) { content.append(el('h3','Station details')); stationCards(report.stations,content); }
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
document.getElementById('report-period').onchange = () => {
  updatePeriodControls(); loadReport(reportSection || 'Reports');
};
document.getElementById('report-year').onchange = () => {
  updatePeriodControls(); loadReport(reportSection || 'Reports');
};
document.getElementById('report-month').onchange = () => loadReport(reportSection || 'Reports');
document.getElementById('report-refresh').onclick = async () => {
  await refreshHistoryOptions();
  if (reportRole === 'viewer') loadReport(reportSection || 'Reports',false);
};
document.getElementById('export-csv').onclick = exportCSV;
document.getElementById('export-json').onclick = () => {
  if (exportedReport) downloadReport(JSON.stringify(exportedReport,null,2),'json','application/json');
};
document.getElementById('print-report').onclick = () => {
  if (!exportedReport) return;
  const closed = [...document.querySelectorAll('#report-content details:not([open])')];
  closed.forEach(node => node.open = true);
  const restore = () => { closed.forEach(node => node.open = false); window.removeEventListener('afterprint',restore); };
  window.addEventListener('afterprint',restore);
  window.print();
};
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    resetReportView(); document.getElementById('login').style.display='block';
  }
});

function setExportEnabled(enabled) {
  for (const id of ['export-csv','export-json','print-report']) document.getElementById(id).disabled = !enabled;
}
function populate(select, values, label) {
  const previous = select.value;
  select.replaceChildren();
  for (const value of values) {
    const option = el('option',label ? label(value) : value);
    option.value = value; select.append(option);
  }
  if (values.includes(previous)) select.value = previous;
  select.disabled = !values.length;
}
function updatePeriodControls() {
  const type = document.getElementById('report-period').value;
  const year = document.getElementById('report-year');
  const month = document.getElementById('report-month');
  document.getElementById('year-control').hidden = !['saved-month','saved-year'].includes(type);
  document.getElementById('month-control').hidden = type !== 'saved-month';
  const keys = savedPeriods.map(row => row.period);
  const years = [...new Set(keys.filter(key => type === 'saved-year' ? /^\d{4}$/.test(key) : /^\d{4}-\d{2}$/.test(key)).map(key => key.slice(0,4)))].sort().reverse();
  populate(year,years);
  const months = keys.filter(key => /^\d{4}-\d{2}$/.test(key) && key.startsWith(year.value+'-')).sort().reverse();
  populate(month, months, value => new Date(value+'-01T12:00:00+05:00').toLocaleDateString('en-PK',{month:'long',timeZone:'Asia/Karachi'}));
}
function selectedPeriod() {
  const type = document.getElementById('report-period').value;
  if (type === 'saved-month') return document.getElementById('report-month').value;
  if (type === 'saved-year') return document.getElementById('report-year').value;
  if (type === 'all' && !savedPeriods.some(row => row.period === 'all')) return '';
  return type;
}
async function refreshHistoryOptions() {
  if (reportRole !== 'viewer') return;
  const request = ++historyRequest;
  let result;
  try { result = await sb.rpc('mf_list_report_periods'); }
  catch (_) { result = {error:true}; }
  if (request !== historyRequest || reportRole !== 'viewer') return;
  const status = document.getElementById('history-status');
  if (result.error) {
    status.textContent = 'Saved history is unavailable. If this is your first setup, complete the monthly-history SQL and desktop update. Current reports are still available.';
    return;
  }
  savedPeriods = Array.isArray(result.data) ? result.data : [];
  updatePeriodControls();
  const count = savedPeriods.filter(row => /^\d{4}-\d{2}$/.test(row.period)).length;
  status.textContent = count ? count+' saved month'+(count === 1 ? '' : 's')+'. Older months and yearly reports appear as the desktop uploads them. Reports use saved gaming bills; food sales are separate.'
    : 'Waiting for the desktop history upload. Keep version 4.4.6 or later open and connected. Older months appear gradually.';
}
function renderSalesChart(days,parent) {
  if (!days.length) { parent.append(el('p','No recorded gaming sales in this period.')); return; }
  // Monthly grouping keeps a multi-year report readable on a phone.
  const values = days.length > 62 ? Object.values(days.reduce((acc,day) => {
    const key = day.date.slice(0,7);
    const value = acc[key] || (acc[key] = {date:key,revenue:0});
    value.revenue += Number(day.revenue)||0; return acc;
  },{})) : days;
  parent.append(el('h3',days.length > 62 ? 'Gaming sales by month' : 'Gaming sales by day'));
  const chart = el('div',undefined,'sales-chart');
  const maximum = Math.max(1,...values.map(day => Math.abs(Number(day.revenue)||0)));
  for (const day of values) {
    const row = el('div',undefined,'sales-bar');
    const track = el('div',undefined,'sales-bar-track');
    const fill = el('div',undefined,'sales-bar-fill');
    fill.style.width = (100*Math.abs(Number(day.revenue)||0)/maximum)+'%';
    if (Number(day.revenue)<0) fill.style.background='#f87171';
    track.append(fill);
    row.append(el('span',day.date),track,el('span','Rs. '+display('revenue',day.revenue),'sales-bar-amount'));
    chart.append(row);
  }
  parent.append(chart);
}
function downloadReport(text,extension,type) {
  if (!exportedReport) return;
  const blob = new Blob([text],{type:type+';charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = el('a'); link.href=url;
  link.download = ('MAX_FLAME_'+exportedReport.period+'_'+exportedReport.section).replace(/[^a-zA-Z0-9_-]/g,'_')+'.'+extension;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
function exportCSV() {
  if (!exportedReport) return;
  const data = exportedReport.report;
  const rows = [['MAX FLAME',exportedReport.section,exportedReport.period],['Saved at',exportedReport.updated_at]];
  if (exportedReport.start_date) rows.push(['From',exportedReport.start_date,'To',exportedReport.end_date]);
  if (data.summary) { rows.push([],['Summary','Value']); for (const [key,value] of Object.entries(data.summary)) rows.push([labels[key]||key,value]); }
  const addTable = (name,items) => {
    if (!items?.length) return;
    const keys = [...new Set(items.flatMap(item=>Object.keys(item)))];
    rows.push([],[name],keys.map(key=>labels[key]||key));
    for (const item of items) rows.push(keys.map(key=>typeof item[key]==='object' && item[key]!==null ? JSON.stringify(item[key]) : item[key]));
  };
  addTable('Daily gaming sales (seconds are numeric)',data.daily);
  addTable('Stations (seconds are numeric)',data.stations);
  if (data.rankings) for (const [name,items] of Object.entries(data.rankings)) addTable(name,items);
  addTable('Desktop events',data.events); addTable('Report account events',exportedReport.viewer_events);
  if (data.notes) rows.push([],['Notes'],...data.notes.map(note=>[note]));
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (typeof value !== 'number' && /^[\s]*[=+@-]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  downloadReport('\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n'),'csv','text/csv');
}

checkLogin();
