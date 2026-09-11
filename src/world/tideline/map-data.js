import {addCampus,campusDistrict} from './campus.js';
import {addHelicarrier} from './helicarrier.js';
import {addOffice} from './office.js';
import {addResidences} from './residences.js';
import {reviseTransport} from './transport.js';
import {addLandmarks,landmarkDistricts} from './landmarks.js';
import {createMapData as createBase} from './base-map.js';
import {terrainHeight,insidePolygon,smoothOutline,sampleCurve,roadDistance} from './terrain.js';
export const GROUND=8;
export const districts=[
 {name:'Harbor City',subtitle:'Financial district · Old town · Quays',target:[-1770,110,-50],camera:[-3450,1400,2050],spawn:[-1950,10,-60]},
 {name:'Golden Strait',subtitle:'Suspension crossing · Waterfront',target:[0,35,-60],camera:[-750,590,1120],spawn:[0,40,-60]},
 {name:'Eastbank',subtitle:'Hillside neighborhoods · Town center',target:[1790,95,20],camera:[3140,870,1580],spawn:[1350,400,-50]},
 {name:'Working waterfront',subtitle:'Rail terminal · Logistics · Piers',target:[-550,15,-420],camera:[-140,700,-1430],spawn:[-680,10,-300]},
 {name:'Highlands & lake',subtitle:'Ridge roads · Country lanes · Parks',target:[2310,125,-400],camera:[3450,640,980],spawn:[2260,400,1110]},
 campusDistrict,
 ...landmarkDistricts
];
export function createMapData(){const data=createBase();const {boxes,ramps,routes,zones}=data;let seq=100000;
 const rng=(n)=>{let v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
 const box=(name,x,y,z,w,h,d,material,extra={})=>{const b={id:`v2-${seq++}`,name,x,y,z,w,h,d,material,solid:true,kind:'structure',...extra};boxes.push(b);return b;};
 const slab=(name,x,z,w,d,material,y=8.22,h=.3)=>box(name,x,y-h/2,z,w,h,d,material,{kind:'surface'});
 // Keep the city, transport structures and bridge, replace the complete east land use.
 data.boxes=boxes.filter(b=>b.x<410||['Bridge deck','Bridge walk north','Bridge walk south','Bridge lane marking','Bridge guardrail'].includes(b.name));
 boxes.length=0;boxes.push(...data.boxes);data.boxes=boxes;
 data.routes=routes.filter(r=>r.x<200||r.x1!==undefined);routes.length=0;routes.push(...data.routes);data.routes=routes;
 zones.splice(0,zones.length,...zones.filter(z=>z.x<0));
 data.islands[0].outline=smoothOutline([[-3060,-900],[-2820,-1350],[-2260,-1470],[-1750,-1290],[-1120,-1390],[-620,-1170],[-300,-810],[-220,-520],[-220,410],[-480,1100],[-1040,1450],[-1640,1300],[-2190,1470],[-2850,1210],[-3090,640],[-2960,150]]);
 const east=data.islands[1];east.hilly=true;east.outline=smoothOutline([[240,-530],[430,-850],[850,-1360],[1420,-1680],[1830,-1450],[2220,-1660],[2720,-1430],[3080,-1070],[3260,-650],[3110,-330],[3420,110],[3310,540],[3010,740],[2880,1120],[2470,1420],[2210,1290],[1800,1530],[1390,1290],[1100,1420],[750,1110],[520,760],[240,460]]);east.pond={x:2260,z:850,rx:150,rz:98,height:35};
 // Make the original downtown heterogeneous: tall glass shafts, stone towers, and retained low blocks.
 for(const b of [...boxes].filter(b=>b.name==='Downtown building')){const oldTop=b.y+b.h/2;const h=b.h*(1.55+rng(b.x+b.z)*.9);b.h=h;b.y=8+h/2;b.material=['facadeGlass','facadeStone','facadeDark','facadeBrick'][Math.floor(rng(b.x-b.z)*4)];b.facade=true;
 for(const cap of boxes.filter(c=>c.x===b.x&&c.z===b.z&&['Roof cap','Setback crown'].includes(c.name))){cap.y+=8+h-oldTop;cap.material='roof';}
 b.variant=Math.floor(rng(b.z)*4);}
 const solidBuildings=()=>boxes.filter(b=>['Downtown building','Quayside block','Station hall'].includes(b.name)||b.building);
 function cityRoad(name,x,z,w,d){slab(name+' pavement',x,z,w+10,d+10,'sidewalk',8.19);slab(name,x,z,w,d,'road',8.28);routes.push({name,type:'road',x,z,width:w,depth:d,y:8.28});const along=w>d;for(let t=-(along?w:d)/2+10;t<(along?w:d)/2-10;t+=20)box('Lane marking',x+(along?t:0),8.305,z+(along?0:t),along?8:.17,.015,along?.17:8,'paint',{solid:false,kind:'surface'});}
 const xs=[-2790,-2510,-2230,-1950,-1680,-1400],zs=[-1080,-810,-540,-300,-60,180,420,600,870,1140];
 for(const x of xs.slice(0,-1))cityRoad('West district avenue',x,30,x===-1950?32:24,2260);
 for(const z of zs)cityRoad('West district street',-2095,z,1390,z===-60?32:24);
 for(let xi=0;xi<xs.length-1;xi++)for(let zi=0;zi<zs.length-1;zi++){
 const cx=(xs[xi]+xs[xi+1])/2,cz=(zs[zi]+zs[zi+1])/2,seed=xi*83+zi*31;
 if((xi===0&&zi===7)||(xi===4&&zi===0)){slab('Civic square',cx,cz,190,160,'paving');zones.push({name:'Civic square',x:cx,z:cz,width:190,depth:160,type:'future-interactables'});continue;}
 const core=Math.exp(-(((cx+1850)/850)**2+((cz+170)/780)**2));
 for(let a=-1;a<=1;a+=2)for(let b=-1;b<=1;b+=2){const n=seed+a*7+b*17,x=cx+a*(xs[xi+1]-xs[xi])*.225,z=cz+b*(zs[zi+1]-zs[zi])*.23,w=42+rng(n)*35,d=38+rng(n+1)*32;
 let height=18+rng(n+2)*55+core*rng(n+4)**1.5*380;if(xi===3&&zi===3&&a===1&&b===-1)height=610;
 const mat=height>130?['facadeGlass','facadeDark','facadeStone'][Math.floor(rng(n+5)*3)]:['facadeBrick','facadeStone','facadeConcrete'][Math.floor(rng(n+5)*3)];
 const base=box('City expansion building',x,8+height/2,z,w,height,d,mat,{building:true,facade:true,variant:Math.floor(rng(n+6)*4)});
 box('Roof slab',x,8+height+.6,z,w+1.4,1.2,d+1.4,'roof');
 if(height>170){const crown=height*.16;box('Tower setback',x+w*.08,8+height+crown/2,z,w*.68,crown,d*.72,mat,{facade:true});box('Tower crown',x+w*.08,8+height+crown+.75,z,w*.71,1.5,d*.75,'metal');if(rng(n)>.7)box('Structural antenna',x,8+height+crown+22,z,1.1,44,1.1,'metal');}
 if(height>100){const ph=15+rng(n)*14;box('Tower podium',x,8+ph/2,z,w+12,ph,d+12,'facadeStone',{facade:true});}
 }
 slab('Service lane',cx,cz,12,zs[zi+1]-zs[zi]-26,'alley',8.27);routes.push({name:'West service lane',x:cx,z:cz,width:12,depth:zs[zi+1]-zs[zi]-26,y:8.27,type:'pedestrian-service'});
 }
 // Fill northern and southern urban waterfronts with distinct perimeter blocks.
 for(const z of [-960,925])for(let x=-1260;x<-540;x+=170){cityRoad('Waterfront access',x,z,18,210);box('Waterfront apartment',x+66,34,z,64,52,92,'facadeBrick',{facade:true,building:true});}
 cityRoad('North quay boulevard',-1020,-810,760,26);cityRoad('South quay boulevard',-960,800,900,26);
 // A connected network of curved centerlines. Every junction is a shared control point.
 data.curvedRoads=[];
 function road(name,control,width=13,type='residential'){const points=sampleCurve(control,16);const r={id:`road-${seq++}`,name,type:'curved-road',classification:type,width,points};data.curvedRoads.push(r);routes.push(r);return r;}
 const A=[1050,-60],B=[1200,-450],C=[1650,-640],D=[2100,-500],E=[2470,-230],F=[2580,140],G=[2280,450],H=[1800,540],I=[1390,400],J=[1350,-50],K=[1800,100],L=[2150,-80];
 road('Bridge boulevard',[[780,-60],[910,-60],A,J,K,L,E],22,'arterial');
 road('Town contour loop',[A,B,C,D,E,F,G,H,I,A],15,'collector');
 road('Chapel Street',[B,[1260,-260],J,[1350,190],I],12);
 road('Market Street',[C,[1730,-330],K,[1750,340],H],16,'high-street');
 road('Terrace Road',[D,[2140,-290],L,[2240,170],G],12);
 road('West terrace lane',[[1260,-260],[1470,-340],[1730,-330],[1960,-290],[2140,-290]],11);
 road('Orchard lane',[[1350,190],[1530,245],[1750,340],[2020,270],[2240,170]],11);
 road('Eastern lane',[L,[2400,10],F],12);
 road('Coast road',[A,[900,240],[1010,740],[1350,1030],[1810,1150],[2260,1110],[2670,1030],[2920,730],[3020,300],F],16,'scenic');
 road('Highland drive',[B,[1110,-810],[1410,-1200],[1860,-1250],[2290,-1180],[2700,-890],[2900,-600],[2960,-170],[3020,300]],15,'scenic');
 road('Ridgeline switchback',[C,[1760,-890],[2080,-990],[2350,-810],[2360,-610],D],12,'country');
 road('Lakeside lane',[H,[1880,730],[2030,990],[2260,1110]],11,'country');
 road('East park connector',[G,[2640,660],[2670,1030]],12,'country');
 road('Western neighborhood',[A,[750,180],[720,490],[900,650],[1010,740]],12);
 road('Harbor connection',[[2900,-600],[3120,-610]],18,'industrial');
 road('East pier approach',[[1010,740],[830,910],[780,1100]],14);
 const closest=(name,x,z)=>data.curvedRoads.find(r=>r.name===name).points.reduce((a,b)=>Math.hypot(b[0]-x,b[1]-z)<Math.hypot(a[0]-x,a[1]-z)?b:a).slice(0,2);
 for(const [name,x] of [['Ash Crescent',1485],['Laurel Street',1950],['Beech Terrace',2330]]){road(name,[closest('West terrace lane',x,-300),[x-25,-175],closest('Bridge boulevard',x,0),[x+30,155],closest('Orchard lane',x,240)],10);}
 for(const [name,z] of [['Upper village lane',-175],['Lower village lane',110]])road(name,[closest('Chapel Street',1300,z),closest('Ash Crescent',1485,z),closest('Market Street',1770,z),closest('Laurel Street',1950,z),closest('Terrace Road',2170,z)],10);
 // Split every geometric crossing into a shared junction before grading.
 const segmentBuckets=new Map(),cuts=new Map(),segments=[];for(let ri=0;ri<data.curvedRoads.length;ri++){const r=data.curvedRoads[ri];for(let i=0;i<r.points.length-1;i++){const a=r.points[i],b=r.points[i+1],seg={ri,i,a,b,id:segments.length};segments.push(seg);for(let x=Math.floor(Math.min(a[0],b[0])/100);x<=Math.floor(Math.max(a[0],b[0])/100);x++)for(let z=Math.floor(Math.min(a[1],b[1])/100);z<=Math.floor(Math.max(a[1],b[1])/100);z++){const key=`${x},${z}`;if(!segmentBuckets.has(key))segmentBuckets.set(key,[]);segmentBuckets.get(key).push(seg);}}}
 const checked=new Set();for(const list of segmentBuckets.values())for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const s=list[i],t=list[j];if(s.ri===t.ri)continue;const key=s.id<t.id?`${s.id},${t.id}`:`${t.id},${s.id}`;if(checked.has(key))continue;checked.add(key);const ax=s.b[0]-s.a[0],az=s.b[1]-s.a[1],bx=t.b[0]-t.a[0],bz=t.b[1]-t.a[1],den=ax*bz-az*bx;if(Math.abs(den)<1e-9)continue;const cx=t.a[0]-s.a[0],cz=t.a[1]-s.a[1],u=(cx*bz-cz*bx)/den,v=(cx*az-cz*ax)/den;if(u<0||u>1||v<0||v>1)continue;const p=[s.a[0]+u*ax,s.a[1]+u*az];for(const [seg,fraction]of [[s,u],[t,v]])if(fraction>1e-6&&fraction<1-1e-6){const k=`${seg.ri},${seg.i}`;if(!cuts.has(k))cuts.set(k,[]);cuts.get(k).push({fraction,p});}}
 for(let ri=0;ri<data.curvedRoads.length;ri++){const r=data.curvedRoads[ri],next=[];for(let i=0;i<r.points.length-1;i++){next.push(r.points[i]);for(const c of (cuts.get(`${ri},${i}`)??[]).sort((a,b)=>a.fraction-b.fraction))if(Math.hypot(c.p[0]-next.at(-1)[0],c.p[1]-next.at(-1)[1])>.001)next.push([...c.p]);}next.push(r.points.at(-1));r.points=next;}
 // Grade each route before creating the shared terrain and hillside foundations.
 for(const r of data.curvedRoads)for(const p of r.points)p[2]=terrainHeight(p[0],p[1],east);
 // Shared-junction elevation relaxation caps road grades at 14%, including port access.
 const nodes=new Map(),edges=[];for(const r of data.curvedRoads){let prev;for(const p of r.points){const key=`${p[0].toFixed(3)},${p[1].toFixed(3)}`;if(!nodes.has(key))nodes.set(key,{height:p[2],points:[],neighbors:new Set(),roadNames:new Set(),width:0});const node=nodes.get(key);node.points.push(p);node.roadNames.add(r.name);node.width=Math.max(node.width,r.width);if(prev){edges.push([prev.node,node,Math.hypot(p[0]-prev.p[0],p[1]-prev.p[1])*.14]);prev.node.neighbors.add(node);node.neighbors.add(prev.node);}prev={node,p};}}
 // Overlapping road shoulders are also shared-level junction surfaces.
 const nodeGrid=new Map();for(const n of nodes.values()){const p=n.points[0],gx=Math.floor(p[0]/50),gz=Math.floor(p[1]/50);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const other of nodeGrid.get(`${gx+dx},${gz+dz}`)??[]){if([...n.roadNames].some(name=>other.roadNames.has(name)))continue;const q=other.points[0];if(Math.hypot(p[0]-q[0],p[1]-q[1])<(n.width+other.width)/2+9)edges.push([n,other,0]);}const key=`${gx},${gz}`;if(!nodeGrid.has(key))nodeGrid.set(key,[]);nodeGrid.get(key).push(n);}
 const junctions=[...nodes.values()].filter(n=>n.neighbors.size>2);for(const edge of edges){if(junctions.some(j=>edge.slice(0,2).some(n=>Math.hypot(n.points[0][0]-j.points[0][0],n.points[0][1]-j.points[0][1])<20)))edge[2]=0;}
 for(let iteration=0;iteration<500;iteration++){let changed=false;for(const [a,b,max]of edges){if(a.height>b.height+max+1e-8){a.height=b.height+max;changed=true;}if(b.height>a.height+max+1e-8){b.height=a.height+max;changed=true;}}if(!changed)break;}
 for(const node of nodes.values())for(const p of node.points)p[2]=node.height;
 east.roadGrid={};for(const r of data.curvedRoads)for(let i=0;i<r.points.length-1;i++){const a=r.points[i],b=r.points[i+1],margin=r.width/2+130;for(let gx=Math.floor((Math.min(a[0],b[0])-margin)/100);gx<=Math.floor((Math.max(a[0],b[0])+margin)/100);gx++)for(let gz=Math.floor((Math.min(a[1],b[1])-margin)/100);gz<=Math.floor((Math.max(a[1],b[1])+margin)/100);gz++)(east.roadGrid[`${gx},${gz}`]??=[]).push([a,b,r.width]);}
 // Dense, physically sized housing follows the local tangent rather than a rectangular grid.
 const occupied=[];
 function canPlace(x,z,w,d,angle){const radius=Math.hypot(w,d)/2+3;if(!insidePolygon(x,z,east.outline))return false;
 if(Math.hypot((x-east.pond.x)/east.pond.rx,(z-east.pond.z)/east.pond.rz)<1.7)return false;
 if(x<840&&Math.abs(z+60)<95)return false;
 if(data.curvedRoads.some(r=>roadDistance(x,z,r)<r.width/2+radius+3))return false;
 if(occupied.some(b=>Math.hypot(x-b.x,z-b.z)<radius+b.radius+3))return false;
 for(const sx of [-1,1])for(const sz of [-1,1])if(!insidePolygon(x+sx*w/2,z+sz*d/2,east.outline))return false;
 return radius;}
 function house(x,z,w,d,angle,n,kind){const radius=canPlace(x,z,w,d,angle);if(!radius)return;
 const c=Math.cos(angle),s=Math.sin(angle);const heights=[];for(const sx of [-1,1])for(const sz of [-1,1])heights.push(terrainHeight(x+c*sx*w/2+s*sz*d/2,z-s*sx*w/2+c*sz*d/2,east));
 const floor=Math.max(...heights)+.15,min=Math.min(...heights),height=kind==='apartments'?16+rng(n)*12:kind==='shop'?9+rng(n)*6:6+rng(n)*6;
 box('Hillside foundation',x,(floor+min-1)/2,z,w,floor-min+1,d,'foundation',{rotation:angle});
 const mat=kind==='apartments'?'facadeBrick':kind==='shop'?'facadeStone':['houseBrick','houseStone','housePlaster','houseWeatherboard'][Math.floor(rng(n+10)*4)];
 box(kind==='shop'?'Eastbank shop':kind==='apartments'?'Eastbank apartments':'Eastbank house',x,floor+height/2,z,w,height,d,mat,{rotation:angle,building:true,facade:kind!=='house',floor});
 box('Residential roof',x,floor+height+2.1,z,w+1.2,4.2,d+1.2,['roofSlate','roofTile','roofMetal'][Math.floor(rng(n+11)*3)],{rotation:angle,roofShape:kind==='house'?(rng(n+9)>.45?'gable':'hip'):'flat'});
 if(kind==='house'&&rng(n)>.55)box('House chimney',x+w*.17,floor+height+4.3,z,1.3,4.7,1.8,'houseBrick',{rotation:angle});
 occupied.push({x,z,radius});data.lots.push({x,z,w:w+12,d:d+16,rotation:angle,material:['lawn','dryLawn','gravel'][Math.floor(rng(n+21)*3)]});
 // A conforming driveway, reserved for vehicles rather than populated with props.
 const nearest=data.curvedRoads.reduce((best,r)=>roadDistance(x,z,r)<roadDistance(x,z,best)?r:best,data.curvedRoads[0]);let near=nearest.points.reduce((a,b)=>Math.hypot(b[0]-x,b[1]-z)<Math.hypot(a[0]-x,a[1]-z)?b:a);const dist=Math.hypot(near[0]-x,near[1]-z);data.driveways.push({name:'Driveway',width:4,points:[[x+(near[0]-x)*(d/2+1)/dist,z+(near[1]-z)*(d/2+1)/dist],[near[0],near[1]]]});
 }
 data.driveways=[];data.lots=[];
 for(let ri=0;ri<data.curvedRoads.length;ri++){const r=data.curvedRoads[ri];if(r.classification==='industrial')continue;let travel=0;
 for(let i=1;i<r.points.length-1;i++){const p=r.points[i],last=r.points[i-1];travel+=Math.hypot(p[0]-last[0],p[1]-last[1]);const rural=r.classification==='country'||r.classification==='scenic';if(travel<(rural?52:31))continue;travel=0;
 const dx=r.points[i+1][0]-last[0],dz=r.points[i+1][1]-last[1],len=Math.hypot(dx,dz),angle=-Math.atan2(dz,dx);
 for(const side of [-1,1]){const n=ri*751+i*13+side*3,w=12+rng(n)*10,d=16+rng(n+1)*12,offset=r.width/2+Math.hypot(w,d)/2+10+rng(n+3)*5,x=p[0]-dz/len*offset*side,z=p[1]+dx/len*offset*side;
 const kind=r.classification==='high-street'?'shop':(!rural&&rng(n+4)>.79)?'apartments':'house';house(x,z,w,d,angle,n,kind);}
 }}
 // Port buildings on a level coastal apron with individual loading bays.
 for(let i=0;i<4;i++){const x=3080+(i%2)*118,z=-710+Math.floor(i/2)*174;slab('Freight apron',x,z,112,158,'paving',8.4);box('Port warehouse',x,22,z,83,28,116,'warehouse',{building:true});box('Industrial roof',x,37,z,87,2,120,'roofMetal');for(let dx of [-25,0,25])box('Loading bay',x+dx,14,z+58.2,16,11,.3,'metal',{solid:false});}
 const pierZ=1220;slab('Eastbank pier',780,pierZ,48,330,'pier',8.3,3);for(let z=1090;z<1390;z+=35)for(let x of [760,800])box('Pier pile',x,-1,z,3,17,3,'pile');slab('Eastbank finger pier',780,1350,160,22,'pier',8.3,2);
 zones.push({name:'Lake park',x:2260,z:850,width:510,depth:370,type:'future-interactables'},{name:'Highland common',x:2400,z:-1060,width:260,depth:230,type:'future-interactables'});
 for(const b of [...boxes].filter(b=>b.facade&&b.h>80))box('Roof plant enclosure',b.x+b.w*.12,b.y+b.h/2+2.5,b.z-b.d*.13,b.w*.22,5,b.d*.24,'metal');
 data.version=2;data.bounds={min:[-3200,-30,-1750],max:[3450,760,1550]};data.terrain={algorithm:'tideline-heightfield-v2',gridSpacing:24};data.spawns=districts.map(d=>({name:d.name,position:d.spawn}));data.stats={buildings:boxes.filter(b=>b.building||b.name==='Downtown building').length,residences:occupied.length,maxBuildingTop:Math.max(...boxes.map(b=>b.y+b.h/2)),spanKm:6.65};
 reviseTransport(data);addLandmarks(data);addResidences(data);addOffice(data);addHelicarrier(data);addCampus(data);data.spawns=districts.map(d=>({name:d.name,position:d.spawn}));
 return data;
}
