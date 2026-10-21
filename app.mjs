import {HEX_RADIUS, keyOf, centerOf, summarize, dayCounts, metricValue, dateWindow} from './logic.mjs';
const $=id=>document.getElementById(id);
const d3=window.d3 || await new Promise(resolve=>window.addEventListener('load',()=>resolve(window.d3),{once:true}));
const fmt=n=>new Intl.NumberFormat('en-US').format(n);
const decimal=n=>n==null?'N/A':n.toFixed(1);
const prettyDay=day=>d3.utcFormat('%b %-d, %Y')(new Date(day+'T00:00:00Z'));
const periodLabel=()=>`${prettyDay(state.start)} – ${prettyDay(state.end)}`;
const state={borough:0,category:-1,metric:'basins',view:'points',showReports:false,start:'',end:''};
let basins,reports,rainfall,manifest,boroughs,summary,days,counts;
let transform=d3?.zoomIdentity,zoom,canvas,ctx,width=600,height=510,scale=1,ox=0,oy=0,brush,brushGroup,xTime;
let selectedKey=null,selectedRecord=null,pins=[],assetTree,reportTree,currentColor,maximum=1;
let ignoreBrush=false,ready=false,resizeFrame,timelineWidth;
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isPointView=()=>state.view==='points'||transform.k>=8;
const basePoint=(x,y)=>[ox+x*scale,oy-y*scale];
const toScreen=(x,y)=>transform.apply(basePoint(x,y));
const cellMap=()=>new Map(summary.bins.map(b=>[b.key,b]));
const escaped=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function boot(){
  try{
    if(!d3)throw new Error('The local D3 library did not load.');
    [manifest,basins,reports,rainfall,boroughs]=await Promise.all(['manifest','basins','reports','rainfall','boroughs'].map(n=>d3.json(`data/${n}.json`)));
    [state.start,state.end]=manifest.profiles.date_range;days=rainfall.map(r=>r[0]);
    for(let i=1;i<manifest.boroughs.length;i++)$('borough').add(new Option(manifest.boroughs[i],i));
    manifest.categories.forEach((c,i)=>$('category').add(new Option(c,i)));
    for(const id of ['date-start','date-end']){$(id).min=state.start;$(id).max=state.end;}
    // Coverage and snapshot details are available under About the data.
    canvas=$('map');ctx=canvas.getContext('2d');
    zoom=d3.zoom().scaleExtent([1,45]).on('zoom',e=>{transform=e.transform;drawMap();});
    d3.select(canvas).call(zoom).on('dblclick.zoom',null);
    canvas.addEventListener('mousemove',hoverMap);canvas.addEventListener('mouseleave',()=>$('map-tooltip').hidden=true);
    canvas.addEventListener('click',clickMap);
    wireControls();renderAudit();renderStorms();update(true);ready=true;
    new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(resize);}).observe($('map-wrap'));
    resize();$('workspace').setAttribute('aria-busy','false');$('load-state').textContent='';
    // A visible, optional three-step guide lets visitors choose their own tempo.
  }catch(error){
    console.error(error);$('load-state').textContent=`Could not load the map: ${error.message} If you downloaded the files, serve the website folder over http (instructions are in START_HERE.md).`;
  }
}
function syncDates(){ $('date-start').value=state.start;$('date-end').value=state.end; }
function wireControls(){
  $('borough').onchange=e=>{state.borough=+e.target.value;selectedRecord=null;selectedKey=null;update(true);fitBorough();};
  $('category').onchange=e=>{state.category=+e.target.value;selectedRecord=null;update(true);};
  $('metric').onchange=e=>{
    state.metric=e.target.value;state.view='hex';
    if(state.metric!=='basins'){state.showReports=true;$('report-dots').checked=true;}
    if(transform.k>=8)zoomTo([0,0],1);
    update(false);
  };
  $('map-style').onchange=e=>{state.view=e.target.value;if(state.view==='hex'&&transform.k>=8)zoomTo([0,0],1);update(false);};
  $('report-dots').onchange=e=>{state.showReports=e.target.checked;drawMap();};
  for(const id of ['date-start','date-end'])$(id).onchange=()=>{
    const start=$('date-start').value,end=$('date-end').value;
    const [min,max]=manifest.profiles.date_range;
    if(!start||!end||start>end||start<min||end>max){$('date-live').textContent=`Choose dates between ${min} and ${max}, with the start no later than the end.`;return;}
    state.start=start;state.end=end;selectedRecord=null;update(false);moveBrush();
  };
  $('all-dates').onclick=$('clear-brush').onclick=()=>{[state.start,state.end]=manifest.profiles.date_range;update(false);moveBrush();};
  $('zoom-in').onclick=()=>d3.select(canvas).transition().duration(reduced?0:250).call(zoom.scaleBy,1.7);
  $('zoom-out').onclick=()=>d3.select(canvas).transition().duration(reduced?0:250).call(zoom.scaleBy,1/1.7);
  $('zoom-reset').onclick=()=>zoomTo([0,0],1);
  $('east-village').onclick=()=>{state.borough=1;$('borough').value=1;$('layers-panel').open=false;update(true);zoomTo(lonLat(-73.981,40.726),16);};
  $('most-reports').onclick=()=>{
    state.metric='reports';state.view='hex';state.showReports=true;$('metric').value='reports';$('report-dots').checked=true;update(false);
    const b=d3.greatest(summary.bins,b=>b.reports);if(b){selectCell(b.key);zoomTo(centerOf(b.q,b.r),5);}
  };
  $('reset').onclick=()=>{
    Object.assign(state,{borough:0,category:-1,metric:'basins',view:'points',showReports:false});
    [state.start,state.end]=manifest.profiles.date_range;
    $('borough').value=0;$('category').value=-1;$('metric').value='basins';$('report-dots').checked=false;
    $('layers-panel').open=false;
    selectedKey=null;selectedRecord=null;pins=[];update(true);zoomTo([0,0],1);
  };
  $('pin-cell').onclick=()=>{if(selectedKey&&!pins.includes(selectedKey)){if(pins.length===2)pins.shift();pins.push(selectedKey);renderPins();}};
  $('export').onclick=exportCells;
  $('open-about').onclick=()=>$('about').showModal();
  $('close-about').onclick=()=>$('about').close();
  $('open-tour').onclick=()=>{$('about').close();tourStep=0;renderTour();$('tour').showModal();};
  $('close-area').onclick=()=>{selectedKey=null;selectedRecord=null;renderSelection();drawMap();};
  $('rain-panel').addEventListener('toggle',()=>{if($('rain-panel').open)requestAnimationFrame(renderTimeline);});
  $('map').addEventListener('keydown',e=>{
    if(e.key==='+'||e.key==='='){$('zoom-in').click();e.preventDefault();}
    if(e.key==='-'){$('zoom-out').click();e.preventDefault();}
  });
  $('tour-close').onclick=()=>$('tour').close();
  $('tour-back').onclick=()=>{tourStep--;renderTour();};
  $('tour-next').onclick=()=>{if(tourStep===2){$('tour').close();$('map').focus({preventScroll:true});}else{tourStep++;renderTour();}};
}
function lonLat(lon,lat){
  const p=lat*Math.PI/180,l=lon*Math.PI/180,p0=40.71*Math.PI/180,l0=-73.94*Math.PI/180;
  const k=Math.sqrt(2/(1+Math.sin(p0)*Math.sin(p)+Math.cos(p0)*Math.cos(p)*Math.cos(l-l0)));
  return [6371008.8*k*Math.cos(p)*Math.sin(l-l0),6371008.8*k*(Math.cos(p0)*Math.sin(p)-Math.sin(p0)*Math.cos(p)*Math.cos(l-l0))];
}
function resize(){
  if(!ready)return;
  width=$('map-wrap').clientWidth;height=$('map-wrap').clientHeight;
  const dpr=Math.min(devicePixelRatio||1,2);canvas.width=width*dpr;canvas.height=height*dpr;
  const minX=d3.min(basins,r=>r[4]),maxX=d3.max(basins,r=>r[4]),minY=d3.min(basins,r=>r[5]),maxY=d3.max(basins,r=>r[5]);
  scale=Math.min((width-110)/(maxX-minX),(height-200)/(maxY-minY));ox=width/2-(minX+maxX)/2*scale;oy=height/2+(minY+maxY)/2*scale;
  zoom.extent([[0,0],[width,height]]);
  drawMap();renderTimeline();
}
function zoomTo(center,k){
  const [x,y]=basePoint(...center);
  const t=k===1?d3.zoomIdentity:d3.zoomIdentity.translate(width/2-k*x,height/2-k*y).scale(k);
  d3.select(canvas).transition().duration(reduced?0:550).call(zoom.transform,t);
}
function fitBorough(){
  if(!state.borough)return zoomTo([0,0],1);
  const rows=summary.assets;if(!rows.length)return;
  const x0=d3.min(rows,r=>r[4]),x1=d3.max(rows,r=>r[4]),y0=d3.min(rows,r=>r[5]),y1=d3.max(rows,r=>r[5]);
  zoomTo([(x0+x1)/2,(y0+y1)/2],Math.min(12,Math.max(1,Math.min((width-80)/((x1-x0)*scale),(height-80)/((y1-y0)*scale)))));
}
function update(rebuildTime=false){
  summary=summarize(basins,reports,state);
  assetTree=d3.quadtree(summary.assets,r=>r[4],r=>r[5]);reportTree=d3.quadtree(summary.reports,r=>r[4],r=>r[5]);
  maximum=d3.max(summary.bins,b=>metricValue(b,state.metric))||1;
  currentColor=d3.scaleSequentialSqrt(state.metric==='basins'?d3.interpolateRgb('#153e5c','#48dbff'):d3.interpolateRgb('#4d3325','#ffad4a')).domain([0,maximum]);
  $('count-basins').textContent=fmt(summary.assets.length);$('count-reports').textContent=fmt(summary.reports.length);
  $('map-title').textContent={basins:'Catch basins',reports:'Reported problems',ratio:'Reports per 100 basins'}[state.metric];
  $('metric-note').textContent=state.metric==='ratio'?'Reports ÷ basins × 100. This is not a failure rate.':'Area view groups records into 1 km² hexagons.';
  syncDates();
  $('date-live').textContent=periodLabel();
  $('active-period').textContent=periodLabel();
  renderSelection();renderPins();renderCategories();renderRanked();drawMap();
  if(rebuildTime){counts=dayCounts(reports,state,days);renderTimeline();}
}
function boroughPath(b){
  ctx.beginPath();
  for(const poly of b.polygons)for(const ring of poly){ring.forEach(([x,y],i)=>{const p=basePoint(x,y);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();}
}
function hexPath(q,r){
  const [x,y]=centerOf(q,r);ctx.beginPath();
  for(let i=0;i<6;i++){const a=i*Math.PI/3,p=basePoint(x+HEX_RADIUS*Math.cos(a),y+HEX_RADIUS*Math.sin(a));i?ctx.lineTo(...p):ctx.moveTo(...p);}ctx.closePath();
}
function visible(x,y,pad=15){const p=toScreen(x,y);return p[0]>-pad&&p[0]<width+pad&&p[1]>-pad&&p[1]<height+pad;}
function drawMap(){
  if(!ctx||!summary)return;
  const dpr=Math.min(devicePixelRatio||1,2);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#091c2e';ctx.fillRect(0,0,width,height);
  ctx.save();ctx.translate(transform.x,transform.y);ctx.scale(transform.k,transform.k);
  for(const b of boroughs){boroughPath(b);ctx.fillStyle=(!state.borough||state.borough===b.code)?'#12344c':'#0d2639';ctx.fill('evenodd');ctx.strokeStyle='#37627d';ctx.lineWidth=.6/transform.k;ctx.stroke();}
  if(!isPointView()){
    for(const b of summary.bins){
      if(!visible(...centerOf(b.q,b.r),HEX_RADIUS*scale*transform.k))continue;
      hexPath(b.q,b.r);const v=metricValue(b,state.metric);
      ctx.fillStyle=v==null?'#668299':currentColor(v);ctx.globalAlpha=v===0?.4:.95;ctx.fill();ctx.globalAlpha=1;
      ctx.strokeStyle='#091c2e';ctx.lineWidth=.55/transform.k;ctx.stroke();
    }
  }else{
    const radius=(transform.k>=8?2:1.15)/transform.k;
    ctx.fillStyle='#48dbff';ctx.globalAlpha=transform.k<4?.85:.98;ctx.beginPath();
    for(const r of summary.assets)if(visible(r[4],r[5])){const p=basePoint(r[4],r[5]);ctx.moveTo(p[0]+radius,p[1]);ctx.arc(...p,radius,0,Math.PI*2);}ctx.fill();ctx.globalAlpha=1;
    if(state.showReports){
      const radiusR=2.5/transform.k;ctx.fillStyle='#ffad4a';ctx.globalAlpha=.8;ctx.beginPath();
      for(const r of summary.reports)if(visible(r[4],r[5])){const p=basePoint(r[4],r[5]);ctx.moveTo(p[0]+radiusR,p[1]);ctx.arc(...p,radiusR,0,Math.PI*2);}ctx.fill();ctx.globalAlpha=1;
    }
  }
  const chosen=summary.bins.find(b=>b.key===selectedKey);
  if(chosen){hexPath(chosen.q,chosen.r);ctx.strokeStyle='#ffffff';ctx.lineWidth=2/transform.k;ctx.stroke();}
  if(selectedRecord){const r=selectedRecord.row,p=basePoint(r[4],r[5]);ctx.beginPath();ctx.arc(...p,6/transform.k,0,Math.PI*2);ctx.strokeStyle='#ffffff';ctx.lineWidth=2/transform.k;ctx.stroke();}
  ctx.restore();
  if(transform.k<4){
    ctx.font='11px Arial';ctx.textAlign='center';ctx.fillStyle='#cae8fa';
    for(const [name,lon,lat] of [['MANHATTAN',-73.983,40.783],['BRONX',-73.859,40.876],['QUEENS',-73.817,40.735],['BROOKLYN',-73.956,40.643],['STATEN ISLAND',-74.159,40.578]]){
      const [x,y]=toScreen(...lonLat(lon,lat));ctx.lineWidth=4;ctx.strokeStyle='#091c2e';ctx.strokeText(name,x,y);ctx.fillText(name,x,y);
    }
  }
  $('view-label').textContent=isPointView()?'Street points':'1 km² areas';
  $('map-style').value=isPointView()?'points':'hex';renderLegend();
}
function renderLegend(){
  if(isPointView()){
    $('map-legend').innerHTML='<div class="dot-key"><i style="background:#48dbff"></i> Catch basin</div>'+(state.showReports?'<div class="dot-key"><i style="background:#ffad4a"></i> Report</div>':'');return;
  }
  const name={basins:'Basins per area',reports:'Reports per area',ratio:'Reports per 100 basins'}[state.metric];
  $('map-legend').innerHTML=`<strong>${name}</strong><div class="legend-ramp">${[0,.2,.4,.6,.8,1].map(t=>`<i style="background:${currentColor(t*maximum)}"></i>`).join('')}</div><div class="legend-labels"><span>0</span><span>${state.metric==='ratio'?decimal(maximum):fmt(maximum)}</span></div><div style="margin-top:6px">Scale changes with filters${state.metric==='ratio'?' · gray: no basins':''}</div>`;
}
function hexAt(event){
  const p=transform.invert(d3.pointer(event,canvas));const x=(p[0]-ox)/scale,y=(oy-p[1])/scale;
  const q=2/3*x/HEX_RADIUS,r=(-x/3+Math.sqrt(3)*y/3)/HEX_RADIUS,s=-q-r;
  let rq=Math.round(q),rr=Math.round(r),rs=Math.round(s);const dq=Math.abs(rq-q),dr=Math.abs(rr-r),ds=Math.abs(rs-s);
  if(dq>dr&&dq>ds)rq=-rr-rs;else if(dr>ds)rr=-rq-rs;
  return summary.bins.find(b=>b.q===rq&&b.r===rr);
}
function recordAt(event){
  const p=transform.invert(d3.pointer(event,canvas)),x=(p[0]-ox)/scale,y=(oy-p[1])/scale,tol=8/(scale*transform.k);
  const asset=assetTree.find(x,y,tol),report=state.showReports?reportTree.find(x,y,tol):null;
  const dist=r=>r?Math.hypot(r[4]-x,r[5]-y):Infinity;
  return dist(asset)<=dist(report)?(asset?{row:asset,type:'basin'}:null):(report?{row:report,type:'report'}:null);
}
function hoverMap(event){
  const tip=$('map-tooltip'),r=isPointView()?recordAt(event):null,b=isPointView()?null:hexAt(event);
  if(!r&&!b){tip.hidden=true;return;}
  tip.innerHTML=r?`<strong>${r.type==='basin'?'Basin':'Report'} ${escaped(r.row[0])}</strong><br>${r.type==='report'?manifest.categories[r.row[8]]+' · '+r.row[9]:'Click for details'}`:`<strong>Area ${b.key}</strong><br>${fmt(b.basins)} basins · ${fmt(b.reports)} reports`;
  const [x,y]=d3.pointer(event,canvas);tip.style.left=Math.max(5,Math.min(x+13,width-235))+'px';tip.style.top=Math.min(y+13,height-85)+'px';tip.hidden=false;
}
function clickMap(event){
  if(event.defaultPrevented)return;
  $('layers-panel').open=false;
  if(isPointView()){
    const r=recordAt(event);if(r){selectedRecord=r;selectedKey=keyOf(r.row);renderSelection();drawMap();return;}
  }
  const b=hexAt(event);if(b){const already=selectedKey===b.key;selectCell(b.key);zoomTo(centerOf(b.q,b.r),Math.max(transform.k,already?14:5));}
}
function selectCell(key){$('about').close();$('layers-panel').open=false;selectedKey=key;selectedRecord=null;renderSelection();drawMap();}
function renderSelection(){
  const b=summary.bins.find(b=>b.key===selectedKey);$('pin-cell').disabled=!b;
  $('area-panel').hidden=!b;
  if(!b){$('selection').innerHTML='';return;}
  let html=`<h2>Area ${b.key}</h2><div class="selection-stats"><div><strong>${fmt(b.basins)}</strong><span>basins</span></div><div><strong class="orange">${fmt(b.reports)}</strong><span>reports</span></div></div><p>${b.ratio==null?'No basins recorded here.':`${decimal(b.ratio)} reports per 100 basins.${b.basins<5?' Based on fewer than 5 basins.':''}`}</p>`;
  if(selectedRecord){
    const r=selectedRecord.row;
    html+=`<span class="pill">${selectedRecord.type==='basin'?'Catch basin':'311 report'}</span><h3>${escaped(r[0])}</h3><p>${manifest.boroughs[r[3]]}<br>Latitude ${r[2].toFixed(8)}<br>Longitude ${r[1].toFixed(8)}${selectedRecord.type==='report'?`<br>${manifest.categories[r[8]]}<br>${prettyDay(r[9])}`:''}</p><p>Report totals describe the area, not this individual basin.</p>`;
  }else{
    const list=summary.assets.filter(r=>keyOf(r)===b.key).slice(0,10);
    html+='<button class="outline full" id="street-zoom">See individual basins</button>';
    if(list.length)html+=`<details class="basin-records"><summary>Basin IDs (${Math.min(10,b.basins)} of ${fmt(b.basins)})</summary><ul class="record-list">${list.map(r=>`<li><button data-asset="${r[0]}">${r[0]}</button></li>`).join('')}</ul></details>`;
  }
  $('selection').innerHTML=html;
  if($('street-zoom'))$('street-zoom').onclick=()=>zoomTo(centerOf(b.q,b.r),16);
  $('selection').querySelectorAll('[data-asset]').forEach(el=>el.onclick=()=>{selectedRecord={type:'basin',row:summary.assets.find(r=>r[0]===el.dataset.asset)};renderSelection();drawMap();});
}
function renderPins(){
  const map=cellMap();
  $('pins').innerHTML=pins.map((key,i)=>{const b=map.get(key);return `<div class="pin-card"><button data-remove="${i}" aria-label="Remove compared area ${i+1}">×</button><b>${i===0?'A':'B'} · ${key}</b><br>${b?`${fmt(b.basins)} basins · ${fmt(b.reports)} reports<br>${decimal(b.ratio)} reports / 100 basins${b.basins>0&&b.basins<5?' · fewer than 5 basins':''}`:'Outside the current view.'}</div>`;}).join('')+(pins.length?'<p class="field-note">Both areas use the same filters.</p>':'');
  $('pins').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{pins.splice(+b.dataset.remove,1);renderPins();});
}
function renderCategories(){
  const max=d3.max(summary.categories)||1;
  $('categories').innerHTML=manifest.categories.map((c,i)=>`<div class="cat-row"><span>${c}</span><span>${fmt(summary.categories[i])}</span><div class="cat-track"><i style="width:${summary.categories[i]/max*100}%"></i></div></div>`).join('');
}
function rankedBins(){return [...summary.bins].filter(b=>metricValue(b,state.metric)!=null).sort((a,b)=>metricValue(b,state.metric)-metricValue(a,state.metric)||b.basins-a.basins);}
function renderRanked(){
  $('rank-caption').textContent=`Top 6 areas · ${$('metric').selectedOptions[0].text} · ${periodLabel()}. Counts do not set inspection priority. * Fewer than 5 basins.`;
  $('ranked').innerHTML=rankedBins().slice(0,6).map(b=>`<tr><td>${b.key}</td><td>${fmt(b.basins)}</td><td>${fmt(b.reports)}</td><td>${decimal(b.ratio)}${b.basins>0&&b.basins<5?' *':''}</td><td><button data-cell="${b.key}">View</button></td></tr>`).join('');
  if(!summary.bins.length)$('ranked').innerHTML='<tr><td colspan="5">No records match these filters.</td></tr>';
  $('ranked').querySelectorAll('[data-cell]').forEach(el=>el.onclick=()=>{const b=summary.bins.find(b=>b.key===el.dataset.cell);selectCell(b.key);zoomTo(centerOf(b.q,b.r),5);$('map').focus({preventScroll:true});});
}
function renderTimeline(){
  if(!rainfall||!counts)return;
  const root=d3.select('#timeline');root.selectAll('*').remove();timelineWidth=$('timeline').clientWidth-20;
  const w=Math.max(240,timelineWidth),h=190,m={left:40,right:16},x0=m.left,x1=w-m.right;
  const parse=d=>new Date(d+'T00:00:00Z');
  xTime=d3.scaleUtc().domain([parse(days[0]),new Date(+parse(days.at(-1))+864e5)]).range([x0,x1]);
  const rainY=d3.scaleLinear().domain([0,d3.max(rainfall,r=>r[1])||1]).nice().range([80,27]);
  const reportY=d3.scaleLinear().domain([0,d3.max(counts,r=>r[1])||1]).nice().range([154,105]);
  const svg=root.append('svg').attr('viewBox',`0 0 ${w} ${h}`).attr('role','img').attr('aria-label','Daily Central Park precipitation above, daily supplied report counts below. Drag horizontally to select report dates; date inputs provide a keyboard alternative.');
  svg.append('text').attr('x',x0).attr('y',14).attr('font-size',10).attr('fill','#48dbff').text('Rain · mm per observation day');
  svg.append('text').attr('x',x0).attr('y',97).attr('font-size',10).attr('fill','#ffad4a').text('Reports per day');
  svg.append('g').attr('transform',`translate(${x0},0)`).call(d3.axisLeft(rainY).ticks(2).tickSize(3));
  svg.append('g').attr('transform',`translate(${x0},0)`).call(d3.axisLeft(reportY).ticks(2).tickSize(3).tickFormat(d3.format('d')));
  const barW=Math.max(.4,(x1-x0)/days.length);
  svg.append('g').selectAll('rect').data(rainfall.filter(r=>r[1]!=null)).join('rect').attr('x',r=>xTime(parse(r[0]))).attr('y',r=>rainY(r[1])).attr('height',r=>80-rainY(r[1])).attr('width',barW).attr('fill','#48dbff').attr('opacity',.85);
  // Unavailable rainfall is shown explicitly, not rendered as a zero bar.
  svg.append('g').selectAll('line').data(rainfall.filter(r=>r[1]==null)).join('line').attr('x1',r=>xTime(parse(r[0]))).attr('x2',r=>xTime(parse(r[0]))).attr('y1',28).attr('y2',80).attr('stroke','#8199aa').attr('stroke-width',Math.max(1,barW));
  svg.append('path').datum(counts).attr('fill','none').attr('stroke','#ffad4a').attr('stroke-width',1.1).attr('d',d3.line().x(r=>xTime(parse(r[0]))).y(r=>reportY(r[1])));
  svg.append('g').attr('transform','translate(0,160)').call(d3.axisBottom(xTime).ticks(Math.max(3,Math.floor(w/110))).tickSize(3));
  brush=d3.brushX().extent([[x0,22],[x1,155]]).on('end',e=>{
    if(ignoreBrush)return;
    if(e.selection){const a=xTime.invert(e.selection[0]),b=xTime.invert(e.selection[1]);state.start=d3.utcFormat('%Y-%m-%d')(a);state.end=d3.utcFormat('%Y-%m-%d')(new Date(Math.max(+a,+b-1)));}
    else [state.start,state.end]=manifest.profiles.date_range;
    selectedRecord=null;update(false);
  });
  brushGroup=svg.append('g').call(brush);moveBrush();
  const cursor=svg.append('line').attr('y1',22).attr('y2',155).attr('stroke','#a7cce3').attr('stroke-width',1).attr('pointer-events','none').attr('opacity',0);
  svg.on('mousemove',event=>{
    const [mx]=d3.pointer(event),date=xTime.invert(Math.max(x0,Math.min(x1,mx))),idx=Math.max(0,Math.min(days.length-1,Math.floor((+date-+parse(days[0]))/864e5))),r=rainfall[idx];
    cursor.attr('x1',xTime(parse(r[0]))).attr('x2',xTime(parse(r[0]))).attr('opacity',1);
    $('date-live').textContent=`${prettyDay(r[0])} · ${r[1]==null?'Rain unavailable':r[1]+' mm'}${r[2]==='T'?' (trace)':''} · ${fmt(counts[idx][1])} reports`;
  }).on('mouseleave',()=>{cursor.attr('opacity',0);$('date-live').textContent=periodLabel();});
}
function moveBrush(){
  if(!brushGroup)return;
  ignoreBrush=true;
  const all=state.start===days[0]&&state.end===days.at(-1);
  const end=new Date(+new Date(state.end+'T00:00:00Z')+864e5);
  brushGroup.call(brush.move,all?null:[xTime(new Date(state.start+'T00:00:00Z')),xTime(end)]);
  ignoreBrush=false;
}
function renderStorms(){
  const wet=[...rainfall].filter(r=>r[1]!=null).sort((a,b)=>b[1]-a[1]).slice(0,3);
  $('storm-buttons').innerHTML=wet.map(r=>`<button data-day="${r[0]}" title="${r[1]} mm at Central Park">${prettyDay(r[0])}</button>`).join('');
  $('storm-buttons').querySelectorAll('[data-day]').forEach(el=>el.onclick=()=>{
    const [a,b]=dateWindow(el.dataset.day);state.start=a<days[0]?days[0]:a;state.end=b>days.at(-1)?days.at(-1):b;state.metric='reports';$('metric').value='reports';selectedRecord=null;update(false);moveBrush();
  });
}
function exportCells(){
  const head=['cell_id','full_cell_area_km2','basin_inventory_count','selected_report_count','reports_per_100_inventory_basins','small_denominator_under_5','report_start','report_end','borough_filter','category_filter','interpretation'];
  const rows=summary.bins.map(b=>[b.key,1,b.basins,b.reports,b.ratio==null?'':b.ratio.toFixed(4),b.basins>0&&b.basins<5,state.start,state.end,state.borough?manifest.boroughs[state.borough]:'All records',state.category<0?'All types':manifest.categories[state.category],'Spatial summary; no asset linkage or failure rate']);
  const csv=[head,...rows].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='iron_grid_filtered_cells.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderAudit(){
  const p=manifest.profiles;
  $('data-audit').innerHTML=`<p><strong>${fmt(p.basins.rows)} mapped basins</strong>, with ${p.basins.columns.length} retained fields; <strong>${fmt(p.complaints.rows)} supplied reports</strong>, with ${p.complaints.columns.length} original retained fields. Both supplied files have zero null values and no duplicate IDs. Basin IDs include ${fmt(p.basins.rows-p.basins.distinct_coordinates)} additional records at shared coordinates; distinct assets are retained.</p><p>All ${fmt(p.date_restoration.matched)} report dates were restored, covering ${p.date_range[0]} to ${p.date_range[1]}. ${p.basins_boroughs.Unknown||0} basins and ${p.reports_boroughs.Unknown||0} reports could not be assigned to a borough polygon; they appear in the citywide view only. NOAA has ${fmt(p.rainfall.usable_days)} usable precipitation observations for ${fmt(p.rainfall.total_days)} days in this window. Original file hashes and full preparation details are in the manifest.</p>`;
  $('source-list').innerHTML=manifest.sources.map(s=>`<li><a href="${s.url}" target="_blank" rel="noopener">${escaped(s.name)}</a> — ${escaped(s.role)}</li>`).join('');
}
const tour=[
  ['Start with the map','Each point is a catch basin. Drag to move around, or scroll to zoom.','Choose a borough at the top. Layers contains the area view and problem filters.'],
  ['Look closer','Click a point for its record. In area view, each hexagon covers 1 km²; brighter areas have higher counts.','Open Rain & reports at the bottom to explore dates, or compare two selected areas.'],
  ['Read the limits','Reports are service requests, not confirmed failures. Rain is measured in Central Park only.','This is a saved dataset, not live conditions. Full details and the area table are in About.']
];
let tourStep=0;
function renderTour(){
  $('tour-progress').innerHTML=[0,1,2].map(i=>`<i class="${i<=tourStep?'active':''}"></i>`).join('');
  $('tour-number').textContent=`${tourStep+1} of 3`;$('tour-title').textContent=tour[tourStep][0];$('tour-copy').textContent=tour[tourStep][1];$('tour-example').textContent=tour[tourStep][2];
  $('tour-back').disabled=tourStep===0;$('tour-next').textContent=tourStep===2?'Open map':'Next';
}
boot();
