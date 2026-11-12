const test = require('node:test');
const assert = require('node:assert');

// Run the handler without Atlas: stub the connection and the model's database calls.
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: async () => {} };
process.env.WRITE_KEY = 'secret';

const handler = require('../api/index.js');
const Attendance = require('mongoose').models.Attendance;

async function call(req) {
  const out = {};
  const res = {
    setHeader() {},
    status(code) { out.status = code; return res; },
    json(body) { out.body = body; return res; },
    end() { return res; },
  };
  await handler({ method: 'GET', headers: {}, query: {}, ...req }, res);
  return out;
}

const keyed = { 'x-api-key': 'secret' };
const student = { studentName: ' Ana Cruz ', section: 'BSIT-3A', subjectName: 'Database 2' };
const id = '6ac6e8007b78d74f804ee6c0';
const iso = (d) => d.toISOString();

test('uses the daily_attendance collection', () => {
  assert.strictEqual(Attendance.collection.name, 'daily_attendance');
});

test('READ: GET lists records without a key', async () => {
  Attendance.find = () => ({ sort: () => ({ lean: async () => [{ studentName: 'A' }] }) });
  const r = await call({});
  assert.deepStrictEqual([r.status, r.body], [200, [{ studentName: 'A', attendanceDates: [] }]]);
});

test('READ: the stored { date } objects come back as attendanceDates', async () => {
  const stored = new Date('2026-10-08T00:00:00.000Z');
  Attendance.find = () => ({ sort: () => ({ lean: async () => [{ studentName: 'A', attendance: [{ date: stored }] }] }) });
  const r = await call({});
  assert.deepStrictEqual(r.body, [{ studentName: 'A', attendanceDates: [stored] }]);
});

test('writes need the key, and are off when WRITE_KEY is unset', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.strictEqual((await call({ method, body: student, query: { id } })).status, 401, method);
  }
  delete process.env.WRITE_KEY;
  assert.strictEqual((await call({ method: 'DELETE', headers: keyed, query: { id } })).status, 503);
  process.env.WRITE_KEY = 'secret';
});

test('CREATE: POST validates, trims, rejects duplicates and ignores extra fields', async () => {
  Attendance.exists = async () => null;
  Attendance.prototype.save = async function () { return this; };

  assert.strictEqual((await call({ method: 'POST', headers: keyed, body: { section: 'X' } })).status, 400);

  const ok = await call({ method: 'POST', headers: keyed, body: { ...student, isAdmin: true } });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.body.studentName, 'Ana Cruz');
  assert.deepStrictEqual(ok.body.attendanceDates, []);
  assert.strictEqual(ok.body.isAdmin, undefined);

  Attendance.exists = async () => ({ _id: 1 });
  assert.strictEqual((await call({ method: 'POST', headers: keyed, body: student })).status, 409);
});

test('CREATE: POST can include attendance dates (unique, sorted, UTC midnight)', async () => {
  Attendance.exists = async () => null;
  Attendance.prototype.save = async function () { return this; };

  const ok = await call({
    method: 'POST', headers: keyed,
    body: { ...student, attendanceDates: ['2026-10-15', '2026-10-08', '2026-10-15'] },
  });
  assert.strictEqual(ok.status, 201);
  assert.deepStrictEqual(ok.body.attendanceDates.map(iso), ['2026-10-08T00:00:00.000Z', '2026-10-15T00:00:00.000Z']);

  for (const bad of [['2026-02-30'], ['today'], 'nope', [123]]) {
    assert.strictEqual((await call({ method: 'POST', headers: keyed, body: { ...student, attendanceDates: bad } })).status, 400);
  }
});

