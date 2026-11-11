const mongoose = require('mongoose');

// A connection string with no "/<database>" part silently falls back to the "test" database,
// which is why the API used to miss the attendance data. Naming the database here prevents that.
const DB_NAME = 'LabAttendanceDB_Agban';

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cached.conn) return cached.conn;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(process.env.MONGODB_URI, {
        dbName: DB_NAME,
        bufferCommands: false,
        serverSelectionTimeoutMS: 5000, // fail fast with an error instead of hitting Vercel's 10s timeout
      })
      .catch((err) => {
        cached.promise = null; // a cached failure would break every later request on this warm instance
        throw err;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = connectToDatabase;
