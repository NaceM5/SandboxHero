import {sampleCurve} from './terrain.js';
// Separate the elevated through routes from the ground-level access network.
export function reviseTransport(data){let seq=300000;const box=(name,x,y,z,w,h,d,material,extra={})=>data.boxes.push({id:`transport-${seq++}`,name,x,y,z,w,h,d,material,solid:true,kind:'surface',...extra});
 const remove=(predicate)=>{data.boxes=data.boxes.filter(b=>!predicate(b));};
 function road(name,x1,x2,z,width=24){const x=(x1+x2)/2,w=x2-x1;box(name+' sidewalk',x,8.05,z,w, .3,width+10,'sidewalk');box(name,x,8.13,z,w,.3,width,'road');data.routes.push({name,type:'road',x,z,width:w,depth:width,y:8.28});for(let xx=x1+12;xx<x2;xx+=20)box(name+' centerline',xx,8.30,z,8,.02,.16,'paint',{solid:false});}
 function curved(name,controls,width=12){const r={id:`transport-${seq++}`,name,type:'curved-road',classification:'urban-service',island:0,width,points:sampleCurve(controls,10).map(p=>[...p,8])};data.curvedRoads.push(r);data.routes.push(r);return r;}
 for(const b of data.boxes){if(b.name==='Overpass column')b.z=180+Math.sign(b.z-180)*10;if(b.name==='Northern overpass column')b.z=-300+Math.sign(b.z+300)*10;}
 data.transportChecks=[];
 for(const z of [-300,180]){
 // Remove the misleading surface-road continuation under the low approach ends.
 remove(b=>b.kind==='surface'&&Math.abs(b.z-z)<.7&&b.y<9&&b.x>-2820&&b.x<-400&&(b.name.startsWith('Harbor cross street')||b.name.startsWith('West district street')||b.name==='Lane marking'));
 data.routes=data.routes.filter(r=>!(r.type==='road'&&r.z===z&&['Harbor cross street','West district street'].includes(r.name)));
 road('Viaduct west feeder',-2790,-1500,z);road('Viaduct east feeder',-560,-420,z);
 box('Under-viaduct paved reserve',-1030,8.06,z,558,.3,26,'paving');for(const x of [-1160,-920])box('Underpass crossing pavement',x,8.13,z,24,.3,27,'road');
 for(const side of [-1,1])curved(`${z===180?'South':'North'} viaduct ${side<0?'north':'south'} service street`,[[-1600,z],[-1490,z+side*22],[-1310,z+side*22],[-1030,z+side*22],[-750,z+side*22],[-570,z+side*22],[-450,z]],8);
 for(const x of [-1400,-1160,-920,-680])data.transportChecks.push({name:`Cross avenue under ${z===180?'south':'north'} viaduct`,x,z,roadY:8.28,requiredHeight:5,halfWidth:8,axis:'z'});
 }
 // Replace the closed low-abutment avenue with a bend under the HIGH part of the bridge ramp.
 remove(b=>b.name.startsWith('Abutment avenue')||b.name==='Low clearance road closure'||(b.name==='Lane marking'&&b.x===-680&&b.z>-610&&b.z<570));
 data.routes=data.routes.filter(r=>!r.name.startsWith('Abutment avenue'));
 function avenue(z1,z2){const z=(z1+z2)/2,d=z2-z1;box('Abutment avenue sidewalk',-680,8.05,z,34,.3,d,'sidewalk');box('Abutment avenue connection',-680,8.13,z,24,.3,d,'road');data.routes.push({name:'Abutment avenue connection',type:'road',x:-680,z,width:24,depth:d,y:8.28});}
 avenue(-605,-160);avenue(60,565);
 curved('Bridge abutment bypass',[[-680,-160],[-585,-142],[-530,-106],[-520,-60],[-545,3],[-615,47],[-680,60]],18);
 data.transportChecks.push({name:'Bridge abutment bypass',x:-520,z:-60,roadY:8.34,requiredHeight:5,halfWidth:9,axis:'z'},{name:'East city avenue below bridge ramp',x:-440,z:-60,roadY:8.19,requiredHeight:5,halfWidth:8,axis:'z'});
 data.transport={notes:['Through traffic climbs the viaducts.','Ground-level service streets flank the viaducts and reconnect beyond their approaches.','Cross avenues pass under the elevated spans, with at least 5m checked vehicle headroom.','The west bridge-abutment avenue bends beneath the higher portion of the approach.']};
}
