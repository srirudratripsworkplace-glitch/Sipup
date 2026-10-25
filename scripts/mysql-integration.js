// Runs integration tests in a private local MySQL instance, never the app DB.
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import mysql from 'mysql2/promise'

const directory = await mkdtemp(resolve('mysql-test-'))
const mysqld = process.env.MYSQLD_PATH || 'mysqld'
const run = (args, options = {}) => new Promise((resolveRun, reject) => {
  const processRun = spawn(mysqld, args, { windowsHide: true, ...options })
  processRun.on('error', reject)
  processRun.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`MySQL exited with code ${code}`)))
})
let daemon, shutdownConfig
try {
  const dataPath = directory.replaceAll('\\', '/')
  const dataOptions = [`--datadir=${dataPath}`, `--innodb-data-home-dir=${dataPath}`, `--innodb-undo-directory=${dataPath}`]
  await run(['--no-defaults','--initialize-insecure', ...dataOptions, '--console'], { stdio: 'inherit', cwd: directory })
  const portProbe = createServer()
  await new Promise((done) => portProbe.listen(0, '127.0.0.1', done))
  const port = portProbe.address().port
  await new Promise((done) => portProbe.close(done))
  let startupLog = ''
  daemon = spawn(mysqld, ['--no-defaults', '--console', ...dataOptions, `--port=${port}`, '--bind-address=127.0.0.1', '--mysqlx=0', `--log-error=${dataPath}/error.log`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: directory })
  daemon.stdout.on('data', (chunk) => { startupLog += chunk })
  daemon.stderr.on('data', (chunk) => { startupLog += chunk })
  daemon.on('error', () => {})
  let connection
  for (let attempt = 0; attempt < 100; attempt++) {
    try { connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', connectTimeout: 500 }); break }
    catch { await new Promise((done) => setTimeout(done, 200)) }
  }
  if (!connection) throw new Error(`Test MySQL failed to start (${await readdir(directory)}): ${startupLog} ${await readFile(resolve(directory, 'error.log'), 'utf8').catch(() => '')}`)
  const password = randomUUID()
  await connection.query('ALTER USER CURRENT_USER() IDENTIFIED BY ?', [password])
  shutdownConfig = { host: '127.0.0.1', port, user: 'root', password }
  await connection.end()
  const result = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--test'], { stdio: 'inherit', windowsHide: true,
      env: { ...process.env, SIPUP_TEST_MYSQL: '1', DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'root', DB_PASSWORD: password,
        DB_SSL: 'false', JWT_SECRET: randomUUID() + randomUUID() } })
    child.on('error', reject); child.on('exit', done)
  })
  process.exitCode = result || 0
} finally {
  if (shutdownConfig) {
    const control = await mysql.createConnection(shutdownConfig)
    try { await control.query('SHUTDOWN') } finally { await control.end() }
  }
  if (daemon && daemon.exitCode === null) {
    daemon.kill()
    await new Promise((done) => { if (daemon.exitCode !== null) done(); else daemon.once('exit', done) })
  }
  // Only the exact directory created by mkdtemp in this workspace is removed.
  if (directory.startsWith(resolve('mysql-test-'))) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
}
