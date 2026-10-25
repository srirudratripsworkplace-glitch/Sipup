import { readFile, readdir, writeFile } from 'node:fs/promises'

const products=JSON.parse(await readFile('reports/product-images/products.json','utf8'))
const sources=(await Promise.all((await readdir('reports/product-images/sources')).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(`reports/product-images/sources/${f}`,'utf8'))))).flat()
sources.push({title:'Faygo Black Cherry — official manufacturer photograph',handle:'black-cherry',url:'https://www.faygo.com/flavors/',images:[{src:'https://www.faygo.com/wp-content/uploads/2018/06/blackcherry.png'}]})
const selections=new Map()
function select(store, entries) {
 for(const [id, handle, size, note=''] of entries) {
  const source=sources.find(s=>new URL(s.url).hostname.replace(/^www\./,'')===store && s.handle===handle)
  if(!source) throw new Error(`Missing source ${id}: ${store}/${handle}`)
  const p=products.find(p=>p.id===id)
  selections.set(id,{id,sku:p.sku,name:p.name,catalogueSize:p.catalogue_details.size,sourceSize:size,note,
   sourceTitle:source.title,sourcePage:source.url,sourceImage:source.images[0].src,
   sourceWidth:source.images[0].width,sourceHeight:source.images[0].height,status:'selected'})
 }
}
select('candyfunhouse.com',[
 [23,'mike-and-ike-sour-blue-raspberry-theater-box-4-25oz','4.25oz'],
 [24,'mike-and-ike-red-rageous-theatre-pack-4-25oz','4.25oz'],
 [25,'mike-and-ike-original-fruits-theatre-pack-5oz','4.25oz'],
 [26,'mike-and-ike-mega-mix-sour-candy-theater-pack-5-oz','4.25oz'],
 [27,'mike-and-ike-jolly-joes-theatre-pack-4-25oz','4.25oz','Catalog spelling Jolly Jose refers to Jolly Joes.'],
 [28,'mike-and-ike-tropical-typhoon-theatre-pack-5oz','4.25oz'],
 [29,'mike-and-ike-sour-watermelon-120g','120g'],
 [30,'mike-and-ike-berry-blast-theatre-pack','4.25oz'],
 [31,'mike-and-ike-ice-cream-truck-mix-theatre-pack-4-25oz','4.25oz'],
 [32,'mike-and-ike-mega-mix-theatre-pack','4.25oz'],
 [33,'mike-and-ike-thrill-ride-mix-theatre-pack-4-25oz','4.25oz'],
 [34,'hot-tamales-tropical-heat-4-25oz','4.25oz'],
 [35,'hot-tamales-fierce-cinnamon-theatre-pack-5oz','4.25oz'],
 [66,'fanta-strawberry-malaysia-320ml','320ml'],
 [70,'fanta-stawberry-and-kiwi-330ml','330ml'],
 [134,'haribo-alphabet-letters-gummi-candy','142g'],
 [137,'nik-l-nip-wax-bottle-candy-8-pack','8pk'],
 [138,'nik-l-nip-wax-bottle-candy-4-pack','4pk'],
 [141,'pringles-mexican-street-corn-156g','156g','Catalog calls Mexican Street Corn Mexican Sweet Corn.'],
 [151,'takis-fuego-90g','90g'],
 [152,'takis-crisps-blue-heat-5-5oz','5.5oz'],
 [153,'van-holtens-jumbo-big-papa-pickle','9oz'],
 [154,'van-holtens-jumbo-hot-mama-pickle','9oz'],
 [155,'van-holtens-rick-and-morty-pickle-rick-jumbo-pickle-9oz','9oz'],
 [156,'van-holtens-sour-sis-jumbo-pickle','9oz','Sour Sisters refers to Sour Sis.'],
 [163,'gushers-tropical-4-25oz','4.25oz'],
 [164,'fruit-gushers-super-sour-berry-4-25oz','4.25oz'],
 [165,'gushers-watermelon-sour-apple-4-25oz','4.25oz'],
 [166,'fruit-gushers-flavor-mixers-4-25oz','4.25oz'],
 [174,'faygo-cotton-candy-710ml','710ml'],
 [176,'faygo-super-pop-591ml','710ml'],
])
select('americancandyuk.co.uk',[
 [36,'airheads-cherry-15-6g','15.6g'],[37,'airheads-watermelon-15-6g','15.6g'],
 [39,'airheads-sour-blue-blast-bar-15-6g','15.6g'],[40,'airheads-sour-watermelon-punch-bar-15-6g','15.6g'],
 [41,'laffy-taffy-banana-rope-candy-22-9g','22.9g'],[43,'laffy-taffy-sour-apple-rope-candy-22-9g','22.9g'],
 [44,'laffy-taffy-strawberry-rope-candy-22-9g','22.9g'],[45,'laffy-taffy-cherry-rope-candy-22-9g','22.9g'],
 [46,'fanta-strawberry-355ml','355ml'],[47,'fanta-peach-355ml','355ml'],[48,'fanta-orange-355ml','355ml'],
 [49,'fanta-grape-355ml','355ml'],[51,'fanta-pineapple-355ml','355ml'],[52,'coca-cola-vanilla-355ml','355ml'],
 [53,'coca-cola-classic-u-s-origin-355ml','355ml'],[54,'sprite-chill-cherry-lime-355ml','355ml'],
 [55,'pepsi-wild-cherry-355ml','355ml'],[56,'dr-pepper-cream-soda-355ml','355ml'],
 [57,'dr-pepper-strawberries-cream-355ml','355ml'],[58,'dr-pepper-vanilla-float-355ml','355ml'],
 [59,'dr-pepper-blackberry-355ml','355ml'],[60,'dr-pepper-creamy-coconut-355ml','355ml'],
 [61,'dr-pepper-cherry-355ml-1','355ml'],[62,'dr-pepper-usa-original-355ml','355ml'],
 [63,'7up-tropical-355ml','355ml'],[64,'7up-cherry-355ml','355ml'],
 [67,'fanta-fruit-punch-malaysia-320ml','320ml'],[71,'fanta-exotic-330ml','330ml'],
 [72,'monster-energy-ultra-red-white-blue-473ml','473ml'],[73,'monster-ultra-punk-punch-473ml','473ml'],
 [74,'monster-energy-voodoo-grape-473ml','473ml'],[75,'monster-energy-original-zero-strawberry-shot-473ml','473ml'],
 [76,'monster-energy-original-strawberry-shot-473ml','473ml'],[77,'monster-energy-strawberry-lemonade-473ml','473ml'],
 [78,'monster-energy-electric-blue-473ml','473ml'],[79,'monster-reserve-orange-dreamsicle-473ml','473ml'],
 [81,'monster-java-mean-bean-444ml','444ml'],[82,'copy-of-monster-java-salted-caramel-444ml','444ml'],
 [84,'fanta-lime-china-500ml','500ml'],[85,'fanta-chinese-jasmine-peach-500ml','500ml'],
 [86,'fanta-chinese-watermelon-500ml','500ml'],[88,'fanta-chinese-green-apple-500ml','500ml'],
 [91,'fanta-melon-hong-kong-500ml','500ml'],[93,'fanta-chocolate-banana-hong-kong-500ml','500ml'],
 [111,'sour-patch-kids-watermelon-102g','102g'],[114,'sour-patch-kids-tropical-102g','102g'],
 [115,'sour-patch-kids-strawberry-watermelon-glowups-87g','87g'],
 [116,'sour-patch-chews-60g','60g'],
 [119,'copy-of-sour-patch-kids-extreme-113g','99g'],
 [123,'haribo-sour-gold-bears-127g','127g'],[125,'copy-of-haribo-sour-sghetti-142g','142g'],
 [127,'haribo-z-ng-sour-streamers-127g','127g'],[128,'haribo-berries-113g','142g'],
 [129,'haribo-frogs-142g','142g'],[130,'haribo-unicorn-i-licious-142g','142g'],
 [131,'haribo-sour-smurfs-113g','113g'],[132,'haribo-smurfs-113g','113g'],
 [133,'haribo-dinosaurs-142g','142g'],[135,'haribo-berry-clouds-142g','117g'],
 [136,'haribo-sour-sghetti-142g','142g'],[139,'nik-l-nip-cry-baby-sour-wax-bottles-8-pack-79g','8pk'],
 [142,'pringles-chile-lime-flavour-156g','156g'],[144,'pringles-7-layer-dip-156g','156g'],
 [145,'pringles-honey-mustard-155g','156g'],[146,'pringles-smoky-cheddar-9156g','156g'],
 [147,'pringles-pizza-155g','156g'],[149,'takis-fuego-xtreme-28g','92g'],
 [160,'samyang-buldak-spicy-taco-hot-chicken-ramen-noodles-5-pack650g','5 × 130g'],
 [180,'gatorade-lemon-lime-591ml-1','591ml'],[181,'gatorade-fruit-punch-591ml','591ml'],
 [182,'gatorade-orange-591ml','591ml'],[184,'gatorade-frost-glacier-cherry-591ml','591ml'],
])
select('candymail.co.uk',[
 [38,'airheadsmystery-flavour-bar-15-6g','15.6g'],[42,'laffy-taffy-blue-raspberry-22-9g','22.9g'],
 [65,'fanta-lychee-slim-can-malaysia-320ml','320ml'],[92,'fanta-passionfruit-china-500ml','500ml'],
 [95,'trident-cinnamon-gum-31g','31g'],[97,'trident-mint-bliss-31g','31g'],
 [98,'trident-island-berry-lime-gum-31g','31g'],[99,'trident-wintergreen-gum-31g','31g'],
 [100,'trident-bubblegum-gum-31g','31g'],[101,'trident-perfect-original-gum-31g','31g'],
 [102,'trident-tropical-twist-gum-31g','31g'],[103,'trident-perfect-peppermint-gum-31g','31g'],
 [105,'trident-watermelon-twist-gum-31g','31g'],[124,'haribo-goldbears-wild-berry-usa-142g','142g'],
 [143,'pringles-smoky-mesquite-bbq-158g','158g'],[150,'takis-pickle-punch-rolled-tortilla-chips-92-3g','92.3g'],
 [177,'faygo-cream-dreamin-orange-creme-soda-710ml','710ml'],[178,'faygo-firework-710ml','710ml'],
 [179,'pascall-clinkers-160g','160g'],[183,'gatorade-glacier-freeze-591ml-canadian','591ml'],
])
select('candycargo.co.uk',[
 [68,'mirinda-orange-can-24x330ml','330ml'],[69,'mirinda-strawberry-can-24x330ml','330ml'],
 [83,'fanta-white-peach-12x500ml','500ml'],[87,'fanta-ori̇ental-orange-12x500ml','500ml'],
 [89,'fanta-pineapple-12x500ml','500ml'],[90,'fanta-chinese-lychee-12x500ml','500ml'],
 [94,'fanta-ori̇ental-orange-12x500ml','500ml'],
 [108,'sour-patch-kids-blue-raspberry-12x102g-bag','102g'],
 [112,'sour-patch-kids-original-12x141g-bag','102g'],
 [157,'samyang-buldak-carbonara-hot-chicken-ramen-8x5x130g','5 × 130g'],
 [158,'samyang-buldak-cream-carbonara-hot-chicken-ramen-8x5x140g','5 × 140g'],
 [162,'samyang-buldak-hot-chicken-ramen-5x140g','5 × 140g','Owner confirmed Spicy means black Buldak, not red 2x Spicy.'],
])
select('candytheatre.com',[
 [50,'fanta-berry-soda-can-12oz-355ml','355ml'],[80,'monster-java-irish-creme-12x444ml-no-vat','444ml'],
 [96,'trident-single-spearmint-x-12','31g'],[104,'trident-single-pineapple-twist-x-14','31g'],
 [106,'rainbow-nerds-theatre-box','141g'],[107,'nerds-grape-strawberry-theatre-box-141g','141g'],
 [109,'sour-patch-lemonade-peg-bag-102g-x-12','102g'],
 [110,'sour-patch-kids-strawberry-peg-bag-3-6oz-102g-12ct','102g'],
 [113,'sour-patch-kids-peach-102g-x-12','101g'],[117,'sour-patch-kids-grape-peg-bag-101g-x-12','101g'],
 [118,'sour-patch-watermelon-theatre-box-99g','99g'],[120,'sour-patch-kids-tropical-99g','99g'],
 [122,'sour-patch-kids-theatre-box-99g','99g'],
 [126,'haribo-peg-bag-happy-cherries-5oz-x-12','142g'],
 [161,'samyang-hot-chicken-ramyun-cheese-140g-x-5-x-8','5 × 140g'],
])
select('www.cafelax.com'.replace(/^www\./,''),[[148,'takis-blue-heat-tortila-chips-90g','90g']])
select('instock.net',[[140,'nik-l-nip-cry-baby-sour-wax-bottles-39g-4-pack','4pk']])
select('rainbowlandcandyco.com',[[167,'gushers-all-blue-sour-blue-raspberry-blueberry-grape','4.25oz']])
select('blaircandy.com',[[121,'sour-patch-kids-red-white-and-blue','3.08oz']])
select('extremesnacks.ca',[[173,'faygo-redpop-drink-710ml','710ml']])
select('quecan.com',[[175,'faygo-soft-drink-black-cherry-24-x-710ml-can-dep','710ml']])
select('asianfood.nz',[[159,'samyang-ramen-multipack-120g-5pk','5 × 120g','Owner confirmed Original means orange Samyang ramen.']])
select('americancandyuk.co.uk',[
 [168,'fruit-roll-ups-jolly-rancher-141g','141g'],[169,'fruit-roll-ups-rainbow-sherbert-141g','141g'],
 [170,'fruit-roll-up-sour-variety-pack-141g','141g'],[171,'fruit-roll-ups-tropical-tie-dye-141g','141g'],
])
select('candymail.co.uk',[[172,'fruit-roll-ups-blastin-berry-variety-pack-141g','141g']])
// Replacements chosen after the first visual review: no supplier captions or bundles.
select('candyfunhouse.com',[
 [83,'fanta-white-peach-china-500ml','500ml'],
 [89,'fanta-pineapple-china-500ml','500ml'],
 [124,'haribo-gold-bears-wildberry-5oz','5oz'],
 [93,'fanta-banana-chocolate-500ml','500ml'],
])
select('candymail.co.uk',[
 [87,'fanta-orange-bottle-china-500ml','500ml'],
 [94,'fanta-orange-bottle-china-500ml','500ml'],
])
select('extremesnacks.ca',[[90,'fanta-lychee-flavoured-bottle-500ml-china-edition','500ml']])
select('candytheatre.com',[
 [42,'blue-raspberry-laffy-taffy-rope-22g','22g'],
 [96,'trident-single-spearmint-x-12','14 sticks (weight not stated)'],
 [104,'trident-single-pineapple-twist-x-14','14 sticks (weight not stated)'],
])
select('redfernconveniencestore.com',[[175,'faygo-black-cherry-710ml','710ml']])
const result=products.map(p=>selections.get(p.id)||{id:p.id,name:p.name,status:'unresolved'})
await writeFile('reports/product-images/selection.json',JSON.stringify(result,null,2))
console.log(JSON.stringify({selected:selections.size,missing:result.filter(p=>p.status==='unresolved')},null,2))
