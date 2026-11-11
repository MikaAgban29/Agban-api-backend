const mongoose = require('mongoose');
const connectToDatabase = require('../db');

const schema = new mongoose.Schema(
  {
    studentName: { type: String, required: true, trim: true, maxlength: 100 },
    section: { type: String, required: true, trim: true, maxlength: 50 },
    subjectName: { type: String, required: true, trim: true, maxlength: 100 },
    attendanceDates: [Date],
  },
  { versionKey: false } // the existing documents have no __v
);

// The 3rd argument pins the collection; without it Mongoose would use "attendances".
const Attendance =
  mongoose.models.Attendance || mongoose.model('Attendance', schema, 'daily_attendance');

// Dates are stored as UTC midnight, like the existing documents. Rejects "2026-02-30".
function toDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

// An optional list of days like ["2026-10-08"]: undefined when not sent, null when invalid,
// otherwise the same days as unique, sorted Dates.
function toDays(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || list.length > 400) return null;
  const days = list.map(toDay);
  if (days.includes(null)) return null;
  return [...new Map(days.map((d) => [d.getTime(), d])).values()].sort((a, b) => a - b);
}

// Trims and checks the name, section and subject: the same rules for adding and for editing.
async function cleanFields(body) {
  const { studentName, section, subjectName } = body;
  const doc = new Attendance({ studentName, section, subjectName });
  await doc.validate();
  return { studentName: doc.studentName, section: doc.section, subjectName: doc.subjectName };
}

const DAYS_ERROR = 'attendanceDates must be a list of dates like 2026-10-08';
const DUPLICATE = 'That student is already listed for this section and subject';
const NOT_FOUND = 'Student not found';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (req.method !== 'GET') {
    // shortcut: one shared key and no rate limit; move to real logins if more than one teacher uses this.
    if (!process.env.WRITE_KEY) {
      return res.status(503).json({ error: 'Writes are off: set WRITE_KEY on the server' });
    }
    if (req.headers['x-api-key'] !== process.env.WRITE_KEY) {
      return res.status(401).json({ error: 'Wrong or missing teacher key' });
    }
  }

  try {
    await connectToDatabase();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const id = req.query.id;

    // READ: every student with their attendance dates.
    if (req.method === 'GET') {
      // shortcut: no pagination, fine for a class roster; add limit/skip past a few thousand rows.
      const rows = await Attendance.find().sort({ section: 1, studentName: 1 }).lean();
      return res.status(200).json(rows);
    }

    // CREATE: { studentName, section, subjectName, attendanceDates?: ["YYYY-MM-DD", ...] }
    if (req.method === 'POST') {
      const fields = await cleanFields(body);
      const days = toDays(body.attendanceDates);
      if (days === null) return res.status(400).json({ error: DAYS_ERROR });
      if (await Attendance.exists(fields)) return res.status(409).json({ error: DUPLICATE });
      const doc = new Attendance({ ...fields, attendanceDates: days || [] });
      await doc.save();
      return res.status(201).json(doc);
    }

    // UPDATE (one day): PATCH /api?id=<_id> with { "date": "YYYY-MM-DD" } marks the student present that day.
    if (req.method === 'PATCH') {
      const day = toDay(body.date);
      if (!day || !mongoose.isObjectIdOrHexString(id)) {
        return res.status(400).json({ error: 'Need ?id=<student id> and a date like 2026-10-08' });
      }
      const updated = await Attendance.findByIdAndUpdate(
        id,
        { $addToSet: { attendanceDates: day } },
        { returnDocument: 'after' }
      ).lean();
      return updated ? res.status(200).json(updated) : res.status(404).json({ error: NOT_FOUND });
    }

    // PUT and DELETE work on one existing student: ?id=<_id>
    if (!mongoose.isObjectIdOrHexString(id)) {
      return res.status(400).json({ error: 'Need ?id=<student id>' });
    }

    // UPDATE (whole record): PUT /api?id=<_id> with the same body as POST. Fixes a misspelled name,
    // section or subject; if attendanceDates is sent it replaces the old list (so dates can be changed or removed).
    if (req.method === 'PUT') {
      const fields = await cleanFields(body);
      const days = toDays(body.attendanceDates);
      if (days === null) return res.status(400).json({ error: DAYS_ERROR });
      if (await Attendance.exists({ ...fields, _id: { $ne: id } })) return res.status(409).json({ error: DUPLICATE });
      const updated = await Attendance.findByIdAndUpdate(
        id,
        { $set: days ? { ...fields, attendanceDates: days } : fields },
        { returnDocument: 'after' }
      ).lean();
      return updated ? res.status(200).json(updated) : res.status(404).json({ error: NOT_FOUND });
    }

    // DELETE: DELETE /api?id=<_id> removes the student and all their attendance dates.
    const gone = await Attendance.findByIdAndDelete(id).lean();
    return gone ? res.status(200).json({ deleted: true, _id: gone._id }) : res.status(404).json({ error: NOT_FOUND });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: 'Database error' });
  }
};
