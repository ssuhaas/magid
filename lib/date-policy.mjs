/** Readable dates only when Excel explicitly supplies date formatting and its date system. */
export function sourceDate(cell,date1904=false){
 if(!cell||cell.formula)return null;
 if(cell.type==='d'&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(cell.raw))return cell.raw;
 const format=(cell.numberFormat||'').replace(/"[^"]*"|\[[^\]]*\]|\\./g,'');
 if(!/[dy]/i.test(format)||!/^\d+(?:\.\d+)?$/.test(cell.raw))return null;
 const serial=Number(cell.raw);if(!Number.isFinite(serial)||serial<0||serial>2958465||!date1904&&Math.floor(serial)===60)return null;
 const milliseconds=(date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,31))+Math.round((serial-(!date1904&&serial>=60?1:0))*86400000),date=new Date(milliseconds);
 return date.toISOString().slice(0,Number.isInteger(serial)?10:19).replace('T',' ');
}
