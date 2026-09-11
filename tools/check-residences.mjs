import assert from 'node:assert/strict';
import {createMapData} from '../src/world/tideline/map-data.js';
import {terrainHeight} from '../src/world/tideline/terrain.js';
import {makeBox,inFootprint} from '../src/world/Colliders.js';
const data=createMapData();assert.equal(data.residences.length,3);
for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert(Math.hypot(data.residences[i].x-data.residences[j].x,data.residences[i].z-data.residences[j].z)>500,'homes must occupy distinct neighborhoods');
for(const home of data.residences){
 const boxes=data.boxes.filter(b=>b.residenceId===home.id);
 assert(!data.boxes.some(b=>b.name==='Eastbank house'&&Math.hypot(b.x-home.x,b.z-home.z)<1));
 const solids=boxes.filter(b=>b.solid&&b.y+b.h/2>home.floor+.25&&b.y-b.h/2<home.floor+1.88).map(b=>makeBox({x:b.x,z:b.z,w:b.w,d:b.d,rotation:b.rotation,base:b.y-b.h/2,top:b.y+b.h/2}));
 const c=Math.cos(home.rotation),s=Math.sin(home.rotation),world=(u,v)=>[home.x+c*u+s*v,home.z-s*u+c*v];
 const local=p=>[c*(p[0]-home.x)-s*(p[2]-home.z),s*(p[0]-home.x)+c*(p[2]-home.z)];
 const step=.2,start=local(home.entrance).map(v=>Math.round(v/step));
 const key=(x,z)=>`${x},${z}`,seen=new Set([key(...start)]),queue=[start];
 for(let i=0;i<queue.length;i++)for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
  const x=queue[i][0]+dx,z=queue[i][1]+dz,k=key(x,z);if(seen.has(k)||Math.abs(x*step)>home.w/2-.35||z*step < -home.d/2+.35||z*step>home.d/2+2.1)continue;
  const p=world(x*step,z*step);if(solids.some(b=>inFootprint(b,...p,.42)))continue;seen.add(k);queue.push([x,z]);
 }
 for(const room of home.rooms){const p=local(room.position).map(v=>Math.round(v/step));assert(seen.has(key(...p)),`${home.name}: cannot walk to ${room.name}`);}
 const [a,b]=home.driveway.points, length=Math.hypot(b[0]-a[0],b[1]-a[1]);assert(Math.abs(a[2]-b[2])/length<.14,'driveway grade');
 assert.equal(a[2],home.floor);assert(home.driveway.width>=5);
 for(let i=0;i<=30;i++){const t=i/30,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,y=a[2]+(b[2]-a[2])*t;assert(terrainHeight(x,z,data.islands[1])<y,'terrain intersects driveway');}
 for(let u=-home.w/2+.5;u<home.w/2;u+=1)for(let v=-home.d/2+.5;v<home.d/2;v+=1){const p=world(u,v);assert(terrainHeight(...p,data.islands[1])<home.floor,'terrain intersects floor');}
 console.log(`${home.name}: all five rooms reachable; floor and driveway clear; grade ${(100*Math.abs(a[2]-b[2])/length).toFixed(1)}%`);
}
