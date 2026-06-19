export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonthStr() {
  return new Date().toISOString().slice(0, 7);
}

export function monthRangeFor(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const from = `${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

// Groups a flat, date-sorted transaction array into Map<year, Map<month, Map<day, txns[]>>>
export function groupByYearMonthDay(transactions) {
  const byYear = new Map();
  for (const txn of transactions) {
    const year = txn.date.slice(0, 4);
    const month = txn.date.slice(0, 7);
    const day = txn.date;

    if (!byYear.has(year)) byYear.set(year, new Map());
    const byMonth = byYear.get(year);

    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const byDay = byMonth.get(month);

    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(txn);
  }
  return byYear;
}

export function prevMonthStr(monthStr) {
  const [year, month] = monthStr.split('-').map(Number)
  const d = new Date(year, month - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function nextMonthStr(monthStr) {
  const [year, month] = monthStr.split('-').map(Number)
  const d = new Date(year, month, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function dayLabel(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}
