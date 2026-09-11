import assert from 'node:assert/strict';
import {createMapData} from '../src/world/tideline/map-data.js';
import {insidePolygon} from '../src/world/tideline/terrain.js';
import {makeBox,inFootprint} from '../src/world/Colliders.js';
const data=createMapData(),c=data.campus;
assert.equal(c.buildings.length,3);assert.equal(data.campusDoors.length,4);
for(const x of [-2388,-1888])for(const z of [-1890,-1490])assert(insidePolygon(x,z,data.islands[0].outline));
assert(c.lobbyHeight>9);
assert(data.boxes.filter(b=>b.name==='Meridian: Chair seat'&&b.y>c.floors.main).length>=41);
assert(data.campusDoors.some(d=>d.name==='Lobby secure entrance'));
assert(data.boxes.some(b=>b.name==='Meridian: Rear wall'&&b.material==='campusGlass'));
assert(data.islands[0].holes.some(h=>h.x===c.x&&h.z===c.z));
const lifts=data.elevators.filter(e=>e.id.startsWith('campus-'));
assert.equal(lifts.length,4);
for(const e of lifts)assert(lifts.some(r=>r.position.every((v,i)=>v===e.target[i])&&r.target.every((v,i)=>v===e.position[i])));
// Flood-fill actual solid footprints at player radius, with security doors open.
for(const floor of Object.values(c.floors)){
 const solids=data.boxes.filter(b=>b.solid&&b.y+b.h/2>floor+.3&&b.y-b.h/2<floor+1.85&&Math.abs(b.x-c.x)<100&&Math.abs(b.z-c.z)<100).map(b=>makeBox({...b,base:b.y-b.h/2,top:b.y+b.h/2}));
 const start=floor===c.floors.main?[0,30]:[floor===c.floors.upper?-24:24,23.5];
 const key=(x,z)=>`${x},${z}`,queue=[start],seen=new Set([key(...start)]);
 for(let i=0;i<queue.length;i++)for(const [dx,dz] of [[.5,0],[-.5,0],[0,.5],[0,-.5]]){
  const x=queue[i][0]+dx,z=queue[i][1]+dz,k=key(x,z);
  if(seen.has(k)||Math.abs(x)>31.5||z< -27.5||z>31)continue;
  if(solids.some(b=>inFootprint(b,c.x+x,c.z+z,.42)))continue;
  seen.add(k);queue.push([x,z]);
 }
 const targets=floor===c.floors.main?[[-24,23.5],[24,23.5],[0,-8]]:floor===c.floors.upper?[[0,0],[20,16]]:[[0,12],[0,0],[0,-6],[0,-24]];
 for(const t of targets)assert(seen.has(key(...t)),`Unreachable ${t} on floor ${floor}`);
 console.log(`Floor ${floor}: entrances, circulation and destinations reachable`);
}
for(const b of data.boxes.filter(b=>b.id.startsWith('campus-')))assert([b.x,b.y,b.z,b.w,b.h,b.d].every(Number.isFinite)&&b.w>0&&b.h>0&&b.d>0);
console.log('Campus shoreline, excavation, geometry and elevator round trips passed');
