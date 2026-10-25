import { bootstrap } from './index.js'
import { pool } from './pool.js'

// Hostinger loads the entry file through its launcher instead of running it as argv[1].
bootstrap().catch(async (error) => {
  console.error('SipUp startup failed:', error.message)
  await pool.end()
  process.exitCode = 1
})
