# Attendance Management Portal

A web portal for lab attendance. A teacher can add students with the dates they attended, see them in a
list, fix a misspelled name or a wrong date, and delete wrong or duplicate records.

- **Page:** `public/index.html` (plain HTML, CSS and JavaScript, no build step)
- **API:** `api/index.js`, a Vercel serverless function at `/api`
- **Database:** MongoDB Atlas, database `LabAttendanceDB_Agban`, collection `daily_attendance`
  (the name is set in `db.js`, so it does not depend on what the connection string contains)

Live site: https://agban-api-backend.vercel.app/

## CRUD

| | In the page | API call |
| --- | --- | --- |
| **Create** | **Add student** form: student name, section, subject and date | `POST /api` |
| **Read** | Student list for the chosen class day, with search and section and subject filters | `GET /api` |
| **Update** | **Edit** on a student: fix a misspelled name, section or subject, and change, add or remove dates. The check button marks a student present for the day. | `PUT /api?id=…` and `PATCH /api?id=…` |
| **Delete** | **Delete** on a student, after a confirmation box | `DELETE /api?id=…` |

The page shows a message after every add, save and delete, and asks before it deletes anything.

## API

All routes are at `/api`. Records look like this:

```json
{ "_id": "…", "studentName": "Juan Dela Cruz", "section": "BSIT-3A", "subjectName": "Database 2",
  "attendanceDates": ["2026-10-08T00:00:00.000Z"] }
```

| Method | What it does | Body | Success |
| --- | --- | --- | --- |
| `GET` | All records | none | `200` and a list |
| `POST` | Add a student | `{ studentName, section, subjectName, attendanceDates? }` | `201` and the new record |
| `PUT ?id=<_id>` | Fix name, section or subject. If `attendanceDates` is sent it replaces the old list. | same as `POST` | `200` and the record |
| `PATCH ?id=<_id>` | Mark present on one day | `{ "date": "YYYY-MM-DD" }` | `200` and the record |
| `DELETE ?id=<_id>` | Delete the student and their dates | none | `200` and `{ "deleted": true }` |

`attendanceDates` is a list of days like `["2026-10-08", "2026-10-15"]`.
Errors: `400` bad input, `401` wrong or missing key, `404` no such record, `409` the same student is already
listed for that section and subject, `503` the server has no `WRITE_KEY`.

## Security

- The MongoDB connection string exists only as the Vercel environment variable `MONGODB_URI`. It is never in
  the page or in this repo (`.env` files are git-ignored).
- Anyone can read. Writes (`POST`, `PUT`, `PATCH`, `DELETE`) need the header `x-api-key` to match the
  `WRITE_KEY` environment variable. The teacher types the key once into the page (**Teacher key**), and it
  stays in that browser only.
- The server checks every input: required fields, maximum lengths, real calendar dates and valid ids. The page
  writes names with `textContent`, so a name can never inject HTML.

## Deploy on Vercel

1. Push this repo to GitHub.
2. In Vercel choose **Add New, Project** and import the repo. No build command is needed.
3. Under **Settings, Environment Variables** add `MONGODB_URI` (the Atlas connection string `mongodb+srv://…`
   for a database user that can read and write `LabAttendanceDB_Agban`) and `WRITE_KEY` (a password of
   your choice). Redeploy afterwards.
4. In Atlas, **Network Access** must allow Vercel. Its addresses change, so a class project usually allows
   `0.0.0.0/0`.
5. Every push to `main` deploys to production again.

## Tests

`npm test` runs the API tests with the database stubbed out, so no connection string is needed.
