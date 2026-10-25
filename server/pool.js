import 'dotenv/config'
import mysql from 'mysql2/promise'

const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
const missing = required.filter((key) => !process.env[key])

if (missing.length) {
  throw new Error(`MySQL connection settings are required: ${missing.join(', ')}.`)
}

const nativePool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  connectTimeout: 10_000,
  timezone: 'Z',
  decimalNumbers: false,
  dateStrings: false,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2' } : undefined,
})

function serialise(value) {
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return JSON.stringify(value)
  }
  return value
}

async function execute(connection, sql, params = []) {
  const preparedParams = params.map(serialise)
  const [result] = preparedParams.length
    ? await connection.execute(sql, preparedParams)
    : await connection.query(sql)
  if (Array.isArray(result)) {
    return { rows: result, rowCount: result.length, insertId: 0 }
  }
  return { rows: [], rowCount: result.affectedRows, insertId: result.insertId }
}

export const pool = {
  query: (sql, params = []) => execute(nativePool, sql, params),
  connect: async () => {
    const connection = await nativePool.getConnection()
    return {
      query: (sql, params = []) => execute(connection, sql, params),
      release: () => connection.release(),
    }
  },
  end: () => nativePool.end(),
}
