import assert from 'node:assert/strict';
import {createMapData} from '../src/world/tideline/map-data.js';
import {makeBox,inFootprint} from '../src/world/Colliders.js';
import {elevatorAt,useElevator} from '../src/world/Elevators.js';
const data=createMapData();
assert.equal(data.offices.length,2);assert(data.elevators.length>=4);
for(const o of data.offices){
for(const [floor,start,targets] of [[o.lobbyFloor,o.entrance,[o.lift]],[o.officeFloor,o.upper,[o.meeting,o.workstations,o.breakArea]]]){
 const solid=data.boxes.filter(b=>b.solid&&b.y+b.h/2>floor+.25&&b.y-b.h/2<floor+1.88&&Math.hypot(b.x-o.x,b.z-o.z)<100).map(b=>makeBox({x:b.x,z:b.z,w:b.w,d:b.d,rotation:b.rotation,base:b.y-b.h/2,top:b.y+b.h/2}));
 const step=.25,key=(u,v)=>`${u},${v}`,local=p=>[Math.round((p[0]-o.x)*o.direction/step),Math.round((p[2]-o.z)*o.direction/step)];
 const queue=[local(start)],seen=new Set([key(...queue[0])]);
 for(let i=0;i<queue.length;i++)for(const [du,dv]of [[1,0],[-1,0],[0,1],[0,-1]]){const u=queue[i][0]+du,v=queue[i][1]+dv,k=key(u,v);if(seen.has(k)||Math.abs(u*step)>o.w/2-.3||v*step < -o.d/2+.3||v*step>o.d/2+3)continue;
 if(solid.some(b=>inFootprint(b,o.x+o.direction*u*step,o.z+o.direction*v*step,.42)))continue;seen.add(k);queue.push([u,v]);}
 for(const target of targets)assert(seen.has(key(...local(target))),`Blocked route on floor ${floor} to ${target}`);
 console.log(`Floor ${floor}: all destinations reachable through actual doorways`);
}
const vec=()=>({x:0,y:0,z:0,fromArray(a){[this.x,this.y,this.z]=a;return this;},set(x,y,z){Object.assign(this,{x,y,z});},copy(p){Object.assign(this,{x:p.x,y:p.y,z:p.z});}});
const p={pos:vec().fromArray(o.lift),vel:vec(),holder:{position:vec()},grounded:true},world={player:p,city:{data},cameraRig:{},notify(){}};
assert.equal(elevatorAt(data.elevators,p).id,`${o.id}-up`);assert(useElevator(world));assert.equal(p.pos.y,o.officeFloor);assert.equal(elevatorAt(data.elevators,p).id,`${o.id}-down`);assert(useElevator(world));assert.equal(p.pos.y,o.lobbyFloor);
p.pos.z+=5;assert.equal(useElevator(world),false);p.pos.fromArray(o.lift);p.vehicle={};assert.equal(useElevator(world),false);p.vehicle=null;p.downed=true;assert.equal(useElevator(world),false);
console.log('Elevator round trip and interaction boundaries passed');

}
