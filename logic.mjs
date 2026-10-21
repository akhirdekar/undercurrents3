export const HEX_RADIUS = Math.sqrt(1e6 / (3 * Math.sqrt(3) / 2));
export const keyOf = row => `${row[6]},${row[7]}`;
export const centerOf = (q,r) => [HEX_RADIUS * 1.5 * q, HEX_RADIUS * Math.sqrt(3) * (r + q/2)];
export function matches(row, state, dates=true) {
  return (!state.borough || row[3] === state.borough)
    && (state.category < 0 || row[8] === state.category)
    && (!dates || ((!state.start || row[9] >= state.start) && (!state.end || row[9] <= state.end) && !!row[9]));
}
export function summarize(basins, reports, state) {
  const assets = state.borough ? basins.filter(r=>r[3]===state.borough) : basins;
  const selected = reports.filter(r=>matches(r,state));
  const bins = new Map();
  const bin = row => {
    const key=keyOf(row);
    if(!bins.has(key)) bins.set(key,{key,q:row[6],r:row[7],basins:0,reports:0,categories:[0,0,0,0,0]});
    return bins.get(key);
  };
  for(const row of assets) bin(row).basins++;
  for(const row of selected) {const b=bin(row);b.reports++;b.categories[row[8]]++;}
  for(const b of bins.values()) b.ratio=b.basins ? b.reports/b.basins*100 : null;
  return {assets,reports:selected,bins:[...bins.values()],categories:[0,1,2,3,4].map(c=>selected.filter(r=>r[8]===c).length)};
}
export function dayCounts(reports, state, days) {
  const counts=new Map(days.map(d=>[d,0]));
  for(const r of reports) if(matches(r,state,false)&&counts.has(r[9]))counts.set(r[9],counts.get(r[9])+1);
  return days.map(d=>[d,counts.get(d)]);
}
export function metricValue(bin,metric){return metric==='ratio'?bin.ratio:bin[metric];}
export function dateWindow(day,before=2,after=4){
  const d=new Date(day+'T12:00:00Z');
  const shift=n=>new Date(+d+n*864e5).toISOString().slice(0,10);
  return [shift(-before),shift(after)];
}
