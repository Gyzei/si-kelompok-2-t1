export function pageNumbers(current, total) {
  const pages = new Set([1,total]);
  for (let page = current-1; page <= current+1; page++) if (page>=1 && page<=total) pages.add(page);
  if (current <= 3) for (let page=1;page<=Math.min(5,total);page++) pages.add(page);
  if (current >= total-2) for (let page=Math.max(1,total-4);page<=total;page++) pages.add(page);
  const result = []; let last = 0;
  for (const page of [...pages].sort((a,b)=>a-b)) {
    if (last && page-last>1) result.push(page-last===2 ? last+1 : '…');
    result.push(page);last=page;
  }
  return result;
}
