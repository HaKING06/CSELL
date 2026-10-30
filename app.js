const DB_NAME = 'csell-local-v1';
const DB_VERSION = 1;
const API_ROOT = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en';
const CATALOG_FILES = {
  skin: 'skins_not_grouped.json', agent: 'agents.json', case: 'crates.json', sticker: 'stickers.json',
  sticker_slab: 'sticker_slabs.json', charm: 'keychains.json', music_kit: 'music_kits.json',
  patch: 'patches.json', graffiti: 'graffiti.json', collectible: 'collectibles.json', key: 'keys.json'
};
const LABELS = {
  skin:'Skin', agent:'Ajan', case:'Kasa & kapsül', sticker:'Sticker', sticker_slab:'Sticker Slab',
  charm:'Charm', music_kit:'Müzik kiti', patch:'Patch', graffiti:'Graffiti', collectible:'Koleksiyon ürünü', key:'Kasa anahtarı', other:'Diğer'
};
const PILL_CATEGORIES = ['skin','case','agent','sticker','sticker_slab','charm','music_kit','patch','graffiti','collectible','key'];
const state = { db:null, trades:[], settings:{ feeRate:2, feeFixed:0, lockDays:8, nextId:1 }, catalog:new Map(), catalogPromises:new Map(), catalogUpdated:new Map(), activePage:'dashboard', editor:{ recordId:null, category:'skin', main:null, charm:null, slab:null, extras:[], selectedItem:null }, detailId:null, filters:{ search:'',status:'all',type:'all',wear:'all',from:'',to:'',sort:'date-desc' } };
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const locale = () => window.CSELL_I18N?.locale?.() || 'tr-TR';

function openDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('trades'))db.createObjectStore('trades',{keyPath:'id'});
      if(!db.objectStoreNames.contains('settings'))db.createObjectStore('settings',{keyPath:'key'});
      if(!db.objectStoreNames.contains('catalog'))db.createObjectStore('catalog',{keyPath:'key'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
function dbRequest(store,method,value){
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction(store,method==='getAll'||method==='get'?'readonly':'readwrite');
    const objectStore=tx.objectStore(store);
    let req;
    if(method==='getAll')req=objectStore.getAll();
    else if(method==='get')req=objectStore.get(value);
    else if(method==='delete')req=objectStore.delete(value);
    else if(method==='clear')req=objectStore.clear();
    else req=objectStore.put(value);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
const money=(value)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format((Number(value)||0)/100);
const cents=(value)=>Math.round((Number.parseFloat(value)||0)*100);
const feeCents=(gross,settings=state.settings)=>gross>0?Math.max(1,Math.ceil(gross*(Number(settings.feeRate)||0)/100))+Math.round((Number(settings.feeFixed)||0)*100):0;
const netCents=(gross,settings=state.settings)=>Math.max(0,gross-feeCents(gross,settings));
const escapeHtml=(value)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function safeUrl(value){try{const u=new URL(value,location.href);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
function itemName(item){return item?.market_hash_name||item?.name||'İsimsiz item'}
function itemImage(item){return safeUrl(item?.image||item?.icon_url||item?.icon_url_large||'')}
function rarityColor(item){const color=item?.rarity?.color||'';return /^#[0-9a-f]{6}$/i.test(color)?color:'#75918b'}
function categoryName(category){const label=LABELS[category]||LABELS.other;return window.CSELL_I18N?.translate?.(label)||label}
function itemSearchLabel(category){if(window.CSELL_LANGUAGE!=='en')return `${categoryName(category)} ara`;return ({skin:'Search skins',case:'Search cases and capsules',agent:'Search agents',sticker:'Search stickers',sticker_slab:'Search sticker slabs',charm:'Search charms',music_kit:'Search music kits',patch:'Search patches',graffiti:'Search graffiti',collectible:'Search collectibles',key:'Search case keys'})[category]||`Search ${categoryName(category)}`}
function localDateTime(value){const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return '—';return new Intl.DateTimeFormat(locale(),{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)}
function shortDate(value){const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return '—';return new Intl.DateTimeFormat(locale(),{day:'2-digit',month:'short',year:'numeric'}).format(d)}
function localInputValue(date=new Date()){
  const offset=date.getTimezoneOffset();
  return new Date(date.getTime()-offset*60000).toISOString().slice(0,16);
}
function selectedImage(item,className='item-thumb'){
  const src=itemImage(item),alt=itemName(item);
  return `<span class="${className}">${src?`<img loading="lazy" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`:'<span class="item-thumb-fallback">◈</span>'}</span>`;
}
function updateImageFallbacks(root=document){
  $$('img',root).forEach(img=>{if(img.dataset.fallbackBound)return;img.dataset.fallbackBound='1';img.addEventListener('error',()=>{const parent=img.parentElement;img.remove();if(parent&&!parent.textContent.trim())parent.textContent='◈';},{once:true})})
}
function saleLines(recordOrEditor=state.editor,actual=false){
  const lines=[];
  const add=(key,item,raw,kind)=>{if(item){const gross=typeof raw==='number'?Math.round(raw):cents(raw);lines.push({key,item,name:itemName(item),category:item.category||kind||'other',gross,kind})}};
  if(recordOrEditor?.main){
    const e=recordOrEditor;
    const actualMap=actual?(e.actualPrices||{}):null;
    add('main',e.main,actualMap?.main??e.mainSale,'main');
    if(e.charm)add('charm',e.charm,actualMap?.charm??e.charmSale,'charm');
    if(e.slab)add('slab',e.slab,actualMap?.slab??e.slabSale,'sticker_slab');
    (e.extras||[]).forEach(extra=>add(extra.lineId||extra.id,extra.item||extra,actualMap?.[extra.lineId||extra.id]??extra.sale,'extra'));
  }
  return lines;
}
function totalsFor(record,actual=false){
  const lines=saleLines(record,actual);
  const gross=lines.reduce((sum,line)=>sum+line.gross,0);
  const net=lines.reduce((sum,line)=>sum+netCents(line.gross),0);
  const cost=Number(record.buyCents)||0;
  return {gross,net,fees:gross-net,profit:net-cost,lines};
}
function unlockAt(record){return new Date(new Date(record.boughtAt).getTime()+Math.max(0,Number(record.lockDays)||0)*86400000)}
function isReady(record,now=Date.now()){return unlockAt(record).getTime()<=now}
function realizedProfit(record){return record.soldAt?totalsFor(record,true).profit:0}
function plannedProfit(record){return record.soldAt?0:totalsFor(record,false).profit}
function toast(message,type='success'){
  const node=document.createElement('div');node.className=`toast${type==='error'?' error':''}`;node.innerHTML=`<span>${type==='error'?'!':'✓'}</span><span>${escapeHtml(message)}</span>`;
  $('#toast-region').append(node);setTimeout(()=>node.remove(),3600)
}

function setCatalogStatus(kind,text){
  const el=$('#catalog-state');el.className=`catalog-state ${kind==='loading'?'loading':kind==='error'?'error':''}`;el.lastElementChild.textContent=text;
  const settings=$('#settings-catalog-status');if(settings)settings.textContent=kind==='ready'?'Güncel ve önbelleğe alınmış':kind==='loading'?'Yükleniyor…':'Çevrimdışı';
}
async function ensureCatalog(category,force=false){
  if(!CATALOG_FILES[category])return [];
  const memoryAge=Date.now()-(state.catalogUpdated.get(category)||0);
  if(!force&&state.catalog.has(category)&&memoryAge<6*3600000)return state.catalog.get(category);
  if(memoryAge>=6*3600000)state.catalog.delete(category);
  if(!force&&state.catalogPromises.has(category))return state.catalogPromises.get(category);
  let staleItems=null;
  const promise=(async()=>{
    setCatalogStatus('loading','Katalog yükleniyor');
    if(!force){
      try{const saved=await dbRequest('catalog','get',category);if(saved?.items?.length){staleItems=saved.items;const age=Date.now()-new Date(saved.updatedAt||0).getTime();if(age<24*3600000){state.catalog.set(category,saved.items);state.catalogUpdated.set(category,Date.now());setCatalogStatus('ready','Katalog hazır');return saved.items}}}catch{}
    }
    const local=await fetch(`./data/catalog/${encodeURIComponent(category)}.json`,{cache:force?'reload':'no-cache'}).catch(()=>null);
    if(local?.ok){
      try{const bundle=await local.json();const list=Array.isArray(bundle)?bundle:bundle.items;if(Array.isArray(list)&&list.length){const items=list.map(item=>({...item,category:item.category||category}));state.catalog.set(category,items);state.catalogUpdated.set(category,Date.now());await dbRequest('catalog','put',{key:category,items,updatedAt:new Date().toISOString()});setCatalogStatus('ready','Katalog hazır');return items}}catch{}
    }
    const response=await fetch(`${API_ROOT}/${CATALOG_FILES[category]}`,{mode:'cors',cache:force?'reload':'no-cache',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`Katalog yanıtı: ${response.status}`);
    const source=await response.json();
    const items=(Array.isArray(source)?source:[]).map(item=>({...item,category}));
    state.catalog.set(category,items);state.catalogUpdated.set(category,Date.now());
    await dbRequest('catalog','put',{key:category,items,updatedAt:new Date().toISOString()});
    setCatalogStatus('ready','Katalog güncel');return items;
  })().catch(error=>{
    const cached=state.catalog.get(category)||staleItems;
    setCatalogStatus('error','Katalog çevrimdışı');
    console.warn(`CSELL catalog ${category}:`,error);
    if(cached){state.catalog.set(category,cached);state.catalogUpdated.set(category,Date.now())}
    if(cached)return cached;
    return [];
  }).finally(()=>state.catalogPromises.delete(category));
  state.catalogPromises.set(category,promise);return promise;
}

function navigate(page){
  const key=page||'dashboard';if(!$(`#page-${key}`))return;
  state.activePage=key;$$('.page').forEach(node=>node.classList.toggle('active',node.id===`page-${key}`));
  $$('.nav-link').forEach(node=>node.classList.toggle('active',node.dataset.page===key));
  const label={dashboard:'Genel bakış',history:'Geçmiş kayıtlar',reports:'Raporlar',settings:'Ayarlar'}[key]||'Genel bakış';$('#current-section').textContent=label;
  $('#sidebar').classList.remove('mobile-open');$('#mobile-scrim').classList.remove('open');
  if(key==='history')renderHistory();if(key==='reports')renderReports();if(key==='settings')renderSettings();
  window.scrollTo({top:0,behavior:'smooth'});
}
function getRecordStatus(record){if(record.soldAt)return 'sold';return isReady(record)?'ready':'active'}
function itemWear(item){if(item?.wear?.name)return item.wear.name;if(typeof item?.wear==='string')return item.wear;const match=itemName(item).match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)/i);return match?match[1]:''}
function statusMarkup(record){const status=getRecordStatus(record);if(status==='sold')return '<span class="status-badge status-sold">Satıldı</span>';if(status==='ready')return '<span class="status-badge status-ready">Satışa hazır</span>';return '<span class="status-badge status-active">Trade kilitli</span>'}
function recordMainItem(record){return record.main||{name:record.name,category:record.category,image:record.image}}
function itemCell(record,small=false){
  const main=recordMainItem(record),lineNames=[];
  if(record.charm)lineNames.push('Charm');if(record.slab)lineNames.push('Sticker Slab');for(const extra of record.extras||[])lineNames.push(categoryName(extra.item?.category||extra.category));
  const item=main||{},name=itemName(item),wear=item.wear?.name||item.wear||'';
  const thumb=selectedImage(item,`item-thumb${small?' compact-thumb':''}`);
  return `<div class="item-cell">${thumb}<span class="item-copy"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small><i class="rarity-dot" style="background:${escapeHtml(rarityColor(item))}"></i>${escapeHtml(categoryName(item.category||record.category))}${wear?` · ${escapeHtml(wear)}`:''}${lineNames.length?` · +${lineNames.length} item`:''}</small></span></div>`;
}
function renderDashboard(){
  const now=new Date(),month=now.getMonth(),year=now.getFullYear();
  const sold=state.trades.filter(t=>t.soldAt),active=state.trades.filter(t=>!t.soldAt);
  const total= sold.reduce((sum,t)=>sum+realizedProfit(t),0);
  const monthTrades=sold.filter(t=>{const d=new Date(t.soldAt);return d.getMonth()===month&&d.getFullYear()===year});
  const monthProfit=monthTrades.reduce((sum,t)=>sum+realizedProfit(t),0);
  const invested=active.reduce((sum,t)=>sum+(Number(t.buyCents)||0),0);
  const forecast=active.reduce((sum,t)=>sum+plannedProfit(t),0);
  $('#metric-total-profit').textContent=money(total);$('#metric-month-profit').textContent=money(monthProfit);
  $('#metric-invested').textContent=money(invested);$('#metric-forecast').textContent=money(forecast);
  $('#month-trades').textContent=`${monthTrades.length} satış`;
  $('#month-label').textContent=new Intl.DateTimeFormat(locale(),{month:'long'}).format(now);
  $('#active-count').textContent=`${active.length} aktif kayıt`;
  $('#today-label').textContent=new Intl.DateTimeFormat(locale(),{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now);
  $('#nav-trade-count').textContent=String(state.trades.length);
  $('#year-now').textContent=String(year);
  const tbody=$('#recent-body');const sorted=[...state.trades].sort((a,b)=>new Date(b.updatedAt||b.boughtAt)-new Date(a.updatedAt||a.boughtAt)).slice(0,5);
  tbody.innerHTML=sorted.map(record=>{
    const profit=record.soldAt?realizedProfit(record):plannedProfit(record);
    const when=record.soldAt?record.soldAt:record.boughtAt;
    return `<tr data-record="${escapeHtml(record.id)}"><td>${itemCell(record)}</td><td><span class="date-cell">${escapeHtml(shortDate(when))}<small>${escapeHtml(new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(when)))}</small></span></td><td class="money">${money(record.buyCents)}</td><td class="money ${profit>=0?'money-positive':'money-negative'}">${record.soldAt?money(profit):`~${money(profit)}`}</td><td>${statusMarkup(record)}</td><td><button class="row-action" data-action="detail" data-id="${escapeHtml(record.id)}" title="İşlem ayrıntısı" aria-label="İşlem ayrıntısı">↗</button></td></tr>`
  }).join('');
  $('#dashboard-empty').hidden=state.trades.length!==0;
  $('#recent-body').closest('.table-wrap').hidden=state.trades.length===0;
  renderUnlockList();renderProfitChart();updateImageFallbacks();
}
function countdown(target){
  const ms=new Date(target).getTime()-Date.now();if(ms<=0)return 'Açıldı';
  const d=Math.floor(ms/86400000),h=Math.floor((ms%86400000)/3600000),m=Math.floor((ms%3600000)/60000);
  if(window.CSELL_LANGUAGE==='en')return d>0?`${d}d ${String(h).padStart(2,'0')}h`:`${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`;
  return d>0?`${d}g ${String(h).padStart(2,'0')}s`:`${String(h).padStart(2,'0')}s ${String(m).padStart(2,'0')}d`;
}
function renderUnlockList(){
  const items=state.trades.filter(t=>!t.soldAt&&!isReady(t)).sort((a,b)=>unlockAt(a)-unlockAt(b)).slice(0,4);
  const container=$('#unlock-list');
  if(!items.length){container.innerHTML='<div class="empty-unlocks">Aktif trade kilidi bulunmuyor.</div>';return}
  container.innerHTML=items.map(record=>{
    const item=recordMainItem(record),image=itemImage(item),date=unlockAt(record);
    return `<div class="unlock-item"><span class="unlock-thumb">${image?`<img loading="lazy" src="${escapeHtml(image)}" alt="">`:'◈'}</span><span class="unlock-item-copy"><strong>${escapeHtml(itemName(item))}</strong><small>${escapeHtml(shortDate(date))} · ${escapeHtml(new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit'}).format(date))}</small></span><span class="unlock-countdown" data-countdown="${escapeHtml(date.toISOString())}">${escapeHtml(countdown(date))}<small>kaldı</small></span></div>`
  }).join('');updateImageFallbacks(container);
}
function chartSvg(values,forecastValues=[],labels=[]){
  const width=720,height=132,left=8,right=8,top=7,bottom=20,innerW=width-left-right,innerH=height-top-bottom;
  const all=[...values,...forecastValues,0];let max=Math.max(...all),min=Math.min(...all);if(max===min){max+=1;min=Math.min(0,min)}const pad=Math.max((max-min)*.12,1);max+=pad;min-=pad*.28;
  const y=(v)=>top+(max-v)/(max-min)*innerH;
  const point=(arr,i)=>`${left+(arr.length<=1?innerW/2:i*innerW/(arr.length-1))},${y(arr[i])}`;
  const path=values.map((v,i)=>`${i?'L':'M'}${point(values,i)}`).join(' ');
  const fPath=forecastValues.map((v,i)=>{const [x,y]=point(forecastValues,i).split(',');return i?`H${x} V${y}`:`M${x},${y}`}).join(' ');
  const baseline=y(0),area=values.length?`${path} L ${left+innerW},${baseline} L ${left},${baseline} Z`:'';
  const grid=[0,1,2,3].map(i=>{const gy=top+i*innerH/3;return `<line class="grid-line" x1="${left}" y1="${gy}" x2="${width-right}" y2="${gy}"/>`}).join('');
  const labelIdx=[0,Math.floor((labels.length-1)/3),Math.floor(2*(labels.length-1)/3),labels.length-1].filter((n,i,a)=>n>=0&&a.indexOf(n)===i);
  const xLabels=labelIdx.map(i=>`<text class="axis-label" x="${left+(labels.length<=1?innerW/2:i*innerW/(labels.length-1))}" y="${height-3}" text-anchor="${i===0?'start':i===labels.length-1?'end':'middle'}">${escapeHtml(labels[i]||'')}</text>`).join('');
  const markerStep=Math.max(1,Math.ceil(values.length/60));
  const points=values.map((v,i)=>i%markerStep===0||i===values.length-1||v!==0?`<circle class="chart-point" cx="${left+(values.length<=1?innerW/2:i*innerW/(values.length-1))}" cy="${y(v)}" r="2.5"/>`:'').join('');
  const forecastPoints=forecastValues.map((v,i)=>v!==0?`<circle class="chart-forecast-point" cx="${left+(forecastValues.length<=1?innerW/2:i*innerW/(forecastValues.length-1))}" cy="${y(v)}" r="3"/>`:'').join('');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#a9ec84" stop-opacity=".17"/><stop offset="100%" stop-color="#a9ec84" stop-opacity="0"/></linearGradient></defs>${grid}<line class="grid-line" x1="${left}" y1="${baseline}" x2="${width-right}" y2="${baseline}"/>${values.some(v=>v!==0)?`<path class="chart-area" d="${area}"/>`:''}${path?`<path class="chart-line" d="${path}"/>`:''}${fPath?`<path class="chart-line-forecast" d="${fPath}"/>`:''}${forecastPoints}${points}${xLabels}</svg>`;
}
function attachChartTooltip(container,actual,forecast,dates,granularity){
  if(!container.querySelector('svg'))return;
  const tooltip=document.createElement('div');tooltip.className='chart-tooltip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;
  const crosshair=document.createElement('div');crosshair.className='chart-crosshair';crosshair.hidden=true;
  container.append(crosshair,tooltip);container._chartPoint=-1;
  container.onpointermove=event=>{
    const rect=container.getBoundingClientRect();if(!rect.width||!actual.length)return;
    const plotLeft=rect.width*(8/720),plotWidth=rect.width*(704/720),x=Math.min(plotLeft+plotWidth,Math.max(plotLeft,event.clientX-rect.left));
    const index=actual.length===1?0:Math.round((x-plotLeft)/plotWidth*(actual.length-1));
    const pointX=plotLeft+(actual.length===1?plotWidth/2:index*plotWidth/(actual.length-1));
    if(container._chartPoint!==index){
      const date=dates[index],options=granularity==='day'?{weekday:'short',day:'numeric',month:'long',year:'numeric'}:granularity==='year'?{year:'numeric'}:{month:'long',year:'numeric'};
      const dateLabel=new Intl.DateTimeFormat(locale(),options).format(date),actualLabel=window.CSELL_LANGUAGE==='en'?'Realized profit':'Gerçekleşen kâr',forecastLabel=window.CSELL_LANGUAGE==='en'?'Estimated profit':'Tahmini kâr';
      tooltip.innerHTML=`<strong>${escapeHtml(dateLabel)}</strong><span><i class="legend-dot realized"></i>${actualLabel}<b>${money(Math.round(actual[index]*100))}</b></span><span><i class="legend-dot forecast"></i>${forecastLabel}<b>${money(Math.round(forecast[index]*100))}</b></span>`;
      container._chartPoint=index;
    }
    tooltip.hidden=false;crosshair.hidden=false;
    const tooltipWidth=tooltip.offsetWidth||190,tooltipHeight=tooltip.offsetHeight||62;
    tooltip.style.left=`${Math.max(6,Math.min(rect.width-tooltipWidth-6,pointX+10))}px`;
    tooltip.style.top=`${Math.max(6,Math.min(rect.height-tooltipHeight-6,event.clientY-rect.top-tooltipHeight-8))}px`;
    crosshair.style.left=`${pointX}px`;
  };
  container.onpointerleave=()=>{tooltip.hidden=true;crosshair.hidden=true;container._chartPoint=-1};
}
function renderProfitChart(){
  const range=$('#chart-range')?.value||'30',allTime=range==='all',days=Number(range)||30,now=new Date(),dayMs=86400000;
  const forecastDate=record=>new Date(Math.max(now.getTime(),unlockAt(record).getTime()));
  const latestForecast=state.trades.reduce((latest,record)=>record.soldAt?latest:(forecastDate(record)>latest?forecastDate(record):latest),now);
  let start,bucketCount,indexFor,labels,dates,granularity;
  if(allTime){
    const eventDates=[now,...state.trades.map(record=>new Date(record.soldAt||forecastDate(record)))].filter(date=>!Number.isNaN(date.getTime()));
    const first=eventDates.reduce((earliest,date)=>date<earliest?date:earliest,now);
    const firstDay=new Date(first.getFullYear(),first.getMonth(),first.getDate()),lastDay=new Date(latestForecast.getFullYear(),latestForecast.getMonth(),latestForecast.getDate());
    const firstOrdinal=Date.UTC(firstDay.getFullYear(),firstDay.getMonth(),firstDay.getDate()),lastOrdinal=Date.UTC(lastDay.getFullYear(),lastDay.getMonth(),lastDay.getDate());
    const dayCount=Math.max(1,Math.floor((lastOrdinal-firstOrdinal)/dayMs)+1);
    if(dayCount<=730){
      granularity='day';start=firstDay;bucketCount=dayCount;
      indexFor=(date)=>{const d=new Date(date);if(Number.isNaN(d.getTime()))return -1;const ordinal=Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()),index=Math.floor((ordinal-firstOrdinal)/dayMs);return index>=0&&index<bucketCount?index:-1};
      dates=Array.from({length:bucketCount},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i));labels=Array(bucketCount).fill('');
      const ticks=[0,Math.floor((bucketCount-1)/3),Math.floor(2*(bucketCount-1)/3),bucketCount-1];
      [...new Set(ticks)].forEach(i=>{const date=dates[i],month=new Intl.DateTimeFormat(locale(),{month:'short'}).format(date);labels[i]=`${date.getDate()} ${month}${date.getFullYear()!==now.getFullYear()?' '+date.getFullYear():''}`});
    }else{
      const firstMonth=new Date(firstDay.getFullYear(),firstDay.getMonth(),1),lastMonth=new Date(lastDay.getFullYear(),lastDay.getMonth(),1);
      const monthCount=(lastMonth.getFullYear()-firstMonth.getFullYear())*12+lastMonth.getMonth()-firstMonth.getMonth()+1,yearly=monthCount>180;
      start=yearly?new Date(firstMonth.getFullYear(),0,1):firstMonth;granularity=yearly?'year':'month';
      bucketCount=yearly?lastMonth.getFullYear()-start.getFullYear()+1:monthCount;bucketCount=Math.max(1,bucketCount);
      indexFor=(date)=>{const d=new Date(date);if(Number.isNaN(d.getTime())||d<start||d>latestForecast)return -1;const index=yearly?d.getFullYear()-start.getFullYear():(d.getFullYear()-start.getFullYear())*12+d.getMonth()-start.getMonth();return index>=0&&index<bucketCount?index:-1};
      dates=Array.from({length:bucketCount},(_,i)=>yearly?new Date(start.getFullYear()+i,0,1):new Date(start.getFullYear(),start.getMonth()+i,1));
      labels=dates.map(date=>yearly?String(date.getFullYear()):new Intl.DateTimeFormat(locale(),{month:'short',year:monthCount>24?'2-digit':undefined}).format(date));
    }
  }else{
    const dayOrdinal=date=>{const value=new Date(date);return Math.floor(Date.UTC(value.getFullYear(),value.getMonth(),value.getDate())/dayMs)};
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    start=new Date(today);start.setDate(start.getDate()-Math.max(1,days-1));
    const futureDays=Math.min(days,Math.max(0,dayOrdinal(latestForecast)-dayOrdinal(now)));
    if(days>180){
      const totalDays=days+futureDays;bucketCount=12+Math.ceil(futureDays/(days/12));granularity='month';const endExclusive=new Date(start.getTime()+totalDays*dayMs);
      indexFor=(date)=>{const d=new Date(date);if(Number.isNaN(d.getTime())||d<start||d>=endExclusive)return -1;return Math.min(bucketCount-1,Math.floor((d-start)/(totalDays*dayMs)*bucketCount))};
      dates=Array.from({length:bucketCount},(_,i)=>new Date(start.getTime()+i*totalDays/bucketCount*dayMs));labels=dates.map(d=>new Intl.DateTimeFormat(locale(),{month:'short',year:bucketCount>12?'2-digit':undefined}).format(d));
    }else{
      bucketCount=Math.min(days,90)+futureDays;granularity='day';
      indexFor=(date)=>{const d=new Date(date);if(Number.isNaN(d.getTime()))return -1;const index=dayOrdinal(d)-dayOrdinal(start);return index>=0&&index<bucketCount?index:-1};
      dates=Array.from({length:bucketCount},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i));labels=Array(bucketCount).fill('');
      const tickIndices=[0,Math.floor((bucketCount-1)/3),Math.floor(2*(bucketCount-1)/3),bucketCount-1];
      [...new Set(tickIndices)].forEach(i=>{const d=dates[i];labels[i]=`${d.getDate()} ${new Intl.DateTimeFormat(locale(),{month:'short'}).format(d)}`});
    }
  }
  const actual=Array(bucketCount).fill(0),forecast=Array(bucketCount).fill(0);
  for(const record of state.trades){
    if(record.soldAt){const i=indexFor(record.soldAt);if(i>=0)actual[i]+=realizedProfit(record)/100}
    else {const i=indexFor(forecastDate(record));if(i>=0)forecast[i]+=plannedProfit(record)/100}
  }
  const chart=$('#profit-chart');chart.onpointermove=null;chart.onpointerleave=null;chart._chartPoint=-1;chart.innerHTML=state.trades.length?chartSvg(actual,forecast,labels):'<div class="chart-placeholder">İlk satışını kaydettiğinde kâr eğrin burada görünecek.</div>';
  if(state.trades.length)attachChartTooltip(chart,actual,forecast,dates,granularity);
  const actualSum=Math.round(actual.reduce((a,b)=>a+b,0)*100),forecastSum=Math.round(forecast.reduce((a,b)=>a+b,0)*100);
  const hasForecast=forecast.some(value=>value!==0);
  const period=allTime?'tüm tarihler':days>180?'son 12 ay':`son ${days} gün`;
  $('#chart-total').textContent=money(actualSum);$('#chart-period').textContent=hasForecast?`${period} + tahmin`:period;
  const forecastSign=forecastSum>0?'+':forecastSum<0?'−':'';
  $('#chart-change').textContent=hasForecast?`${forecastSign}${money(Math.abs(forecastSum))} tahmini`:state.trades.length?'net kâr':'—';
}

function historyRows(){
  const q=state.filters.search.toLocaleLowerCase('tr');
  let records=state.trades.filter(record=>{
    const allItems=[recordMainItem(record),record.charm,record.slab,...(record.extras||[]).map(e=>e.item||e)].filter(Boolean);
    const matchesSearch=!q||record.id.toLocaleLowerCase('tr').includes(q)||allItems.some(item=>itemName(item).toLocaleLowerCase('tr').includes(q));
    const matchesStatus=state.filters.status==='all'||(state.filters.status==='sold'?!!record.soldAt:!record.soldAt);
    const categories=allItems.map(x=>x.category||record.category||'other');
    const matchesType=state.filters.type==='all'||categories.includes(state.filters.type)||(state.filters.type==='other'&&categories.some(c=>!Object.hasOwn(LABELS,c)));
    const matchesWear=state.filters.wear==='all'||allItems.some(item=>itemWear(item)===state.filters.wear);
    const date=new Date(record.boughtAt),from=state.filters.from?new Date(`${state.filters.from}T00:00:00`):null,to=state.filters.to?new Date(`${state.filters.to}T23:59:59.999`):null;
    const matchesDate=(!from||date>=from)&&(!to||date<=to);
    return matchesSearch&&matchesStatus&&matchesType&&matchesWear&&matchesDate;
  });
  const sort=state.filters.sort;
  records.sort((a,b)=>{
  if(sort==='date-asc')return new Date(a.boughtAt)-new Date(b.boughtAt);
    if(sort==='id-desc'||sort==='id-asc'){const order=(Number(a.id.replace(/\D/g,''))||0)-(Number(b.id.replace(/\D/g,''))||0);return sort==='id-desc'?-order:order}
    if(sort==='profit-desc')return (b.soldAt?realizedProfit(b):plannedProfit(b))-(a.soldAt?realizedProfit(a):plannedProfit(a));
    if(sort==='profit-asc')return (a.soldAt?realizedProfit(a):plannedProfit(a))-(b.soldAt?realizedProfit(b):plannedProfit(b));
    if(sort==='cost-desc')return b.buyCents-a.buyCents;
    return new Date(b.boughtAt)-new Date(a.boughtAt);
  });return records;
}
function renderHistory(){
  const body=$('#history-body'),rows=historyRows();
  body.innerHTML=rows.map(record=>{
    const total=totalsFor(record,!!record.soldAt),profit=record.soldAt?total.profit:plannedProfit(record),date=record.soldAt?record.soldAt:record.boughtAt;
    const items=[recordMainItem(record),record.charm,record.slab,...(record.extras||[]).map(x=>x.item||x)].filter(Boolean);
    const category=items[0]?.category||record.category;
    const status=statusMarkup(record);
    return `<tr data-record="${escapeHtml(record.id)}"><td><span class="transaction-id">${escapeHtml(record.id)}</span></td><td>${itemCell(record,true)}</td><td><span class="date-cell">${escapeHtml(shortDate(date))}<small>${escapeHtml(new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(date)))}</small></span></td><td class="money">${money(record.buyCents)}</td><td class="money">${record.soldAt?money(total.net):`~${money(totalsFor(record).net)}`}</td><td class="money ${profit>=0?'money-positive':'money-negative'}">${record.soldAt?'': '~'}${money(profit)}</td><td>${status}</td><td><span class="row-actions"><button class="row-action" data-action="detail" data-id="${escapeHtml(record.id)}" title="Ayrıntı" aria-label="Ayrıntı">↗</button><button class="row-action" data-action="edit" data-id="${escapeHtml(record.id)}" title="Düzenle" aria-label="Düzenle">✎</button><button class="row-action delete" data-action="delete" data-id="${escapeHtml(record.id)}" title="Sil" aria-label="Sil">×</button></span></td></tr>`
  }).join('');
  $('#history-empty').hidden=rows.length>0;$('#history-body').closest('.table-wrap').hidden=rows.length===0;
  $('#result-count').textContent=`${rows.length} / ${state.trades.length} kayıt`;
  const sold=state.trades.filter(t=>t.soldAt),open=state.trades.filter(t=>!t.soldAt);
  $('#history-summary').innerHTML=`<span class="summary-chip">Toplam kayıt <strong>${state.trades.length}</strong></span><span class="summary-chip">Aktif <strong>${open.length}</strong></span><span class="summary-chip">Satıldı <strong>${sold.length}</strong></span><span class="summary-chip">Gerçekleşen kâr <strong>${money(sold.reduce((s,t)=>s+realizedProfit(t),0))}</strong></span>`;
  updateImageFallbacks();
}
function renderReports(){
  const option=$('#report-month').value||'current',now=new Date();let start,end;
  if(option==='previous'){start=new Date(now.getFullYear(),now.getMonth()-1,1);end=new Date(now.getFullYear(),now.getMonth(),1)}
  else if(option==='year'){start=new Date(now.getFullYear(),0,1);end=new Date(now.getFullYear()+1,0,1)}
  else if(option==='all'){start=new Date(0);end=new Date(8640000000000000)}
  else {start=new Date(now.getFullYear(),now.getMonth(),1);end=new Date(now.getFullYear(),now.getMonth()+1,1)}
  const range=state.trades.filter(t=>new Date(t.soldAt||t.boughtAt)>=start&&new Date(t.soldAt||t.boughtAt)<end);
  const sold=range.filter(t=>t.soldAt),active=range.filter(t=>!t.soldAt),profit=sold.reduce((s,t)=>s+realizedProfit(t),0),forecast=active.reduce((s,t)=>s+plannedProfit(t),0);
  $('#report-cards').innerHTML=[['Gerçekleşen kâr',money(profit),`${sold.length} tamamlanan satış`],['Tahmini açık kâr',money(forecast),`${active.length} aktif işlem`],['Satış geliri',money(sold.reduce((s,t)=>s+totalsFor(t,true).net,0)),`komisyon sonrası`],['Yatırılan tutar',money(range.reduce((s,t)=>s+t.buyCents,0)),`${range.length} toplam işlem`]].map((x,i)=>`<article class="report-card"><small>${x[0]}</small><strong class="${i===0&&profit>=0?'money-positive':''}">${x[1]}</strong><span>${x[2]}</span></article>`).join('');
  const months=Array.from({length:12},(_,i)=>new Date(now.getFullYear(),now.getMonth()-11+i,1));
  const monthValues=months.map(month=>state.trades.filter(t=>t.soldAt&&new Date(t.soldAt).getFullYear()===month.getFullYear()&&new Date(t.soldAt).getMonth()===month.getMonth()).reduce((s,t)=>s+realizedProfit(t)/100,0));
  $('#monthly-chart').innerHTML=state.trades.length?chartSvg(monthValues,[],months.map(d=>new Intl.DateTimeFormat(locale(),{month:'short'}).format(d))):'<div class="chart-placeholder">İşlem kayıtların oluştukça rapor burada görünür.</div>';
  const catMap=new Map();for(const t of sold){const cat=categoryName(recordMainItem(t).category||t.category);catMap.set(cat,(catMap.get(cat)||0)+realizedProfit(t))}
  const catRows=[...catMap].sort((a,b)=>b[1]-a[1]),maxCat=Math.max(1,...catRows.map(x=>Math.abs(x[1])));
  $('#category-report').innerHTML=catRows.length?catRows.slice(0,7).map(([name,value])=>`<div class="category-line"><span>${escapeHtml(name)}</span><span class="category-bar"><i style="width:${Math.max(3,Math.abs(value)/maxCat*100)}%"></i></span><strong class="${value<0?'money-negative':''}">${money(value)}</strong></div>`).join(''):'<div class="chart-placeholder">Satış kaydı bulunmuyor.</div>';
  const itemMap=new Map();for(const t of sold){const name=itemName(recordMainItem(t)),entry=itemMap.get(name)||{name,count:0,cost:0,sale:0,profit:0};const result=totalsFor(t,true);entry.count++;entry.cost+=t.buyCents;entry.sale+=result.net;entry.profit+=result.profit;itemMap.set(name,entry)}
  const items=[...itemMap.values()].sort((a,b)=>b.profit-a.profit);
  $('#item-report-body').innerHTML=items.slice(0,10).map(x=>`<tr><td><span class="item-copy"><strong>${escapeHtml(x.name)}</strong></span></td><td>${x.count}</td><td class="money">${money(x.cost/x.count)}</td><td class="money">${money(x.sale/x.count)}</td><td class="money ${x.profit>=0?'money-positive':'money-negative'}">${money(x.profit)}</td></tr>`).join('');
  $('#report-empty').hidden=items.length>0;$('#item-report-body').closest('.table-wrap').hidden=items.length===0;
}
function renderSettings(){
  $('#setting-fee-rate').value=state.settings.feeRate;$('#setting-fee-fixed').value=(state.settings.feeFixed/100).toFixed(2);$('#setting-lock-days').value=state.settings.lockDays;
  $('#setting-language').value=window.CSELL_LANGUAGE==='tr'?'tr':'en';
  $('#settings-record-count').textContent=`${state.trades.length} işlem`;
  const cached=state.catalog.size;$('#settings-catalog-status').textContent=cached?`${cached} kategori önbelleğe alındı`:'İlk kullanımda yüklenir';
}

function renderCategoryPills(){
  $('#category-pills').innerHTML=PILL_CATEGORIES.map(category=>`<button type="button" class="category-pill${state.editor.category===category?' active':''}" data-category="${category}">${escapeHtml(categoryName(category))}</button>`).join('');
}
function normalizedItem(item,category){return {...item,category:item.category||category,market_hash_name:item.market_hash_name||item.name}}
function matchingItems(category,query){
  const values=state.catalog.get(category)||[];const q=(query||'').trim().toLocaleLowerCase('tr');
  if(!q)return values.slice(0,45);
  const tokens=q.split(/\s+/).filter(Boolean);
  return values.filter(item=>{const name=itemName(item).toLocaleLowerCase('tr');return tokens.every(token=>name.includes(token))}).slice(0,50);
}
function renderResults(container,items,category,selectAction){
  if(!items.length){container.innerHTML='<div class="results-empty">Eşleşme bulunamadı. İstersen ürünü adını yazarak ekle.</div>';return}
  container.innerHTML=items.map((item,index)=>{
    const safe=normalizedItem(item,category),image=itemImage(safe),rarity=safe.rarity?.name||safe.type||categoryName(category),color=rarityColor(safe);
    return `<button type="button" class="result-item" role="option" data-select-kind="${selectAction}" data-index="${index}"><span class="result-thumb">${image?`<img loading="lazy" src="${escapeHtml(image)}" alt="">`:'◈'}</span><span class="result-copy"><strong>${escapeHtml(itemName(safe))}</strong><small><i class="rarity-dot" style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${escapeHtml(color)}"></i> ${escapeHtml(rarity)}</small></span></button>`
  }).join('');
  container._results=items.map(item=>normalizedItem(item,category));updateImageFallbacks(container);
}
function renderMainResults(){
  const q=$('#item-search').value;const results=$('#item-results');
  if(!state.catalog.has(state.editor.category)){results.innerHTML='<div class="results-empty">Katalog hazırlanıyor…</div>';return}
  renderResults(results,matchingItems(state.editor.category,q),state.editor.category,'main');
}
async function setMainCategory(category){
  state.editor.category=category;state.editor.main=null;state.editor.selectedItem=null;
  $('#item-search').value='';$('#item-results').hidden=true;$('#selected-main').hidden=true;$('#manual-item-toggle').checked=false;$('#manual-fields').hidden=true;$('#manual-name').value='';$('#manual-image').value='';renderCategoryPills();
  $('#item-picker-label').textContent=itemSearchLabel(category);
  $('#picker-loading').hidden=false;await ensureCatalog(category);$('#picker-loading').hidden=true;renderMainResults();
}
function selectMainItem(item){
  state.editor.main=item;$('#manual-item-toggle').checked=false;$('#manual-fields').hidden=true;$('#manual-name').value='';$('#manual-image').value='';$('#item-results').innerHTML='';$('#item-results').hidden=true;$('#item-search').value='';
  const card=$('#selected-main');card.hidden=false;
  card.innerHTML=`${selectedImage(item)}<span class="selected-item-copy"><strong>${escapeHtml(itemName(item))}</strong><small>${escapeHtml(categoryName(item.category))}${item.rarity?.name?` · ${escapeHtml(item.rarity.name)}`:''}</small></span><button type="button" data-clear-main aria-label="Ürünü kaldır">×</button>`;
  $('#item-picker-label').textContent='Seçilen ürün';updateImageFallbacks(card);updateSalePreview();if($('#mark-sold').checked)renderActualPrices();
}
async function setupMiniPicker(type){
  const category=type==='charm'?'charm':'sticker_slab';const input=$(`#${type}-search`);const results=$(`#${type}-results`);
  await ensureCatalog(category);renderResults(results,matchingItems(category,input.value),category,type);
}
function selectAttachment(type,item){
  state.editor[type]=item;const holder=$(`#selected-${type}`);holder.hidden=false;
  const img=itemImage(item);holder.innerHTML=`${img?`<img loading="lazy" src="${escapeHtml(img)}" alt="">`:''}<strong title="${escapeHtml(itemName(item))}">${escapeHtml(itemName(item))}</strong><button type="button" data-clear-attachment="${type}" aria-label="Kaldır">×</button>`;
  $(`#${type}-results`).innerHTML='';$(`#${type}-search`).value='';updateImageFallbacks(holder);updateSalePreview();if($('#mark-sold').checked)renderActualPrices();
}
function selectedSaleEntries(){
  const lines=[];if(state.editor.main)lines.push({key:'main',name:itemName(state.editor.main),price:cents($('#main-sale').value)});
  if(state.editor.charm)lines.push({key:'charm',name:itemName(state.editor.charm),price:cents($('#charm-sale').value)});
  if(state.editor.slab)lines.push({key:'slab',name:itemName(state.editor.slab),price:cents($('#slab-sale').value)});
  state.editor.extras.forEach(item=>lines.push({key:item.lineId,name:itemName(item),price:cents($(`[data-extra-price="${CSS.escape(item.lineId)}"]`)?.value)}));return lines;
}
function updateSalePreview(){
  const lines=selectedSaleEntries(),container=$('#sale-lines-preview');const raw=lines.reduce((sum,x)=>sum+x.price,0),net=lines.reduce((sum,x)=>sum+netCents(x.price),0);
  container.innerHTML=`${lines.map(line=>`<div class="sale-preview-row"><span>${escapeHtml(line.name)}</span><strong>${money(line.price)} <span>− ${money(feeCents(line.price))} →</span> ${money(netCents(line.price))}</strong></div>`).join('')}<div class="sale-preview-row total"><span>Toplam net satış <small>(%${escapeHtml(state.settings.feeRate)} komisyon sonrası)</small></span><strong>${money(net)}</strong></div>`;
  updateProfitEstimate();
}
function updateProfitEstimate(){
  const buy=cents($('#buy-price').value),lines=selectedSaleEntries();
  const sold=$('#mark-sold').checked,actual=lines.reduce((sum,line)=>{const input=$(`[data-actual-price="${CSS.escape(line.key)}"]`);return sum+netCents(input?cents(input.value):line.price)},0);
  const expected=lines.reduce((sum,line)=>sum+netCents(line.price),0);
  const value=(sold?actual:expected)-buy;
  $('#estimate-profit').textContent=money(value);$('#estimate-profit').style.color=value<0?'#e99797':'#bdf191';
  $('#estimate-label').textContent=sold?'Gerçekleşen net kâr':'Komisyon sonrası tahmini kâr';
  const gross=lines.reduce((sum,line)=>sum+(sold?cents($(`[data-actual-price="${CSS.escape(line.key)}"]`)?.value??line.price):line.price),0);
  const fees=gross-(sold?actual:expected);$('#estimate-detail').textContent=lines.length?`${money(gross)} satış − ${money(fees)} kesinti − ${money(buy)} alış`:'Satış fiyatlarını girince hesaplanır';
}
function editorLineRows(){
  const rows=[];if(state.editor.main)rows.push({key:'main',name:itemName(state.editor.main),expected:$('#main-sale').value});
  if(state.editor.charm)rows.push({key:'charm',name:itemName(state.editor.charm),expected:$('#charm-sale').value});
  if(state.editor.slab)rows.push({key:'slab',name:itemName(state.editor.slab),expected:$('#slab-sale').value});
  state.editor.extras.forEach(item=>rows.push({key:item.lineId,name:itemName(item),expected:$(`[data-extra-price="${CSS.escape(item.lineId)}"]`)?.value||''}));return rows;
}
function renderActualPrices(record=null){
  const rows=editorLineRows(),container=$('#actual-prices');
  if(!rows.length){container.innerHTML='<div class="results-empty">Önce ürün seç.</div>';return}
  const old=record?.actualPrices||{};
  container.innerHTML=rows.map(row=>{const previous=old[row.key]!==undefined?(Number(old[row.key])/100).toFixed(2):row.expected;return `<label class="actual-price-row"><span>${escapeHtml(row.name)}</span><input type="number" data-actual-price="${escapeHtml(row.key)}" min="0" step="0.01" value="${escapeHtml(previous)}" placeholder="0.00" aria-label="${escapeHtml(row.name)} gerçek satış fiyatı"></label>`}).join('');
  container.querySelectorAll('input').forEach(input=>input.addEventListener('input',updateProfitEstimate));
}
function updateUnlockPreview(){
  const bought=new Date($('#bought-at').value||Date.now()),days=Math.max(0,Number($('#lock-days').value)||0),unlock=new Date(bought.getTime()+days*86400000);
  $('#lock-info').textContent=window.CSELL_LANGUAGE==='en'?`Trade unlock time is exactly ${days} × 24 hours after purchase.`:`Kilit açılışı alış anından tam ${days} × 24 saat sonra hesaplanır.`;
  $('#unlock-preview-date').textContent=localDateTime(unlock);
}
function clearEditor(){
  state.editor={recordId:null,category:'skin',main:null,charm:null,slab:null,extras:[],selectedItem:null};
  $('#trade-form').reset();$('#dialog-id').textContent='';$('#dialog-title').textContent='Yeni işlem oluştur';$('#save-trade').innerHTML='Kaydı oluştur <span>→</span>';
  $('#bought-at').value=localInputValue();$('#lock-days').value=state.settings.lockDays;
  $('#has-charm').checked=false;$('#has-slab').checked=false;$('#charm-picker').hidden=true;$('#slab-picker').hidden=true;
  $('#selected-main').hidden=true;$('#selected-charm').hidden=true;$('#selected-slab').hidden=true;$('#manual-item-toggle').checked=false;$('#manual-fields').hidden=true;$('#manual-name').value='';$('#manual-image').value='';
  $('#main-sale').value='';$('#charm-sale').value='';$('#slab-sale').value='';$('#buy-price').value='';$('#trade-notes').value='';$('#extra-attachment-form').hidden=true;$('#extra-selected-list').innerHTML='';$('#actual-prices').innerHTML='';$('#actual-prices').hidden=true;$('#mark-sold').checked=false;$('#realized-section').hidden=false;
  $('#item-search').value='';$('#item-results').innerHTML='';$('#item-results').hidden=true;$('#extra-search').value='';$('#extra-results').innerHTML='';
  renderCategoryPills();$('#item-picker-label').textContent=itemSearchLabel('skin');updateSalePreview();updateUnlockPreview();
}
async function openTradeDialog(recordId=null){
  clearEditor();const record=recordId?state.trades.find(item=>item.id===recordId):null;
  $('#trade-dialog').showModal();
  if(record){
    state.editor.recordId=record.id;state.editor.category=record.main?.category||record.category||'skin';
    renderCategoryPills();$('#item-picker-label').textContent=itemSearchLabel(state.editor.category);
    state.editor.main=record.main||{name:record.name,market_hash_name:record.name,category:record.category,image:record.image};
    state.editor.charm=record.charm||null;state.editor.slab=record.slab||null;state.editor.extras=structuredClone(record.extras||[]);
    $('#dialog-id').textContent=record.id;$('#dialog-title').textContent='İşlemi düzenle';$('#save-trade').innerHTML='Değişiklikleri kaydet <span>→</span>';
    $('#buy-price').value=(record.buyCents/100).toFixed(2);$('#main-sale').value=(record.mainSale/100).toFixed(2);$('#bought-at').value=localInputValue(new Date(record.boughtAt));$('#lock-days').value=record.lockDays;
    $('#trade-notes').value=record.notes||'';$('#has-charm').checked=!!record.charm;$('#has-slab').checked=!!record.slab;$('#charm-picker').hidden=!record.charm;$('#slab-picker').hidden=!record.slab;
    if(record.charm){$('#charm-sale').value=(record.charmSale/100).toFixed(2);selectAttachment('charm',record.charm)}
    if(record.slab){$('#slab-sale').value=(record.slabSale/100).toFixed(2);selectAttachment('slab',record.slab)}
    for(const extra of state.editor.extras){extra.lineId ||= extra.id||`extra-${crypto.randomUUID()}`;extra.category=extra.item?.category||extra.category||'other'}
    renderExtraSelected();
    selectMainItem(state.editor.main);
    $('#mark-sold').checked=!!record.soldAt;renderActualPrices(record);$('#actual-prices').hidden=!record.soldAt;
  } else {setMainCategory('skin')}
  updateSalePreview();updateUnlockPreview();
}
function renderExtraSelected(){
  const container=$('#extra-selected-list');container.innerHTML=state.editor.extras.map(item=>`<div class="extra-selected-row"><strong>${escapeHtml(itemName(item))}</strong><label class="input-prefix"><span>$</span><input type="number" min="0" step="0.01" value="${escapeHtml(((item.sale||0)/100).toFixed(2))}" data-extra-price="${escapeHtml(item.lineId)}" aria-label="${escapeHtml(itemName(item))} satış fiyatı"></label><button type="button" data-remove-extra="${escapeHtml(item.lineId)}" aria-label="Itemi kaldır">×</button></div>`).join('');
  container.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{const extra=state.editor.extras.find(x=>x.lineId===input.dataset.extraPrice);if(extra)extra.sale=cents(input.value);updateSalePreview();if($('#mark-sold').checked)renderActualPrices()}));
  updateSalePreview();
}
function chooseExtra(item){
  const lineId=`extra-${crypto.randomUUID()}`;state.editor.extras.push({...item,lineId,sale:0});renderExtraSelected();$('#extra-results').innerHTML='';$('#extra-search').value='';
  if($('#mark-sold').checked)renderActualPrices();
}
function editorRecord(){
  const main=state.editor.main;
  const extras=state.editor.extras.map(item=>({...item,sale:cents($(`[data-extra-price="${CSS.escape(item.lineId)}"]`)?.value)}));
  const actualPrices={};$$('[data-actual-price]').forEach(input=>actualPrices[input.dataset.actualPrice]=cents(input.value));
  return {main,charm:state.editor.charm,slab:state.editor.slab,extras,category:main?.category||state.editor.category,name:itemName(main),image:itemImage(main),mainSale:cents($('#main-sale').value),charmSale:cents($('#charm-sale').value),slabSale:cents($('#slab-sale').value),buyCents:cents($('#buy-price').value),boughtAt:new Date($('#bought-at').value).toISOString(),lockDays:Math.max(0,Number($('#lock-days').value)||0),notes:$('#trade-notes').value.trim(),actualPrices,soldAt:$('#mark-sold').checked?(state.trades.find(t=>t.id===state.editor.recordId)?.soldAt||new Date().toISOString()):null,updatedAt:new Date().toISOString()};
}
function addRecordEvent(record,type,description,at=new Date().toISOString()){
  record.events=[...(record.events||[]),{type,description,at}];
}
async function saveEditor(event){
  event.preventDefault();
  if(!state.editor.main){toast('Önce bir ürün seç veya ürün adını kendin yaz.','error');return}
  if(!$('#buy-price').value||Number($('#buy-price').value)<0){$('#buy-price').focus();toast('Toplam alış maliyetini gir.','error');return}
  const record=editorRecord();
  if(!record.boughtAt||Number.isNaN(new Date(record.boughtAt).getTime())){toast('Geçerli bir alış tarihi ve saati seç.','error');return}
  if(record.soldAt){record.soldAt=state.trades.find(t=>t.id===state.editor.recordId)?.soldAt||new Date().toISOString();record.actualPrices=record.actualPrices||{main:record.mainSale}}
  const previous=state.trades.find(t=>t.id===state.editor.recordId),eventTime=new Date().toISOString();
  if(previous){
    record.id=previous.id;record.createdAt=previous.createdAt||previous.updatedAt||previous.boughtAt;record.events=previous.events||[{type:'created',description:'İşlem kaydı oluşturuldu',at:record.createdAt}];
    if(!previous.soldAt&&record.soldAt)addRecordEvent(record,'sold','Satış tamamlandı; gerçek fiyatlar kaydedildi.',record.soldAt);
    else if(previous.soldAt&&record.soldAt&&JSON.stringify(previous.actualPrices)!==JSON.stringify(record.actualPrices))addRecordEvent(record,'sale-edited','Gerçek satış fiyatları güncellendi.',eventTime);
    else addRecordEvent(record,'updated','İşlem bilgileri güncellendi.',eventTime);
  }else{
    const sequence=Number(state.settings.nextId)||1;record.id=`C-${String(sequence).padStart(6,'0')}`;state.settings.nextId=sequence+1;record.createdAt=eventTime;record.events=[{type:'created',description:'İşlem kaydı oluşturuldu',at:eventTime}];
    if(record.soldAt)addRecordEvent(record,'sold','Satış tamamlandı; gerçek fiyatlar kaydedildi.',record.soldAt);
    await dbRequest('settings','put',{key:'app',value:state.settings});
  }
  await dbRequest('trades','put',record);toast(`${record.id} ${previous?'güncellendi':'kaydedildi'}.`);
  $('#trade-dialog').close();await refreshTrades();
}
function toggleAttachment(type,checked){
  const picker=$(`#${type}-picker`);picker.hidden=!checked;
  if(!checked){state.editor[type]=null;$(`#selected-${type}`).hidden=true;$(`#${type}-sale`).value=''}else setupMiniPicker(type);
  updateSalePreview();if($('#mark-sold').checked)renderActualPrices();
}

function openDetail(id){
  const record=state.trades.find(item=>item.id===id);if(!record)return;state.detailId=id;
  const detailPrice=(key,planned)=>record.soldAt?(record.actualPrices?.[key]??planned):planned;
  const itemList=[{key:'main',item:recordMainItem(record),price:detailPrice('main',record.mainSale)},{key:'charm',item:record.charm,price:detailPrice('charm',record.charmSale)},{key:'slab',item:record.slab,price:detailPrice('slab',record.slabSale)},...(record.extras||[]).map(extra=>{const key=extra.lineId||extra.id;return {key,item:extra.item||extra,price:detailPrice(key,extra.sale??0)}})].filter(row=>row.item);
  const actual=totalsFor(record,true),expected=totalsFor(record,false),profit=record.soldAt?actual.profit:expected.profit;
  const unlock=unlockAt(record),timeline=[{description:'Ürün alış zamanı',at:record.boughtAt,type:'buy'},{description:isReady(record)?'Trade koruması kalktı':'Trade koruması kalkacak',at:unlock.toISOString(),type:'unlock'},...(record.events||[])].sort((a,b)=>new Date(a.at)-new Date(b.at));
  $('#detail-id').textContent=record.id;$('#detail-title').textContent=itemName(recordMainItem(record));
  $('#detail-content').innerHTML=`<div class="detail-items">${itemList.map((row,index)=>`<div class="detail-item">${selectedImage(row.item)}<div><strong>${escapeHtml(itemName(row.item))}</strong><small>${escapeHtml(index===0?'Ana ürün':categoryName(row.item.category||'other'))} · ${record.soldAt?'gerçek satış':'tahmini satış'}</small></div><b>${money(row.price)}</b></div>`).join('')}</div><div class="detail-stats"><div class="detail-stat"><small>Toplam alış maliyeti</small><strong>${money(record.buyCents)}</strong></div><div class="detail-stat"><small>${record.soldAt?'Gerçekleşen net kâr':'Tahmini net kâr'}</small><strong class="${profit>=0?'money-positive':'money-negative'}">${record.soldAt?'':'~'}${money(profit)}</strong></div><div class="detail-stat"><small>${record.soldAt?'Net satış':'Tahmini net satış'}</small><strong>${money(record.soldAt?actual.net:expected.net)}</strong></div><div class="detail-stat"><small>Ürün satış ücretleri</small><strong>${money(record.soldAt?actual.fees:expected.fees)}</strong></div></div><div class="detail-lock">◷ Trade kilidinin açılış saati <span>·</span>${escapeHtml(localDateTime(unlock))}${record.soldAt?`<span>·</span>Satış ${escapeHtml(localDateTime(record.soldAt))}`:''}</div><div class="detail-timeline">${timeline.map(event=>`<div class="timeline-entry"><span>${event.type==='sold'?'✓':event.type==='updated'||event.type==='sale-edited'?'↻':'●'}</span><span>${escapeHtml(event.description)}<small>${escapeHtml(localDateTime(event.at))}</small></span></div>`).join('')}</div>${record.notes?`<div class="detail-notes">${escapeHtml(record.notes)}</div>`:''}`;
  $('#detail-sold').hidden=!!record.soldAt;$('#detail-sold').textContent='Satıldı olarak işaretle';$('#detail-dialog').showModal();updateImageFallbacks($('#detail-content'));
}
async function deleteTrade(id){
  const record=state.trades.find(item=>item.id===id);if(!record)return;
  if(!confirm(`${record.id} — ${itemName(recordMainItem(record))} kaydı silinsin mi?`))return;
  await dbRequest('trades','delete',id);if(state.detailId===id)$('#detail-dialog').close();await refreshTrades();toast(`${id} silindi.`);
}
async function markSold(id){
  const record=state.trades.find(t=>t.id===id);if(!record)return;
  record.soldAt=new Date().toISOString();record.updatedAt=record.soldAt;record.actualPrices={main:record.mainSale};if(record.charm)record.actualPrices.charm=record.charmSale;if(record.slab)record.actualPrices.slab=record.slabSale;for(const extra of record.extras||[])record.actualPrices[extra.lineId||extra.id]=extra.sale||0;addRecordEvent(record,'sold','Satış tamamlandı; gerçek fiyatlar kaydedildi.',record.soldAt);
  await dbRequest('trades','put',record);$('#detail-dialog').close();await refreshTrades();toast(`${id} satıldı olarak kaydedildi.`);
}

function exportCsv(){
  const rows=historyRows();if(!rows.length){toast('Dışa aktarılacak kayıt bulunmuyor.','error');return}
  const headers=['İşlem No','Durum','Item','Kategori','Ek itemler','Alış zamanı','Trade açılış zamanı','Kilit (gün)','Alış maliyeti USD','Tahmini brüt satış USD','Tahmini komisyon USD','Tahmini net satış USD','Tahmini net kâr USD','Gerçek satış zamanı','Gerçek net satış USD','Gerçekleşen net kâr USD','Kayıt günlüğü','Not'].map(value=>window.CSELL_I18N?.translate?.(value)||value);
  const quote=(v)=>`"${String(v??'').replaceAll('"','""')}"`;
  const translate=value=>window.CSELL_I18N?.translate?.(value)||value;
  const data=rows.map(r=>{const expected=totalsFor(r),actual=totalsFor(r,true),extras=[r.charm,r.slab,...(r.extras||[]).map(x=>x.item||x)].filter(Boolean).map(itemName).join(' · '),log=(r.events||[]).map(event=>`${localDateTime(event.at)} ${translate(event.description)}`).join(' | ');return [r.id,translate(r.soldAt?'Satıldı':isReady(r)?'Satışa hazır':'Trade kilitli'),itemName(recordMainItem(r)),categoryName(recordMainItem(r).category||r.category),extras,localDateTime(r.boughtAt),localDateTime(unlockAt(r)),r.lockDays,(r.buyCents/100).toFixed(2),(expected.gross/100).toFixed(2),(expected.fees/100).toFixed(2),(expected.net/100).toFixed(2),(expected.profit/100).toFixed(2),r.soldAt?localDateTime(r.soldAt):'',r.soldAt?(actual.net/100).toFixed(2):'',r.soldAt?(actual.profit/100).toFixed(2):'',log,r.notes||'']});
  const prefix=window.CSELL_LANGUAGE==='en'?'csell-trade-history':'csell-islem-gecmisi';
  const csv='\uFEFF'+[headers,...data].map(row=>row.map(quote).join(',')).join('\r\n');downloadBlob(csv,`${prefix}-${new Date().toISOString().slice(0,10)}.csv`,'text/csv;charset=utf-8');toast(`${rows.length} kayıt CSV olarak indirildi.`);
}
function backupData(){return {app:'CSELL',schemaVersion:1,exportedAt:new Date().toISOString(),settings:state.settings,trades:state.trades}}
function exportJson(){const payload=JSON.stringify(backupData(),null,2),prefix=window.CSELL_LANGUAGE==='en'?'csell-backup':'csell-yedek';downloadBlob(payload,`${prefix}-${new Date().toISOString().slice(0,10)}.json`,'application/json');toast('CSELL yedeği indirildi.')}
function downloadBlob(content,name,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
async function restoreJson(file){
  try{const payload=JSON.parse(await file.text());if(payload.app!=='CSELL'||!Array.isArray(payload.trades))throw new Error('Bu dosya CSELL yedeği değil.');
    if(!confirm(`${payload.trades.length} kayıt yüklenecek. Mevcut kayıtlar aynı işlem numaraları için güncellenecek. Devam edilsin mi?`))return;
    let restored=0;for(const record of payload.trades){if(!record.id||!record.boughtAt||!record.main)continue;await dbRequest('trades','put',record);restored++}
    if(payload.settings)state.settings={...state.settings,...payload.settings};
    const highestId=Math.max(0,...state.trades.map(record=>Number(String(record.id||'').replace(/\D/g,''))||0),...payload.trades.map(record=>Number(String(record.id||'').replace(/\D/g,''))||0));state.settings.nextId=Math.max(Number(state.settings.nextId)||1,highestId+1);
    await dbRequest('settings','put',{key:'app',value:state.settings});await refreshTrades();toast(`${restored} kayıt yedekten yüklendi.`)
  }catch(error){toast(error.message||'Yedek dosyası okunamadı.','error')}
}
async function refreshTrades(){state.trades=await dbRequest('trades','getAll');renderDashboard();if(state.activePage==='history')renderHistory();if(state.activePage==='reports')renderReports();if(state.activePage==='settings')renderSettings()}

function attachEvents(){
  document.addEventListener('click',async event=>{
    if(!event.target.closest('.item-picker-wrap'))$('#item-results').hidden=true;
    const page=event.target.closest('[data-page]');if(page){navigate(page.dataset.page);return}
    const add=event.target.closest('[data-action="add"]');if(add){openTradeDialog();return}
    const action=event.target.closest('[data-action]');if(action?.dataset.id){if(action.dataset.action==='detail')openDetail(action.dataset.id);if(action.dataset.action==='edit')openTradeDialog(action.dataset.id);if(action.dataset.action==='delete')deleteTrade(action.dataset.id);return}
    const category=event.target.closest('[data-category]');if(category){setMainCategory(category.dataset.category);return}
    const result=event.target.closest('[data-select-kind]');if(result){const list=result.closest('.item-results'),item=list?._results?.[Number(result.dataset.index)];if(!item)return;const kind=result.dataset.selectKind;if(kind==='main')selectMainItem(item);else if(kind==='charm'||kind==='slab')selectAttachment(kind,item);else if(kind==='extra')chooseExtra(item);return}
    const removeExtra=event.target.closest('[data-remove-extra]');if(removeExtra){state.editor.extras=state.editor.extras.filter(x=>x.lineId!==removeExtra.dataset.removeExtra);renderExtraSelected();return}
    const clearAttachment=event.target.closest('[data-clear-attachment]');if(clearAttachment){const type=clearAttachment.dataset.clearAttachment;state.editor[type]=null;$(`#selected-${type}`).hidden=true;updateSalePreview();return}
    if(event.target.closest('[data-clear-main]')){state.editor.main=null;$('#selected-main').hidden=true;updateSalePreview();return}
    if(event.target.closest('[data-close-dialog]')){$('#trade-dialog').close();return}
    if(event.target.closest('[data-close-detail]')){$('#detail-dialog').close();return}
  });
  $('#quick-add').addEventListener('click',()=>openTradeDialog());
  $('#trade-form').addEventListener('submit',saveEditor);
  const refreshMainResults=async()=>{const input=$('#item-search');if(document.activeElement!==input)return;$('#item-results').hidden=false;if(!state.catalog.has(state.editor.category))await ensureCatalog(state.editor.category);renderMainResults()};
  $('#item-search').addEventListener('focus',refreshMainResults);
  $('#item-search').addEventListener('input',refreshMainResults);
  $('#item-search').addEventListener('keydown',event=>{if(event.key==='Escape'){$('#item-results').hidden=true;event.preventDefault()}});
  $('#manual-item-toggle').addEventListener('change',event=>{$('#manual-fields').hidden=!event.target.checked;if(event.target.checked){state.editor.main=null;$('#selected-main').hidden=true;$('#item-results').innerHTML='';$('#item-results').hidden=true;$('#item-search').value=''}else if(String(state.editor.main?.id||'').startsWith('manual-')){state.editor.main=null;$('#selected-main').hidden=true;updateSalePreview()} });
  $('#manual-name').addEventListener('input',()=>{
    const name=$('#manual-name').value.trim();if(!name)return;
    state.editor.main={id:`manual-${crypto.randomUUID()}`,name,market_hash_name:name,category:state.editor.category,image:safeUrl($('#manual-image').value)};
    $('#selected-main').hidden=false;$('#selected-main').innerHTML=`${selectedImage(state.editor.main)}<span class="selected-item-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(categoryName(state.editor.category))} · elle eklendi</small></span>`;updateSalePreview();
  });
  $('#manual-image').addEventListener('input',()=>{if(state.editor.main){state.editor.main.image=safeUrl($('#manual-image').value);$('#selected-main').innerHTML=`${selectedImage(state.editor.main)}<span class="selected-item-copy"><strong>${escapeHtml(itemName(state.editor.main))}</strong><small>${escapeHtml(categoryName(state.editor.category))} · elle eklendi</small></span>`;updateImageFallbacks($('#selected-main'))}});
  $('#has-charm').addEventListener('change',event=>toggleAttachment('charm',event.target.checked));
  $('#has-slab').addEventListener('change',event=>toggleAttachment('slab',event.target.checked));
  for(const type of ['charm','slab'])$(`#${type}-search`).addEventListener('input',async()=>{const category=type==='charm'?'charm':'sticker_slab';if(!state.catalog.has(category))await ensureCatalog(category);renderResults($(`#${type}-results`),matchingItems(category,$(`#${type}-search`).value),category,type)});
  $('#more-attachments').addEventListener('click',async()=>{$('#extra-attachment-form').hidden=false;const category=$('#extra-category').value;await ensureCatalog(category);renderResults($('#extra-results'),matchingItems(category,$('#extra-search').value),category,'extra')});
  $('#extra-category').addEventListener('change',async event=>{const category=event.target.value;$('#extra-search').value='';await ensureCatalog(category);renderResults($('#extra-results'),matchingItems(category,''),category,'extra')});
  $('#extra-search').addEventListener('input',async()=>{const category=$('#extra-category').value;if(!state.catalog.has(category))await ensureCatalog(category);renderResults($('#extra-results'),matchingItems(category,$('#extra-search').value),category,'extra')});
  $('#close-extra').addEventListener('click',()=>$('#extra-attachment-form').hidden=true);
  for(const selector of ['#buy-price','#main-sale','#charm-sale','#slab-sale'])$(selector).addEventListener('input',()=>{updateSalePreview();if($('#mark-sold').checked)renderActualPrices()});
  $('#bought-at').addEventListener('input',updateUnlockPreview);$('#lock-days').addEventListener('input',updateUnlockPreview);
  $('#mark-sold').addEventListener('change',event=>{$('#actual-prices').hidden=!event.target.checked;renderActualPrices(state.trades.find(t=>t.id===state.editor.recordId));updateProfitEstimate()});
  $('#detail-edit').addEventListener('click',()=>{const id=state.detailId;$('#detail-dialog').close();openTradeDialog(id)});
  $('#detail-sold').addEventListener('click',()=>markSold(state.detailId));
  $('#filter-search').addEventListener('input',event=>{state.filters.search=event.target.value;renderHistory()});
  $('#filter-status').addEventListener('change',event=>{state.filters.status=event.target.value;renderHistory()});
  $('#filter-type').addEventListener('change',event=>{state.filters.type=event.target.value;renderHistory()});
  $('#filter-wear').addEventListener('change',event=>{state.filters.wear=event.target.value;renderHistory()});
  $('#filter-from').addEventListener('change',event=>{state.filters.from=event.target.value;renderHistory()});
  $('#filter-to').addEventListener('change',event=>{state.filters.to=event.target.value;renderHistory()});
  $('#filter-sort').addEventListener('change',event=>{state.filters.sort=event.target.value;renderHistory()});
  $$('.sort-head').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset.sort,current=state.filters.sort;const next=key==='profit'?(current==='profit-desc'?'profit-asc':'profit-desc'):key==='id'?(current==='id-desc'?'id-asc':'id-desc'):(current==='date-desc'?'date-asc':'date-desc');state.filters.sort=next;$('#filter-sort').value=['date-desc','date-asc','profit-desc','profit-asc','cost-desc'].includes(next)?next:'date-desc';renderHistory()}));
  $('#clear-filters').addEventListener('click',()=>{$('#filter-search').value='';$('#filter-status').value='all';$('#filter-type').value='all';$('#filter-wear').value='all';$('#filter-from').value='';$('#filter-to').value='';$('#filter-sort').value='date-desc';state.filters={search:'',status:'all',type:'all',wear:'all',from:'',to:'',sort:'date-desc'};renderHistory()});
  $('#export-csv').addEventListener('click',exportCsv);$('#export-json').addEventListener('click',exportJson);$('#backup-json').addEventListener('click',exportJson);
  $('#restore-file').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)restoreJson(file);event.target.value=''});
  $('#chart-range').addEventListener('change',renderProfitChart);$('#report-month').addEventListener('change',renderReports);
  $('#setting-language').addEventListener('change',async event=>{
    const language=event.target.value==='tr'?'tr':'en';state.settings.language=language;
    await dbRequest('settings','put',{key:'app',value:state.settings});
    try{localStorage.setItem('csell-language',language)}catch{}
    try{sessionStorage.setItem('csell-return-page',state.activePage)}catch{}
    location.reload();
  });
  $('#save-settings').addEventListener('click',async()=>{
    const feeRate=Math.min(100,Math.max(0,Number($('#setting-fee-rate').value)||0));const feeFixed=Math.max(0,cents($('#setting-fee-fixed').value));const lockDays=Math.min(365,Math.max(0,Math.round(Number($('#setting-lock-days').value)||0)));
    state.settings={...state.settings,feeRate,feeFixed,lockDays};await dbRequest('settings','put',{key:'app',value:state.settings});renderDashboard();toast('Hesaplama ayarları kaydedildi.')
  });
  $('#delete-all').addEventListener('click',async()=>{if(!confirm('Bu tarayıcıda saklanan tüm işlem kayıtları silinsin mi? Bu işlem geri alınamaz.'))return;await dbRequest('trades','clear');state.trades=[];state.settings.nextId=1;await dbRequest('settings','put',{key:'app',value:state.settings});await refreshTrades();toast('Tüm işlem kayıtları silindi.')});
  $('#mobile-menu').addEventListener('click',()=>{$('#sidebar').classList.add('mobile-open');$('#mobile-scrim').classList.add('open')});$('#mobile-scrim').addEventListener('click',()=>{$('#sidebar').classList.remove('mobile-open');$('#mobile-scrim').classList.remove('open')});
  for(const dialog of [$('#trade-dialog'),$('#detail-dialog')])dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
  setInterval(()=>{$$('[data-countdown]').forEach(node=>{if(node.firstChild)node.firstChild.nodeValue=countdown(node.dataset.countdown);if(countdown(node.dataset.countdown)==='Açıldı')renderDashboard()})},1000);
  setInterval(()=>{if(state.activePage==='dashboard')renderProfitChart()},60000);
}

async function init(){
  try{
    state.db=await openDb();
    const saved=await dbRequest('settings','get','app');if(saved?.value)state.settings={...state.settings,...saved.value};
    if(state.settings.language==='tr'||state.settings.language==='en'){
      window.CSELL_LANGUAGE=state.settings.language;
      try{localStorage.setItem('csell-language',window.CSELL_LANGUAGE)}catch{}
    }
    state.trades=await dbRequest('trades','getAll');
  }catch(error){
    console.error('CSELL local storage:',error);toast('Yerel veritabanı açılamadı. Tarayıcı depolama iznini kontrol et.','error');
  }
  attachEvents();renderDashboard();renderSettings();window.CSELL_I18N?.apply();
  $('#chart-range').value='30';
  try{const returnPage=sessionStorage.getItem('csell-return-page');if(returnPage){sessionStorage.removeItem('csell-return-page');navigate(returnPage)}}catch{}
  if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
}
init();
