import * as THREE from 'three';
import Delaunator from './vendor/delaunator.js';
import {insidePolygon,terrainHeight} from './terrain.js';
export function makeTerrain(island,step=24,roads=[]){const outline=island.outline,points=[],shore=[];const minX=Math.min(...outline.map(p=>p[0])),maxX=Math.max(...outline.map(p=>p[0])),minZ=Math.min(...outline.map(p=>p[1])),maxZ=Math.max(...outline.map(p=>p[1]));
 for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step);for(let j=0;j<n;j++){const p=[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n];points.push(p);shore.push(p);}}
 const pond=island.pond,insidePond=(x,z)=>pond&&((x-pond.x)/pond.rx)**2+((z-pond.z)/pond.rz)**2<1;
 if(pond)for(let i=0;i<80;i++)points.push([pond.x+Math.cos(i*Math.PI/40)*pond.rx,pond.z+Math.sin(i*Math.PI/40)*pond.rz]);
 for(const road of roads)for(let i=0;i<road.points.length;i++){const p=road.points[i],a=road.points[Math.max(0,i-1)],b=road.points[Math.min(road.points.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;for(const side of [-1,0,1]){const x=p[0]-dz/len*side*(road.width/2+2),z=p[1]+dx/len*side*(road.width/2+2);if(insidePolygon(x,z,outline)&&!insidePond(x,z))points.push([x,z]);}}
 for(let x=Math.ceil(minX/step)*step;x<maxX;x+=step)for(let z=Math.ceil(minZ/step)*step;z<maxZ;z+=step)if(insidePolygon(x,z,outline)&&!insidePond(x,z))points.push([x,z]);
 // Refine small playable lots: the city-wide 24 m grid misses door thresholds.
 for(const pad of island.residentialPads??[]){const c=Math.cos(pad.rotation),s=Math.sin(pad.rotation);for(let u=-pad.w/2-2;u<=pad.w/2+2;u+=1.5)for(let v=-pad.d/2-2;v<=pad.d/2+2;v+=1.5)points.push([pad.x+c*u+s*v,pad.z-s*u+c*v]);}
 for(const drive of island.residentialDrives??[])for(let i=1;i<drive.points.length;i++){
   const a=drive.points[i-1],b=drive.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),n=Math.ceil(len/1.5);
   for(let k=0;k<=n;k++)for(const offset of [-drive.width/2-1.5,-drive.width/2,0,drive.width/2,drive.width/2+1.5])points.push([a[0]+dx*k/n-dz/len*offset,a[1]+dz*k/n+dx/len*offset]);
 }
 // Seed exact excavation edges before triangulating; omit the room footprint.
 const holes=island.holes??[];
 for(const h of holes)for(let i=0;i<=32;i++)for(const side of [-1,1]){points.push([h.x-h.w/2+h.w*i/32,h.z+side*h.d/2]);points.push([h.x+side*h.w/2,h.z-h.d/2+h.d*i/32]);}
 const triangles=Delaunator.from(points).triangles,heights=points.map(p=>terrainHeight(...p,island));const positions=[],indices=[];
 for(let i=0;i<points.length;i++)positions.push(points[i][0],heights[i],points[i][1]);
 for(let i=0;i<triangles.length;i+=3){const a=triangles[i],b=triangles[i+1],c=triangles[i+2],x=(points[a][0]+points[b][0]+points[c][0])/3,z=(points[a][1]+points[b][1]+points[c][1])/3;if(!insidePolygon(x,z,outline)||insidePond(x,z)||holes.some(h=>Math.abs(x-h.x)<h.w/2&&Math.abs(z-h.z)<h.d/2))continue;indices.push(a,c,b);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 // Delaunay winding depends on projected axes; enforce upward-facing ground.
 if(geometry.attributes.normal.getY(indices[0])<0){for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];geometry.setIndex(indices);geometry.computeVertexNormals();}
 const uv=[],colors=[];for(let i=0;i<points.length;i++){const [x,z]=points[i],h=heights[i],steep=1-Math.abs(geometry.attributes.normal.getY(i));uv.push(x/36,z/36);const macro=.76+.08*Math.sin(x*.003+Math.sin(z*.0015))+.055*Math.cos(z*.007-x*.004)+.025*Math.sin(x*.025+z*.015);const rock=Math.min(1,steep*7),high=Math.max(0,(h-130)/220);colors.push(Math.min(1,macro+rock*.22+high*.15),Math.min(1,macro+rock*.10),Math.min(1,macro+rock*.06-high*.12));}
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 const walls=[];for(let i=0;i<shore.length;i++){const a=shore[i],b=shore[(i+1)%shore.length],ah=terrainHeight(...a,island),bh=terrainHeight(...b,island);walls.push(a[0],ah,a[1],b[0],bh,b[1],a[0],-16,a[1],b[0],bh,b[1],b[0],-16,b[1],a[0],-16,a[1]);}
 const wall=new THREE.BufferGeometry();wall.setAttribute('position',new THREE.Float32BufferAttribute(walls,3));wall.computeVertexNormals();
 return {geometry,wall};
}
