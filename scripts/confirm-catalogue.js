import {writeFile,mkdir} from 'node:fs/promises'
import {pool} from '../server/pool.js'
import {readProducts} from '../server/catalogue-import/products.js'
import {confirmCatalogue} from '../server/catalogue-import/confirm.js'

try {
  const source=await readProducts('server/catalogue-import/available-stock-list.xlsm')
  if(source.rows.length!==162) throw new Error('Expected the reviewed 162-row catalogue.')
  const result=await confirmCatalogue(pool,source,{commit:process.argv.includes('--commit')})
  await mkdir('reports/catalogue-import',{recursive:true})
  await writeFile(`reports/catalogue-import/vat-${result.committed?'confirmation':'preview'}.json`,JSON.stringify(result,null,2))
  console.log(JSON.stringify({...result,records:undefined},null,2))
} catch(error) {console.error(error.message);process.exitCode=1}
finally {await pool.end()}
