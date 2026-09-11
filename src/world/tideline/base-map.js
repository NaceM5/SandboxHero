// All dimensions are meters. X east, Y up, Z south. Deterministic and engine independent.
export const GROUND = 8;
export const districts = [
 {name:'Harbor City',subtitle:'Downtown · Alleys · Waterfront',target:[-970,0,-110],camera:[-1650,1100,1430],spawn:[-920,10,-60]},
 {name:'Golden Strait',subtitle:'Suspension bridge · Bay crossing',target:[0,20,-60],camera:[-440,590,920],spawn:[0,40,-60]},
 {name:'Eastbank',subtitle:'Neighborhoods · Shops · Parks',target:[940,0,60],camera:[1700,1020,1450],spawn:[880,10,180]},
 {name:'Working waterfront',subtitle:'Station · Warehouses · Piers',target:[-610,0,-440],camera:[-200,700,-1350],spawn:[-680,10,-300]},
 {name:'Commons & coast',subtitle:'Playing field · Pond · Open space',target:[1070,0,425],camera:[1670,780,1140],spawn:[880,10,420]}
];
export function createMapData(){
 const boxes=[],ramps=[],routes=[],zones=[];let id=0;
 function box(name,x,y,z,w,h,d,material,solid=true,kind='structure'){const o={id:`map-${id++}`,name,x,y,z,w,h,d,material,solid,kind};boxes.push(o);return o;}
 function slab(name,x,z,w,d,material,y=8.15,h=.3,solid=true){return box(name,x,y-h/2,z,w,h,d,material,solid,'surface');}
 function road(name,x,z,w,d){slab(name+' sidewalk',x,z,w+12,d+12,'sidewalk');slab(name,x,z,w,d,'road',8.19);routes.push({name,x,z,width:w,depth:d,y:8.19,type:'road'});
 const alongX=w>d,len=alongX?w:d;for(let t=-len/2+12;t<len/2-6;t+=22)slab('Lane marking',x+(alongX?t:0),z+(alongX?0:t),alongX?9:.65,alongX?.65:9,'paint',8.22,.02,false);}
 const islands=[{name:'Harbor Island',outline:[[-1570,-540],[-1490,-710],[-520,-710],[-220,-520],[-220,410],[-400,710],[-1300,710],[-1570,500]]},{name:'Eastbank Island',outline:[[240,-530],[430,-720],[1280,-720],[1550,-490],[1630,160],[1460,680],[580,720],[240,460]],pond:{x:1160,z:423,rx:115,rz:80}}];
 const westXs=[-1400,-1160,-920,-680,-440],zs=[-540,-300,-60,180,420,600];
 westXs.forEach(x=>{if(x===-1160){road('City avenue north',x,-203.5,24,803);road('City avenue south',x,504,24,204);}else if(x===-680){road('Abutment avenue north',x,-356,24,498);road('Abutment avenue south',x,276,24,578);}else road('City avenue',x,-20,24,1170);});zs.forEach(z=>road('Harbor cross street',-920,z,1000,24));
 [420,650,880,1110,1340].forEach(x=>{if(x===1110||x===1340)road('Eastbank avenue',x,-220,20,660);else road('Eastbank avenue',x,-20,20,1170)});
 [-540,-300,-60,180,600].forEach(z=>road('Eastbank street',880,z,960,20));road('Park approach',650,420,460,20);
 // Reserve the bridge corridor before allocating building lots.
 for(let xi=0;xi<4;xi++)for(let zi=0;zi<4;zi++){
 const x=(westXs[xi]+westXs[xi+1])/2,z=(zs[zi]+zs[zi+1])/2;
 if(zi===3&&xi<2)continue;if(xi===3&&zi===0)continue;
 for(let a=-1;a<=1;a+=2)for(let b=-1;b<=1;b+=2){let bx=x+a*53,bz=z+b*52;
 if(bx>-790&&Math.abs(bz+60)<115)continue;
 const seed=(xi*17+zi*13+(a+2)*7+(b+2)*11);const h=40+(seed%8)*17+(xi===1&&zi===1?90:0);
 slab('Building lot',bx,bz,96,94,'paving',8.24);
 box('Downtown building',bx,8+h/2,bz,66+(seed%3)*5,h,64+(seed%2)*8,['concrete','sand','glass','slate'][seed%4]);
 box('Roof cap',bx,8+h+1,bz,70+(seed%3)*5,2,68+(seed%2)*8,'roof');
 if(h>95)box('Setback crown',bx,8+h+9,bz,43,16,42,'concrete');
 }
 // 22m clear center service alley, linked at both ends to the road grid.
 slab('Service alley',x,z,18,208,'alley',8.25);routes.push({name:'Service alley',x,z,width:18,depth:208,y:8.25,type:'pedestrian-service'});
 }
 // Southern waterfront blocks: midrise warehouses and apartments, set back from the quay.
 for(let x of [-1280,-1040,-800,-560]){box('Quayside block',x,28,518,105,40,94,'sand');box('Quayside roof',x,49,518,110,2,98,'roof');}
 // Public sports ground occupies full blocks, with access from every side.
 slab('Athletics precinct',-1160,300,430,176,'paving');slab('Running track',-1160,300,340,155,'track',8.3);slab('Playing field',-1160,300,300,118,'grass',8.34);
 for(let z of [243,357])slab('Touchline',-1160,z,290,.8,'paint',8.37,.02,false);
 for(let x of [-1305,-1015,-1160])slab('Field line',x,300,.8,114,'paint',8.37,.02,false);
 for(let x of [-1302,-1018]){box('Goal post',x,11,292,.5,5,.5,'paint');box('Goal post',x,11,308,.5,5,.5,'paint');box('Goal crossbar',x,13.5,300,.5,.5,16,'paint');}
 box('Field grandstand',-1160,13,383,270,10,26,'concrete');
 // Station: open concourse and canopies; columns use individual colliders.
 slab('Station plaza',-552,-422,190,192,'paving');box('Station hall',-548,21,-357,158,26,46,'sand');box('Station hall roof',-548,35,-357,166,3,51,'roof');
 for(let z of [-420,-471]){slab('Rail platform',-552,z,182,18,'sidewalk',9.1,1.1);box('Platform canopy',-552,20,z,190,2,23,'roof');for(let x=-630;x<-450;x+=40)box('Canopy support',x,14.5,z,1.6,9,1.6,'concrete');}
 for(let z of [-441,-448,-492,-499])slab('Rail',-450,z,380,.7,'metal',8.45,.25);
 // Terminal sidings remain in the reserved station block; no tracks cut through downtown lots.
 for(let x=-638;x<-260;x+=12)slab('Rail sleeper',x,-496,2,13,'railbed',8.3,.12,false);
 // Residential plots with 10m side setbacks and large front yards.
 for(let x of [535,765,995,1225])for(let z of [-420,-180,60,300,500]){
 if(z>=300&&x>900)continue;if(x===535&&z===300)continue;
 for(let dx of [-49,49]){const bx=x+dx;if(bx<730&&Math.abs(z+60)<100)continue;
 slab('Residential lot',bx,z,88,156,'lawn');const h=13+((Math.abs(bx+z)%3)*2);
 box('Eastbank house',bx,8+h/2,z,48,h,58,['cream','sand','clay'][Math.abs(bx+z)%3]);box('House roof',bx,8+h+2,z,53,4,63,'houseRoof');
 slab('Driveway',bx+31,z+30,11,90,'paving',8.22);}
 }
 slab('Neighborhood green',535,300,182,168,'grass');slab('Neighborhood park path',535,300,10,168,'path',8.25);slab('Neighborhood park path',535,300,182,10,'path',8.25);zones.push({name:'Neighborhood green',x:535,z:300,width:182,depth:168,type:'future-interactables'});
 // Retail fronts on the northern high street, with rear loading access.
 for(let x=485;x<1320;x+=105){box('High street shop',x,16,-656,82,16,60,x%2?'cream':'clay');box('Shop parapet',x,25,-656,86,2,64,'roof');box('Storefront glazing',x,13,-625.8,67,7,.3,'glass',false);}
 // Waterfront logistics zone on the east shore, separated from housing.
 for(let z of [-410,-210,0]){slab('Loading yard',1450,z,140,165,'paving');box('Port warehouse',1460,24,z,108,32,102,'warehouse');box('Warehouse roof',1460,41,z,112,3,106,'roof');for(let dx of [-28,0,28])box('Loading door',1460+dx,14,z+51.2,18,12,.4,'slate',false);}
 road('Port access',1380,-250,18,730);
 // Pond's actual terrain hole means the water has no supporting collider.
 zones.push({name:'Eastbank park',x:1160,z:423,width:390,depth:320,type:'future-interactables'},{name:'City field',x:-1160,z:300,width:340,depth:155,type:'sports'});
 for(let x of [947,1373])slab('Park promenade',x,410,12,355,'path',8.22);for(let z of [240,583])slab('Park promenade',1160,z,438,12,'path',8.22);
 // Piers, piles, and two finger docks. No water collider.
 function pier(name,x,z,length){slab(name,x,z,64,length,'pier',8.3,3);for(let zz=z-length/2+15;zz<z+length/2;zz+=45)for(let xx of [x-25,x+25])box('Pier pile',xx,0,zz,4,14,4,'pile');for(let side of [-1,1])slab('Finger dock',x+side*55,z+length/2-42,70,20,'pier',8.3,2);}
 pier('Harbor pier',-740,772,344);pier('Eastbank pier',780,790,380);
 // Level suspension span, gently graded abutments, and uninterrupted lanes.
 slab('Bridge deck',20,-60,760,38,'road',38,5);slab('Bridge walk north',20,-84,760,8,'sidewalk',38,5);slab('Bridge walk south',20,-36,760,8,'sidewalk',38,5);
 for(let x=-340;x<390;x+=22)slab('Bridge lane marking',x,-60,10,.65,'paint',38.03,.02,false);
 function ramp(name,x1,x2,z,width,y1,y2){ramps.push({id:`map-${id++}`,name,x1,x2,z,width,y1,y2,thickness:3,material:'road'});routes.push({name,type:'ramp',x1,x2,z,width,y1,y2});}
 for(let z of [-420,-471])ramp('Platform access ramp',-668,-643,z,10,8.24,9.1);
 ramp('West bridge approach',-740,-360,-60,54,8.19,38);ramp('East bridge approach',400,780,-60,54,38,8.19);
 for(let z of [-89,-31]){box('Bridge guardrail',20,39.2,z,760,2.4,1,'bridge');}
 for(let x of [-230,270]){for(let z of [-87,-33]){box('Suspension tower',x,76,z,12,140,12,'bridge');box('Tower foundation',x,6,z,25,20,25,'concrete');}for(let y of [65,111,141])box('Tower crossbeam',x,y,-60,14,7,66,'bridge');}
 // Elevated urban crossing and driveable ramps. Supports stay outside crossing avenues.
 slab('City overpass',-1030,180,560,26,'road',27,3);ramp('West overpass ramp',-1500,-1310,180,26,8.19,27);ramp('East overpass ramp',-750,-560,180,26,27,8.19);
 for(let x of [-1270,-1030,-790])for(let z of [160,200])box('Overpass column',x,16,z,5,18,5,'concrete');
 for(let z of [166,194])box('Overpass guardrail',-1030,28,z,560,2,1,'concrete');
 for(let x of [-1270,-1030,-790])box('Overpass support beam',x,24,180,7,3,46,'concrete');
 slab('Northern overpass',-1030,-300,560,26,'road',27,3);ramp('Northern west ramp',-1500,-1310,-300,26,8.19,27);ramp('Northern east ramp',-750,-560,-300,26,27,8.19);
 for(let x of [-1270,-1030,-790]){for(let z of [-320,-280])box('Northern overpass column',x,16,z,5,18,5,'concrete');box('Northern support beam',x,24,-300,7,3,46,'concrete');}
 for(let z of [-314,-286])box('Northern overpass guardrail',-1030,28,z,560,2,1,'concrete');
 for(let z of [-105,-15])box('Low clearance road closure',-680,9,z,26,1.6,1.5,'concrete');
 for(const r of [...ramps].filter(r=>!r.name.includes('Platform'))){for(const side of [-1,1])ramps.push({id:`map-${id++}`,name:r.name+' guardrail',x1:r.x1,x2:r.x2,z:r.z+side*(r.width/2+.6),width:1.2,y1:r.y1+1.2,y2:r.y2+1.2,thickness:1.2,material:r.name.includes('bridge')?'bridge':'concrete',kind:'barrier'});}
 return {version:1,units:'meters',bounds:{min:[-1700,-30,-950],max:[1700,320,1050]},islands,boxes,ramps,routes,zones,spawns:districts.map(d=>({name:d.name,position:d.spawn})),water:{height:0,solid:false},clearance:{cityRoad:24,residentialRoad:20,serviceAlley:18,bridgeRoad:38,bridgeSidewalk:8}};
}
