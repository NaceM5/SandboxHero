import {smoothOutline,sampleCurve,smooth} from './terrain.js';
export const landmarkDistricts=[
 {name:'Aeris Tower',subtitle:'Stark-inspired · Enter the penthouse',target:[-2090,280,-180],camera:[-2430,540,200],spawn:[-2100,418,-180],lookAt:[-2055,418,-166]},
 {name:'Headland House',subtitle:'Hilltop mansion · Walk inside',target:[-3270,115,1000],camera:[-3470,240,1220],spawn:[-3270,126,1007],lookAt:[-3240,126,1000]},
 {name:'Aircraft carrier',subtitle:'Flight deck · Offshore anchorage',target:[-440,20,1710],camera:[-730,245,2020],spawn:[-440,25,1710],lookAt:[-400,25,1540]}
];
export function addLandmarks(data){let seq=400000;const box=(name,x,y,z,w,h,d,material,extra={})=>{const b={id:`landmark-${seq++}`,name,x,y,z,w,h,d,material,solid:true,kind:'structure',...extra};data.boxes.push(b);return b;};
 const slab=(name,x,y,z,w,d,material,h=.4,extra={})=>box(name,x,y-h/2,z,w,h,d,material,{kind:'surface',...extra});
 function prism(name,x,z,bottom,top,outline,material,extra={}){const w=Math.max(...outline.map(p=>p[0]))-Math.min(...outline.map(p=>p[0])),d=Math.max(...outline.map(p=>p[1]))-Math.min(...outline.map(p=>p[1]));return box(name,x,(top+bottom)/2,z,w,top-bottom,d,material,{shape:'prism',outline,...extra});}
 const circle=(r,n=48)=>Array.from({length:n},(_,i)=>[Math.cos(i*Math.PI*2/n)*r,Math.sin(i*Math.PI*2/n)*r]);
 const wall=(name,x,y,z,w,h,d,mat='interiorWall')=>box(name,x,y+h/2,z,w,h,d,mat);
 // A complete downtown lot is reserved before placing the tower and its accessible lobby.
 data.boxes=data.boxes.filter(b=>!(b.x>-2215&&b.x<-1965&&b.z>-280&&b.z<-80));
 data.routes=data.routes.filter(r=>!(r.type==='pedestrian-service'&&r.x>-2215&&r.x<-1965&&r.z>-280&&r.z<-80));
 slab('Aeris plaza',-2090,8.28,-180,236,210,'paving');
 slab('Aeris lobby floor',-2090,8.3,-180,106,94,'stoneFloor');
 wall('Lobby west wall',-2142,8.3,-180,1.1,14,94,'facadeStone');wall('Lobby east wall',-2038,8.3,-180,1.1,14,94,'facadeStone');wall('Lobby rear wall',-2090,8.3,-134,104,14,1.1,'facadeStone');
 for(const x of [-2120,-2060])wall('Lobby entrance glazing',x,8.3,-226,44,12,.22,'clearGlass');
 wall('Lobby entry lintel',-2090,18,-226,16,4,1,'metal');slab('Lobby ceiling',-2090,23,-180,106,96,'metal',1);
 // Asymmetrical narrowing shaft, swept shoulder and an overhanging penthouse crown.
 const profiles=[{bottom:23,top:122,x:-2097,w:92,d:85},{bottom:122,top:239,x:-2090,w:79,d:74},{bottom:239,top:334,x:-2080,w:65,d:67},{bottom:334,top:403,x:-2069,w:55,d:60}];
 for(const p of profiles){const outline=[[-p.w/2,-p.d/2],[-p.w*.30-7,-p.d/2-6],[p.w/2-8,-p.d/2-6],[p.w/2,p.d*.30],[p.w/2-10,p.d/2],[-p.w/2,p.d/2]];prism('Aeris sculpted glass shaft',p.x,-180,p.bottom,p.top,outline,'facadeGlass',{building:true});
 for(const side of [-1,1])box('Aeris vertical structural rib',p.x+side*(p.w/2-2),(p.bottom+p.top)/2,-178,2,p.top-p.bottom,p.d+2,'brushedMetal');
 slab('Aeris belt truss',p.x,p.top+1,-180,p.w+3,p.d+4,'brushedMetal',2);}
 prism('Aeris angled shoulder',-2069,-180,383,411,[[-34,-38],[27,-38],[59,-17],[68,29],[-28,39]],'brushedMetal',{bottomScale:[.72,.90]});
 slab('Penthouse terrace',-2058,416,-180,124,92,'stoneFloor',2.5);
 // Guardrails keep the sky terrace walkable; the west opening connects to the helipad.
 for(const z of [-225,-135])wall('Sky terrace glass railing',-2058,416,z,124,1.35,.25,'clearGlass');wall('Sky terrace east railing',-1997,416,-180,.25,1.35,88,'clearGlass');for(const z of [-205,-155])wall('Sky terrace west railing',-2119,416,z,.25,1.35,38,'clearGlass');
 slab('Penthouse interior floor',-2068,416.12,-180,84,64,'woodFloor');
 // Actual wall segments, glass panes and door openings; no solid bounding box fills the room.
 wall('Penthouse north wall',-2068,416.12,-212,84,8,.6,'interiorWall');wall('Penthouse east glazing',-2026,416.12,-180,.2,7.8,64,'clearGlass');
 for(const x of [-2088,-2044])wall('Penthouse south glazing',x,416.12,-148,39,7.8,.22,'clearGlass');
 for(const z of [-197,-163])wall('Penthouse west glazing',-2110,416.12,z,.22,7.8,25,'clearGlass');wall('Penthouse entrance header',-2110,420,-180,.7,4,9,'interiorWall');
 // Bedroom and private study off a short corridor, both with open doorways.
 wall('Penthouse bedroom divider',-2076,416.12,-199,.5,7.8,25);for(const x of [-2098,-2080])wall('Penthouse bedroom hall wall',x,416.12,-187,13,7.8,.5);wall('Penthouse bedroom door header',-2089,419.2,-187,5,4.7,.5);
 wall('Penthouse study wall',-2046,416.12,-199,.5,7.8,25);wall('Penthouse study hall wall',-2033,416.12,-187,20,7.8,.5);
 box('Penthouse fixed kitchen counter',-2059,416.67,-207,17,1.1,1.6,'woodFloor');box('Penthouse kitchen island',-2059,416.67,-196,8,1.1,2.4,'stoneFloor');
 slab('Penthouse removable roof',-2068,425.1,-180,87,67,'interiorRoof',.9,{cutaway:true});
 // The projecting oval-like landing platform is an identifiable part of the tower silhouette.
 prism('Aeris helipad',-2150,-180,414.5,416,circle(29),'carrierDeck',{kind:'surface'});slab('Helipad access bridge',-2125,416,-180,30,10,'brushedMetal',1.5);
 for(const z of [-184.8,-175.2])wall('Helipad walkway rail',-2125,416,z,30,1.2,.3,'brushedMetal');
 for(let i=0;i<48;i++){const t=i*Math.PI/24;box('Helipad circle marking',-2150+Math.cos(t)*23,416.04,-180+Math.sin(t)*23,3,.03,.4,'paint',{rotation:-t-Math.PI/2,solid:false,kind:'surface'});}
 for(const x of [-2156,-2144])slab('Helipad H',x,416.05,-180,1.2,18,'paint',.03,{solid:false});slab('Helipad H crossbar',-2150,416.05,-180,12,1.2,'paint',.03,{solid:false});
 // A slanted architectural fin behind the top floor evokes the upward-swept crown.
 prism('Aeris crown fin',-2068,-214,424,455,[[-35,-4],[34,-4],[49,4],[-35,4]],'brushedMetal',{bottomScale:[.75,1]});
 data.portals=[{id:'aeris-up',label:'Elevator to penthouse',position:[-2090,8.3,-208],target:[-2100,416.12,-180],lookAt:[-2055,418,-166]},{id:'aeris-down',label:'Elevator to street lobby',position:[-2100,416.12,-180],target:[-2090,8.3,-208],lookAt:[-2090,10,-240]}];
 slab('Lobby lift threshold',-2090,8.34,-208,6,6,'brushedMetal');slab('Penthouse lift threshold',-2100,416.15,-180,5,5,'brushedMetal');
 // Extend the southwest headland to make a proper hilltop estate, away from the city grid.
 const west=data.islands[0];west.outline=smoothOutline([[-3060,-900],[-2820,-1350],[-2260,-1470],[-1750,-1290],[-1120,-1390],[-620,-1170],[-300,-810],[-220,-520],[-220,410],[-480,1100],[-1040,1450],[-1640,1300],[-2190,1470],[-2880,1350],[-3280,1510],[-3730,1260],[-3760,760],[-3410,530],[-3090,640],[-2960,150]]);west.estate={x:-3270,z:1000,height:116};
 const drivePoints=sampleCurve([[-2790,870],[-2870,850],[-2950,730],[-3190,660],[-3440,790],[-3460,1010],[-3370,1120],[-3270,1090]],12);let length=0;const distances=[0];for(let i=1;i<drivePoints.length;i++){length+=Math.hypot(drivePoints[i][0]-drivePoints[i-1][0],drivePoints[i][1]-drivePoints[i-1][1]);distances.push(length);}drivePoints.forEach((p,i)=>p[2]=8+116*smooth(distances[i]/length));
 const drive={id:'headland-drive',name:'Headland estate drive',type:'curved-road',classification:'country',island:0,width:9,points:drivePoints};data.curvedRoads.push(drive);data.routes.push(drive);west.roadGrid={};for(let i=1;i<drivePoints.length;i++){const a=drivePoints[i-1],b=drivePoints[i];for(let x=Math.floor((Math.min(a[0],b[0])-110)/100);x<=Math.floor((Math.max(a[0],b[0])+110)/100);x++)for(let z=Math.floor((Math.min(a[1],b[1])-110)/100);z<=Math.floor((Math.max(a[1],b[1])+110)/100);z++)(west.roadGrid[`${x},${z}`]??=[]).push([a,b,9]);}
 slab('Estate forecourt',-3270,124.28,1066,60,54,'paving');slab('Mansion entrance walk',-3270,124.3,1036,5,28,'stoneFloor');
 slab('Mansion terrace foundation',-3270,124,-2+1000,98,68,'foundation',4);slab('Mansion terrace',-3270,124.3,1000,98,68,'stoneFloor');
 slab('Mansion interior floor',-3270,124.35,1000,64,44,'woodFloor');
 wall('Mansion north wall',-3270,124.35,978,64,5.4,.6,'warmStone');wall('Mansion west wall',-3302,124.35,1000,.6,5.4,44,'warmStone');
 for(const x of [-3287,-3253])wall('Mansion front wall',x,124.35,1022,29,5.4,.45,'clearGlass');wall('Mansion entrance header',-3270,128,1022,5,1.75,.6,'warmStone');
 for(const z of [990,1018])wall('Mansion east glazing',-3238,124.35,z,.22,5.4,z===990?24:8,'clearGlass');wall('Mansion terrace door header',-3238,128,1008,.6,1.75,8,'warmStone');
 // Two bedrooms across the back, a bathroom, and an open living/kitchen room at the front.
 wall('Mansion bedroom partition',-3270,124.35,988,.5,5.4,20);for(const [x,w] of [[-3294,16],[-3274,8],[-3256,22],[-3239,2]])wall('Mansion bedroom corridor wall',x,124.35,998,w,5.4,.5);for(const x of [-3282,-3242])wall('Mansion bedroom door header',x,127.5,998,4,2.25,.5);
 wall('Mansion bathroom wall',-3290,124.35,984,.4,5.4,12);wall('Mansion bathroom front',-3297,124.35,990,10,5.4,.4);
 box('Mansion built-in kitchen',-3242,124.95,1016,2.1,1.2,8,'warmStone');box('Mansion kitchen island',-3250,124.95,1010,2.5,1.2,7,'woodFloor');
 slab('Mansion removable roof',-3270,130.6,1000,70,49,'interiorRoof',.85,{cutaway:true});slab('Mansion entrance canopy',-3270,128.8,1027,12,12,'warmStone',.4,{cutaway:true});
 for(const z of [967,1033])wall('Estate terrace balustrade',-3270,124.3,z,98,1.2,.25,'clearGlass');wall('Estate east balustrade',-3221.5,124.3,1000,.25,1.2,66,'clearGlass');
 // Leave the front circulation route open through the terrace rail.
 data.boxes=data.boxes.filter(b=>!(b.name==='Estate terrace balustrade'&&b.z===1033));for(const x of [-3296,-3244])wall('Estate front balustrade',x,124.3,1033,46,1.2,.25,'clearGlass');
 // A 360m carrier, floating offshore; no solid ocean surface is added.
 const ship={x:-440,z:1710,rotation:-.28};const local=(x,z)=>[ship.x+Math.cos(ship.rotation)*x+Math.sin(ship.rotation)*z,ship.z-Math.sin(ship.rotation)*x+Math.cos(ship.rotation)*z];
 function shipBox(name,x,y,z,w,h,d,mat,extra={}){const [wx,wz]=local(x,z);return box(name,wx,y,wz,w,h,d,mat,{rotation:ship.rotation,...extra});}
 const hull=[[-29,-162],[-15,-179],[15,-179],[29,-151],[32,146],[20,173],[-21,173],[-32,140]];
 prism('Carrier hull',ship.x,ship.z,-11,21,hull,'shipHull',{rotation:ship.rotation,bottomScale:[.68,.89]});
 const deck=[[-30,-180],[28,-180],[39,-122],[40,140],[25,180],[-36,180],[-48,125],[-48,22],[-33,-26]];
 prism('Carrier flight deck',ship.x,ship.z,21,23,deck,'carrierDeck',{rotation:ship.rotation,kind:'surface'});
 shipBox('Carrier island base',27,30,47,18,14,63,'shipHull');shipBox('Carrier island bridge',27,40,38,22,7,36,'shipHull');shipBox('Carrier navigation windows',27,40.4,18,20,3,.3,'glass',{solid:false});shipBox('Carrier mast',27,59,47,2.4,34,2.4,'brushedMetal');shipBox('Carrier radar housing',27,74,47,14,4,7,'shipHull');shipBox('Carrier funnel',26,46,65,8,17,13,'shipHull');
 for(const x of [-19,1])shipBox('Carrier catapult track',x,23.04,-80,.7,.06,155,'brushedMetal',{solid:false,kind:'surface'});
 for(let z=-10;z<160;z+=18)shipBox('Carrier runway centerline',-8+Math.sin(.14)*(z-70),23.06,z,.5,.04,9,'paint',{rotation:ship.rotation+.14,solid:false,kind:'surface'});
 for(const x of [-21,5])shipBox('Carrier runway boundary',x,23.04,70,.5,.04,180,'paint',{rotation:ship.rotation+.14,solid:false,kind:'surface'});
 for(let z=94;z<145;z+=14)shipBox('Carrier arrestor stripe',-12,23.07,z,43,.03,.26,'paint',{solid:false,kind:'surface'});
 for(const x of [-23,-17,-11,-5,1])shipBox('Carrier threshold marking',x,23.08,155,2.5,.04,15,'paint',{solid:false,kind:'surface'});
 for(const z of [-116,-49,113])shipBox('Carrier deck elevator',30,23.07,z,16,.08,23,'brushedMetal',{kind:'surface'});
 // Structural catwalks, navigation glazing, deck-edge supports, and hull openings.
 for(const x of [15.8,38.2])shipBox('Carrier navigation side glazing',x,40.4,38,.3,3,30,'glass',{solid:false});
 shipBox('Carrier port catwalk',-49,18.5,79,4,1,110,'shipHull');for(let z=32;z<129;z+=22)shipBox('Carrier catwalk support',-47,15,z,5,7,2,'shipHull');
 for(let z=-120;z<135;z+=24)shipBox('Carrier hull aperture',-31.1,14,z,.22,2.5,8,'glass',{solid:false});
 for(let z of [24,61])shipBox('Carrier island cornice',27,44,z,25,.8,2,'brushedMetal');
 for(const [x,z,w,d]of [[-9,-145,1.1,14],[-1,-145,1.1,14],[-5,-152,8,1.1],[-5,-138,8,1.1],[8,-152,8,1.1],[12,-145,1.1,14]])shipBox('Carrier deck number',x,23.07,z,w,.04,d,'paint',{solid:false,kind:'surface'});
 data.landmarks={tower:{name:'Aeris Tower',penthouseFloor:416.12,interiorBounds:[-2110,-2026,-212,-148],helipad:[-2150,416,-180]},mansion:{name:'Headland House',floor:124.35,interiorBounds:[-3302,-3238,978,1022],driveLength:length},carrier:{...ship,length:360,deckHeight:23}};
 data.rooms=[{name:'Penthouse living room',position:[-2060,416.12,-166]},{name:'Penthouse bedroom',position:[-2090,416.12,-201]},{name:'Penthouse study',position:[-2036,416.12,-201]},{name:'Mansion living room',position:[-3270,124.35,1010]},{name:'Mansion west bedroom',position:[-3280,124.35,985]},{name:'Mansion east bedroom',position:[-3255,124.35,985]}];
 data.bounds.min[0]=-3830;data.bounds.max[2]=2150;data.version=3;data.stats.spanKm=(data.bounds.max[0]-data.bounds.min[0])/1000;data.stats.buildings=data.boxes.filter(b=>(b.building&&!b.name.startsWith('Aeris'))||b.name==='Downtown building').length+2;
}
