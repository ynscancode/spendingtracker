const BASE = 'http://localhost:4000/api';

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

async function main() {
  console.log('1. Accounts before any transactions');
  const accountsBefore = await req('GET', '/accounts');
  console.log(accountsBefore);

  console.log('2. Create normal "out" transaction (food, $15)');
  const t1 = await req('POST', '/transactions', {
    date: '2026-06-01', account_id: 1, direction: 'out', category: 'food', amount: 15, comment: 'lunch',
  });
  assert(t1.amount === 15, 't1 amount is 15');

  console.log('3. Create transfer Savings -> Spending ($50)');
  const transfer1 = await req('POST', '/transactions/transfer', {
    date: '2026-06-01', from_account_id: 2, to_account_id: 1, amount: 50,
  });
  assert(transfer1.inRow.comment === 'topup spending from savings', 'topup comment auto-filled');
  assert(transfer1.outRow.account_id === 2, 'out leg on savings');
  assert(transfer1.inRow.account_id === 1, 'in leg on spending');

  console.log('4. Create transfer Spending -> Savings ($30)');
  const transfer2 = await req('POST', '/transactions/transfer', {
    date: '2026-06-01', from_account_id: 1, to_account_id: 2, amount: 30,
  });
  assert(transfer2.outRow.comment === 'transfer to savings', 'transfer-to-savings default comment');

  console.log('5. List transactions with running balance');
  const txns = await req('GET', '/transactions');
  console.log(txns);
  const spendingTxns = txns.filter((t) => t.account_id === 1);
  const lastSpending = spendingTxns[spendingTxns.length - 1];
  // -15 (food) +50 (topup) -30 (transfer out) = 5
  assert(lastSpending.running_balance === 5, `spending running balance is 5 (got ${lastSpending.running_balance})`);

  console.log('6. Account balances after transactions');
  const accountsAfter = await req('GET', '/accounts');
  console.log(accountsAfter);
  const spending = accountsAfter.find((a) => a.id === 1);
  const savings = accountsAfter.find((a) => a.id === 2);
  assert(spending.balance === 5, `spending balance is 5 (got ${spending.balance})`);
  assert(savings.balance === -20, `savings balance is -20 (got ${savings.balance})`);

  console.log('7. Daily summary for 2026-06-01');
  const daily = await req('GET', '/summary/daily?date=2026-06-01');
  console.log(daily);
  // Daily summary includes transfer legs (real money movement between accounts);
  // only the monthly category breakdown excludes transfers.
  assert(daily.combined.total_in === 80, `combined total_in is 80 (got ${daily.combined.total_in})`);
  assert(daily.combined.total_out === 95, `combined total_out is 95 (got ${daily.combined.total_out})`);

  console.log('8. Monthly summary for 2026-06');
  const monthly = await req('GET', '/summary/monthly?month=2026-06');
  console.log(monthly);
  assert(monthly.totalOut === 15, `monthly totalOut excludes transfers, is 15 (got ${monthly.totalOut})`);
  const foodCat = monthly.byCategoryOut.find((c) => c.category === 'food');
  assert(foodCat && foodCat.total === 15, 'food category total is 15');
  const hasTransferCat = monthly.byCategoryOut.some((c) => c.category === 'transfer-out');
  assert(!hasTransferCat, 'transfer-out excluded from monthly breakdown');

  console.log('9. Edit transfer1 amount, confirm both legs updated');
  await req('PUT', `/transactions/${transfer1.outRow.id}`, { amount: 60 });
  const txnsAfterEdit = await req('GET', '/transactions');
  const editedOut = txnsAfterEdit.find((t) => t.id === transfer1.outRow.id);
  const editedIn = txnsAfterEdit.find((t) => t.id === transfer1.inRow.id);
  assert(editedOut.amount === 60 && editedIn.amount === 60, 'both transfer legs updated to amount 60');

  console.log('10. Delete transfer2, confirm both legs removed');
  await req('DELETE', `/transactions/${transfer2.outRow.id}`);
  const txnsAfterDelete = await req('GET', '/transactions');
  const stillExists = txnsAfterDelete.some(
    (t) => t.id === transfer2.outRow.id || t.id === transfer2.inRow.id
  );
  assert(!stillExists, 'both transfer2 legs deleted');

  console.log('11. GET categories: 13 seeded rows -> 11 user-visible (transfer-in/out excluded)');
  const categoriesBefore = await req('GET', '/categories');
  console.log(categoriesBefore);
  assert(categoriesBefore.outgoing.length === 9, `9 outgoing categories (got ${categoriesBefore.outgoing.length})`);
  assert(categoriesBefore.incoming.length === 2, `2 incoming categories (got ${categoriesBefore.incoming.length})`);
  assert(
    !categoriesBefore.outgoing.some((c) => c.name === 'transfer-out') &&
      !categoriesBefore.incoming.some((c) => c.name === 'transfer-in'),
    'transfer-in/transfer-out excluded from GET /categories'
  );
  const misc = categoriesBefore.outgoing.find((c) => c.name === 'miscellaneous');
  assert(misc && misc.color === '#CBAE4D', `miscellaneous seeded with frozen color #CBAE4D (got ${misc && misc.color})`);

  console.log('12. POST a new outgoing category, assigned a color');
  const newCat = await req('POST', '/categories', { name: 'Coffee Runs', list: 'outgoing' });
  assert(newCat.id != null, 'new category has an id');
  assert(newCat.name === 'Coffee Runs', 'name stored verbatim (casing preserved)');
  assert(typeof newCat.color === 'string' && /^#[0-9A-F]{6}$/i.test(newCat.color), `new category got a hex color (got ${newCat.color})`);

  console.log('13. POST duplicate name (case-insensitive) in same list -> 400');
  let duplicateRejected = false;
  try {
    await req('POST', '/categories', { name: 'coffee runs', list: 'outgoing' });
  } catch (err) {
    duplicateRejected = /400/.test(err.message);
  }
  assert(duplicateRejected, 'case-insensitive duplicate in same list rejected with 400');

  console.log('14. POST reserved name "transfer-in" -> 400');
  let reservedRejected = false;
  try {
    await req('POST', '/categories', { name: 'Transfer-In', list: 'incoming' });
  } catch (err) {
    reservedRejected = /400/.test(err.message);
  }
  assert(reservedRejected, 'reserved name "transfer-in" rejected with 400');

  console.log('15. POST 31-character name -> 400');
  let tooLongRejected = false;
  try {
    await req('POST', '/categories', { name: 'a'.repeat(31), list: 'outgoing' });
  } catch (err) {
    tooLongRejected = /400/.test(err.message);
  }
  assert(tooLongRejected, '31-character name rejected with 400');

  console.log('16. DELETE the unreferenced new category -> 204, disappears from GET');
  await req('DELETE', `/categories/${newCat.id}`);
  const categoriesAfterDelete = await req('GET', '/categories');
  assert(
    !categoriesAfterDelete.outgoing.some((c) => c.id === newCat.id),
    'deleted category no longer present in GET /categories'
  );

  console.log('17. DELETE a category with referencing transactions -> 400 with count message');
  let blockedDeleteMessage = null;
  try {
    await req('DELETE', '/categories/1'); // "food" — t1 above references it
  } catch (err) {
    blockedDeleteMessage = err.message;
  }
  assert(
    blockedDeleteMessage && /transaction/.test(blockedDeleteMessage) && /400/.test(blockedDeleteMessage),
    `delete of referenced category blocked with count message (got: ${blockedDeleteMessage})`
  );

  console.log('18. DELETE a system category (transfer-out) -> 400');
  // transfer-out is system-managed and excluded from GET /categories by design,
  // so it can't be looked up via the public endpoint — use the known seeded id
  // from migration order instead (003_categories.sql inserts 9 outgoing user
  // categories, then transfer-out as the 10th row).
  let systemDeleteRejected = false;
  try {
    await req('DELETE', '/categories/10');
  } catch (err) {
    systemDeleteRejected = /400/.test(err.message) && /system/.test(err.message);
  }
  assert(systemDeleteRejected, 'deleting system category (transfer-out) rejected with 400');

  console.log('\nALL SMOKE TESTS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
