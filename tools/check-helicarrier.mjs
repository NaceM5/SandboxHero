import assert from 'node:assert/strict';
import {createMapData} from '../src/world/tideline/map-data.js';
import {makeBox,makePrism,makeRamp,topAt,inFootprint} from '../src/world/Colliders.js';
import {elevatorAt,useElevator} from '../src/world/Elevators.js';
const data=createMapData(),h=data.helicarrier;assert(h.deck>850);assert.equal(h.rotors.length,4);assert(data.bounds.max[1]>h.deck);
const solids=data.boxes.filter(b=>b.helicarrier&&b.solid&&b.y+b.h/2>h.floor+.25&&b.y-b.h/2<h.floor+1.88).map(b=>(b.shape==='prism'?makePrism:makeBox)({x:b.x,z:b.z,w:b.w,d:b.d,outline:b.outline,rotation:b.rotation,base:b.y-b.h/2,top:b.y+b.h/2}));
const step=.5,key=(x,z)=>`${x},${z}`,local=p=>[Math.round((p[0]-h.x)/step),Math.round((p[2]-h.z)/step)],queue=[local(h.entry)],seen=new Set([key(...queue[0])]);
for(let i=0;i<queue.length;i++)for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=queue[i][0]+dx,z=queue[i][1]+dz,k=key(x,z);if(seen.has(k)||Math.abs(x*step)>37||z*step < -112||z*step>140)continue;if(solids.some(b=>inFootprint(b,h.x+x*step,h.z+z*step,.42)))continue;seen.add(k);queue.push([x,z]);}
for(const r of [...h.rooms,{name:'Deck lift',position:h.lower}])assert(seen.has(key(...local(r.position))),`Cannot reach ${r.name}`);
const vec=()=>({x:0,y:0,z:0,fromArray(a){[this.x,this.y,this.z]=a;return this;},set(x,y,z){Object.assign(this,{x,y,z});},copy(p){Object.assign(this,{x:p.x,y:p.y,z:p.z});}});
const p={pos:vec().fromArray(h.upper),vel:vec(),holder:{position:vec()}},world={player:p,city:{data},cameraRig:{},notify(){}};
assert.equal(elevatorAt(data.elevators,p).id,'aegis-down');assert(useElevator(world));assert.equal(p.pos.y,h.floor);assert.equal(elevatorAt(data.elevators,p).id,'aegis-up');assert(useElevator(world));assert.equal(p.pos.y,h.upperDeck);
console.log('Aegis: all five HQ rooms and lift reachable from fly-in balcony; deck lift round trip passed; altitude and bounds valid');

const ramp=makeRamp(data.ramps.find(r=>r.id==='aegis-deck-ramp'));
assert.equal(topAt(ramp,h.x,h.z-20),h.deck);assert.equal(topAt(ramp,h.x,h.z+50),h.upperDeck);
for(let i=1;i<70;i++){const z=h.z-20+i,y=topAt(ramp,h.x,z);assert(inFootprint(ramp,h.x,z));for(const b of data.boxes.filter(b=>b.helicarrier&&b.solid&&b.y-b.h/2<y+1.88&&b.y+b.h/2>y+.25)){const c=(b.shape==='prism'?makePrism:makeBox)({x:b.x,z:b.z,w:b.w,d:b.d,outline:b.outline,base:b.y-b.h/2,top:b.y+b.h/2});assert(!inFootprint(c,h.x,z,.42),'connecting ramp obstructed');}}
console.log('Both deck elevations and the unobstructed connecting ramp passed');

assert(!data.boxes.some(b=>b.helicarrier&&/Interceptor/.test(b.name)));