test('UPDATE: PATCH marks a valid day as UTC midnight and rejects bad input', async () => {
  let update;
  Attendance.findByIdAndUpdate = (_id, u) => { update = u; return { lean: async () => ({ _id: id }) }; };

  const ok = await call({ method: 'PATCH', headers: keyed, query: { id }, body: { date: '2026-10-08' } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(update.$addToSet.attendance.date.toISOString(), '2026-10-08T00:00:00.000Z');

  for (const [q, date] of [[{ id }, '2026-02-30'], [{ id }, 'today'], [{ id: 'nope' }, '2026-10-08']]) {
    assert.strictEqual((await call({ method: 'PATCH', headers: keyed, query: q, body: { date } })).status, 400);
  }

  Attendance.findByIdAndUpdate = () => ({ lean: async () => null });
  assert.strictEqual((await call({ method: 'PATCH', headers: keyed, query: { id }, body: { date: '2026-10-08' } })).status, 404);
});

test('UPDATE: PUT fixes the name, section and subject and can replace the dates', async () => {
  let args;
  Attendance.exists = async (filter) => { args = { exists: filter }; return null; };
  Attendance.findByIdAndUpdate = (_id, u, opts) => { args = { ...args, update: u, opts }; return { lean: async () => ({ _id: id, ...u.$set }) }; };

  // name fix only: the dates are left alone
  let r = await call({ method: 'PUT', headers: keyed, query: { id }, body: { ...student, studentName: '  Ana Cruz  ' } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(args.update.$set, { studentName: 'Ana Cruz', section: 'BSIT-3A', subjectName: 'Database 2' });
  assert.strictEqual(args.opts.returnDocument, 'after');
  assert.deepStrictEqual(args.exists._id, { $ne: id }); // the duplicate check ignores the record being edited

  // dates sent: they replace the old list (changed, removed or added days)
  r = await call({ method: 'PUT', headers: keyed, query: { id }, body: { ...student, attendanceDates: ['2026-10-22', '2026-10-08'] } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(args.update.$set.attendance.map((a) => iso(a.date)), ['2026-10-08T00:00:00.000Z', '2026-10-22T00:00:00.000Z']);

  // an empty list clears every date
  r = await call({ method: 'PUT', headers: keyed, query: { id }, body: { ...student, attendanceDates: [] } });
  assert.deepStrictEqual(args.update.$set.attendance, []);
});

test('UPDATE: PUT rejects bad input, duplicates and unknown students', async () => {
  let wrote = 0;
  Attendance.exists = async () => null;
  Attendance.findByIdAndUpdate = () => { wrote++; return { lean: async () => null }; };
  const put = (query, body) => call({ method: 'PUT', headers: keyed, query, body });

  assert.strictEqual((await put({ id: 'nope' }, student)).status, 400);
  assert.strictEqual((await put({}, student)).status, 400);
  assert.strictEqual((await put({ id }, { section: 'X' })).status, 400);
  assert.strictEqual((await put({ id }, { ...student, attendanceDates: ['2026-02-30'] })).status, 400);
  assert.strictEqual(wrote, 0, 'bad input never reaches the database');

  Attendance.exists = async () => ({ _id: 2 });
  assert.strictEqual((await put({ id }, student)).status, 409);
  assert.strictEqual(wrote, 0);

  Attendance.exists = async () => null;
  assert.strictEqual((await put({ id }, student)).status, 404);
});

test('DELETE: removes one student, 404 when missing, 400 for a bad id', async () => {
  let asked;
  Attendance.findByIdAndDelete = (_id) => { asked = _id; return { lean: async () => ({ _id }) }; };
  let r = await call({ method: 'DELETE', headers: keyed, query: { id } });
  assert.deepStrictEqual([r.status, r.body], [200, { deleted: true, _id: id }]);
  assert.strictEqual(asked, id);

  Attendance.findByIdAndDelete = () => ({ lean: async () => null });
  assert.strictEqual((await call({ method: 'DELETE', headers: keyed, query: { id } })).status, 404);

  let called = false;
  Attendance.findByIdAndDelete = () => { called = true; return { lean: async () => null }; };
  assert.strictEqual((await call({ method: 'DELETE', headers: keyed, query: { id: 'nope' } })).status, 400);
  assert.strictEqual((await call({ method: 'DELETE', headers: keyed, query: {} })).status, 400);
  assert.strictEqual(called, false);
});

test('other methods are refused', async () => {
  assert.strictEqual((await call({ method: 'TRACE', headers: keyed })).status, 405);
});
