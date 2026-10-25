import test from 'node:test'
import assert from 'node:assert/strict'
import { identity, money, treatment, makePlan, csv } from '../server/catalogue-import/products.js'
import { safeEntry } from '../server/catalogue-import/extract.js'

const sourceRow = (extra={}) => {
  const r={name:'Example',size:'330ml',flavour:'Cherry',units:12,pricePence:1299,unitPricePence:108,
    treatment:'standard',vatRaw:0.2,category:'American',subcategory:'Drinks',row:2,raw:['Example','330ml',12,'Cherry',12.99,0.2,'American','Drinks',1.08,'-'],errors:[],unitMismatch:false,...extra}
  return {...r,...identity(r)}
}
test('identifiers preserve flavour and case identity and ignore mutable prices/row numbers',()=>{
  const a=sourceRow(),b=sourceRow({pricePence:1499,row:100,category:'Global'})
  assert.equal(a.sku,b.sku);assert.equal(a.slug,b.slug)
  assert.notEqual(a.sku,sourceRow({flavour:'Orange'}).sku)
  assert.notEqual(a.sku,sourceRow({units:24}).sku)
  assert.equal(a.sku,sourceRow({name:' EXAMPLE  '}).sku)
})
test('money and VAT mapping preserve source semantics',()=>{
  assert.equal(money('12.99'),1299);assert.equal(money('£7.09'),709)
  assert.equal(money('1.999'),null);assert.equal(money(''),null)
  assert.equal(treatment(0.2,'0%'),'standard');assert.equal(treatment(0.2,''),null)
  assert.equal(treatment(0,'0%'),'zero');assert.equal(treatment('Exempt'),'exempt')
  assert.equal(treatment('VAT'),null);assert.equal(treatment(''),null)
})
test('unknown tax price convention never produces tax figures; all new flavours propose 20 cases',()=>{
  const plan=makePlan({workbookHash:'test',rows:[sourceRow(),sourceRow({flavour:'Orange'})]}, {pdfHash:'pdf',assets:[],pages:[]},[])
  assert.equal(plan.summary.proposedInitialCases,40)
  assert.ok(plan.records.every(r=>r.tax===null&&r.initialStockCases===20))
})
test('existing SKUs retain their identifiers and stock; duplicates are invalid',()=>{
  const r=sourceRow()
  const plan=makePlan({workbookHash:'test',rows:[r]}, {pdfHash:'pdf',assets:[],pages:[]},[{id:99,sku:r.sku,slug:'original-slug',stock_quantity:73}])
  assert.equal(plan.records[0].initialStockCases,null);assert.equal(plan.records[0].existingStock,73)
  assert.equal(plan.records[0].slug,'original-slug');assert.equal(plan.records[0].action,'preserve_existing')
  const dup=makePlan({rows:[r,r]}, {assets:[],pages:[]},[])
  assert.equal(dup.summary.duplicateRecords,2);assert.equal(dup.records[0].status,'invalid')
})
test('image suggestions cannot become confirmed matches without explicit review',()=>{
  const r=sourceRow();const inv={pdfHash:'pdf',assets:[{id:'image',hash:'one',page:1,x:0,y:100,width:50,height:100}],pages:[{page:1,texts:[{text:'330ml',x:0,y:300,width:50},{text:'Cherry',x:0,y:90,width:50}]}]}
  const plan=makePlan({rows:[r]},inv,[])
  assert.equal(plan.records[0].image,null);assert.ok(plan.records[0].candidates.length)
  assert.throws(()=>makePlan({rows:[r]},inv,[],{images:{[r.sku]:{assetId:'image',confirmed:true,assetHash:'wrong'}}}),/Reviewed image changed/)
})
test('ZIP traversal is rejected and CSV cells are escaped',()=>{
  for(const path of ['../bad.pdf','/bad.pdf','C:/bad.pdf','folder\\bad.pdf'])assert.throws(()=>safeEntry(path),/Unsafe/)
  assert.doesNotThrow(()=>safeEntry('catalogue/catalogue.pdf'))
  assert.match(csv([['=SUM(A1)','a,b','a"b']]),/"'=SUM\(A1\)"/)
  assert.match(csv([['a"b']]),/a""b/)
})
