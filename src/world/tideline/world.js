import {buildHelicarrierVisuals} from './helicarrier-visuals.js';
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {makeMaterial,materialScale} from './materials.js';
import {makeTerrain} from './terrain-mesh.js';
import {terrainHeight,sampleCurve} from './terrain.js';
export function buildWorld(data,options={}){const {collision=true,water=true}=options;const terrains=[],roadSurfaces=[];
 const group=new THREE.Group();group.name='Tideline';const buckets={},surfaces=[],obstacles=[],collisionGroup=new THREE.Group(),surfaceGrid=new Map(),obstacleGrid=new Map();collisionGroup.visible=false;collisionGroup.name='Collision debug';
 const debugMat=new THREE.MeshBasicMaterial({color:0x47ffbc,wireframe:true,transparent:true,opacity:.22,depthTest:false});const collisionMat=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 function index(item,geometry,grid){geometry.computeBoundingBox();const b=geometry.boundingBox;for(let x=Math.floor(b.min.x/100);x<=Math.floor(b.max.x/100);x++)for(let z=Math.floor(b.min.z/100);z<=Math.floor(b.max.z/100);z++){const key=`${x},${z}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(item);}}
 function prepare(g,mat){const p=g.attributes.position,n=g.attributes.normal,scale=materialScale(mat);if(!g.attributes.uv){const uv=[];for(let i=0;i<p.count;i++){const nx=Math.abs(n?.getX(i)??0),ny=Math.abs(n?.getY(i)??1),nz=Math.abs(n?.getZ(i)??0);uv.push((nx>ny&&nx>nz?p.getZ(i):p.getX(i))/scale[0],(ny>nx&&ny>nz?p.getZ(i):p.getY(i))/scale[1]);}g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));}
 if(!g.attributes.color){const c=new Float32Array(p.count*3).fill(1);g.setAttribute('color',new THREE.BufferAttribute(c,3));}return g;}
 function collider(g,name){if(!collision)return;const mesh=new THREE.Mesh(g,collisionMat);mesh.name=name;mesh.updateMatrixWorld();surfaces.push(mesh);index(mesh,g,surfaceGrid);collisionGroup.add(new THREE.Mesh(g,debugMat));}
 function add(g,mat,solid=true,b=null){prepare(g,mat);(buckets[mat]??=[]).push(g);if(solid)collider(g,b?.name??mat);if(b){obstacles.push(b);index(b,g,obstacleGrid);}}
 // Chunk exact terrain triangles for local collision queries instead of raycasting the whole island.
 for(const island of data.islands){const {geometry,wall}=makeTerrain(island,data.terrain.gridSpacing,data.curvedRoads.filter(r=>(r.island??1)===(island.hilly?1:0)));terrains.push({island,geometry});add(geometry,'terrain',false);wall.deleteAttribute('uv');add(wall,'foundation',true);
 if(!collision)continue;const g=geometry.toNonIndexed(),p=g.attributes.position,chunks={};for(let i=0;i<p.count;i+=3){const key=`${Math.floor((p.getX(i)+p.getX(i+1)+p.getX(i+2))/3/160)},${Math.floor((p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3/160)}`;const a=chunks[key]??=[];for(let j=0;j<3;j++)a.push(p.getX(i+j),p.getY(i+j),p.getZ(i+j));}
 for(const a of Object.values(chunks)){const chunk=new THREE.BufferGeometry();chunk.setAttribute('position',new THREE.Float32BufferAttribute(a,3));chunk.computeVertexNormals();collider(chunk,'Terrain');}
 }
 function boxGeometry(b){let g;if(b.shape==='prism'){const shape=new THREE.Shape(b.outline.map(([x,z])=>new THREE.Vector2(x,-z)));g=new THREE.ExtrudeGeometry(shape,{depth:b.h,bevelEnabled:false,curveSegments:32});g.rotateX(-Math.PI/2);g.translate(0,-b.h/2,0);if(b.bottomScale){const p=g.attributes.position;for(let i=0;i<p.count;i++)if(p.getY(i)<0)p.setXYZ(i,p.getX(i)*b.bottomScale[0],p.getY(i),p.getZ(i)*b.bottomScale[1]);g.computeVertexNormals();}}else if(b.roofShape&&b.roofShape!=='flat'){const w=b.w/2,h=b.h/2,d=b.d/2;const verts=[-w,-h,-d,w,-h,-d,w,-h,d,-w,-h,d];let indices;if(b.roofShape==='hip'){verts.push(0,h,0);indices=[0,1,2,0,2,3,0,3,4,3,2,4,2,1,4,1,0,4];}else{verts.push(0,h,-d,0,h,d);indices=[0,1,2,0,2,3,0,3,4,3,5,4,1,4,2,2,4,5,0,4,1,3,2,5];}g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(indices);g=g.toNonIndexed();g.computeVertexNormals();}else g=new THREE.BoxGeometry(b.w,b.h,b.d);
 g.deleteAttribute('uv');prepare(g,b.material);if(b.rotation)g.rotateY(b.rotation);g.translate(b.x,b.y,b.z);return g;}
 for(const b of data.boxes){add(boxGeometry(b),b.material,b.solid,b.solid&&(b.kind!=='surface'||b.h>1)?b:null);
 // Actual structural articulation supplements the window materials: fins, stepped crowns,
 // cornices, recessed entrances, and rooftop plant housings. No street furniture is baked in.
 if(b.facade&&b.h>80){if((b.variant??0)%2===0){for(const sx of [-1,1])for(const sz of [-1,1]){const fin={name:'Facade pier',x:b.x+sx*(b.w/2-.9),y:b.y,z:b.z+sz*(b.d/2+.12),w:1.3,h:b.h,d:.5,material:'metal'};add(boxGeometry(fin),'metal',false);}}
 for(let y=b.y-b.h/2+35;y<b.y+b.h/2;y+=45){const band={x:b.x,y,z:b.z,w:b.w+.5,h:.65,d:b.d+.5,material:'concrete'};add(boxGeometry(band),'concrete',false);}
}

 }
 for(const r of data.ramps){const len=r.x2-r.x1,g=new THREE.BoxGeometry(len,r.thickness,r.width);const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i)+r.x1+len/2;const cross=p.getZ(i)+r.z,y=p.getY(i)-r.thickness/2+r.y1+(x-r.x1)/len*(r.y2-r.y1);p.setXYZ(i,r.axis==='z'?cross:x,y,r.axis==='z'?x:cross);}if(r.axis==='z'){const idx=g.index.array;for(let i=0;i<idx.length;i+=3)[idx[i+1],idx[i+2]]=[idx[i+2],idx[i+1]];}g.computeVertexNormals();g.deleteAttribute('uv');add(g,r.material);}
 const east=data.islands[1];
 function ribbon(points,width,mat,lift=.33,offset=0,solid=true){const positions=[],uv=[];let distance=0;for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len===0)continue;const nx=-dz/len,nz=dx/len;
 const v=(p,side,idx)=>{const prev=points[Math.max(0,idx-1)],next=points[Math.min(points.length-1,idx+1)],tx=next[0]-prev[0],tz=next[1]-prev[1],tl=Math.hypot(tx,tz)||1;const x=p[0]-tz/tl*(side*width/2+offset),z=p[1]+tx/tl*(side*width/2+offset);return [x,(p[2]??terrainHeight(x,z,east))+lift,z];};
 const al=v(a,-1,i),ar=v(a,1,i),bl=v(b,-1,i+1),br=v(b,1,i+1);positions.push(...al,...ar,...bl,...ar,...br,...bl);uv.push(0,distance/12,width/12,distance/12,0,(distance+len)/12,width/12,distance/12,width/12,(distance+len)/12,0,(distance+len)/12);distance+=len;}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();if(solid)roadSurfaces.push({geometry:g,material:mat});add(g,mat,solid);}
 for(const r of data.curvedRoads){ribbon(r.points,r.width+5,'paving',.24);ribbon(r.points,r.width,'road',.34);if(r.classification!=='country'){ribbon(r.points,.12,'paint',.365,-r.width/2+.45,false);ribbon(r.points,.12,'paint',.365,r.width/2-.45,false);}for(let i=0;i<r.points.length-1;i+=2)ribbon([r.points[i],r.points[i+1]],.16,'paint',.365,0,false);}
 const lake=data.islands[1].pond;const lakePath=[];for(let i=0;i<=100;i++){const t=i*Math.PI/50;lakePath.push([lake.x+Math.cos(t)*(lake.rx+52),lake.z+Math.sin(t)*(lake.rz+45)]);}ribbon(lakePath,4,'path',.38);
 for(const lot of data.lots){if(lot.terrainOnly)continue;const c=Math.cos(lot.rotation),s=Math.sin(lot.rotation),positions=[];const vertex=(u,v)=>{const x=lot.x+c*u+s*v,z=lot.z-s*u+c*v;return [x,terrainHeight(x,z,east)+.12,z];};for(let i=0;i<3;i++)for(let j=0;j<3;j++){const u=-lot.w/2+i*lot.w/3,v=-lot.d/2+j*lot.d/3,du=lot.w/3,dv=lot.d/3;positions.push(...vertex(u,v),...vertex(u,v+dv),...vertex(u+du,v),...vertex(u+du,v),...vertex(u,v+dv),...vertex(u+du,v+dv));}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();add(g,lot.material,false);}
 for(const d of data.driveways){const points=d.graded?d.points:sampleCurve(d.points,8);ribbon(points,d.width,'paving',d.graded?0:.38,0,true);}
 // Suspension main cables and hangers remain individual visual elements, outside lanes.
 for(const z of [-87,-33])for(const [a,b,ya,yb] of [[-360,-230,47,146],[-230,270,146,146],[270,400,146,47]]){const points=[];for(let i=0;i<=48;i++){const t=i/48;points.push(new THREE.Vector3(THREE.MathUtils.lerp(a,b,t),THREE.MathUtils.lerp(ya,yb,t)-(a===-230?80*4*t*(1-t):0),z));}const tube=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),64,1.25,6,false);tube.deleteAttribute('uv');add(tube,'bridge',false);for(let x=a+18;x<b;x+=22){const t=(x-a)/(b-a),y=THREE.MathUtils.lerp(ya,yb,t)-(a===-230?80*4*t*(1-t):0),b2={x,y:(y+39)/2,z,w:.45,h:y-39,d:.45,material:'bridge'};add(boxGeometry(b2),'bridge',false);}}
 for(const [name,geometries]of Object.entries(buckets)){const geometry=mergeGeometries(geometries.map(g=>g.index?g.toNonIndexed():g));const mesh=new THREE.Mesh(geometry,makeMaterial(name));mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=!['road','paint','paving','clearGlass'].includes(name);group.add(mesh);}
 // Readable building directories and elevator labels, independent of collisions.
 for(const sign of data.signs??[]){
   const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=224;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#182a34';ctx.fillRect(0,0,1024,224);
   ctx.fillStyle='#f4ead1';ctx.font='600 58px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(sign.text,512,112,970);
   const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
   const mesh=new THREE.Mesh(new THREE.PlaneGeometry(sign.width,sign.height),new THREE.MeshBasicMaterial({map:texture}));mesh.position.fromArray(sign.position);mesh.rotation.y=sign.rotation??0;mesh.name=sign.text;group.add(mesh);
 }
 const waterMaterial=new THREE.ShaderMaterial({uniforms:{time:{value:0}},vertexShader:'varying vec3 wp; void main(){wp=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);}',fragmentShader:`uniform float time;varying vec3 wp;void main(){vec3 view=normalize(cameraPosition-wp);float fade=1./(1.+length(cameraPosition-wp)*.0015);float w=sin(wp.x*.41+wp.z*.33+time*.35)+.35*sin(wp.x*.81-wp.z*.67+time*.65);vec3 normal=normalize(vec3(w*.026*fade,1.,cos(wp.z*.57+time*.22)*.026*fade));float fresnel=pow(1.-max(dot(view,normal),0.),4.);vec3 color=mix(vec3(.016,.043,.058),vec3(.21,.28,.33),fresnel);float spec=pow(max(dot(reflect(normalize(vec3(.5,-1.,-.25)),normal),view),0.),180.);color+=spec*.22+w*.001*fade;gl_FragColor=vec4(color,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
 let waterMesh=null,pond=null;if(water){waterMesh=new THREE.Mesh(new THREE.PlaneGeometry(60000,60000),waterMaterial);waterMesh.rotation.x=-Math.PI/2;waterMesh.name='Water — non solid';group.add(waterMesh);
 pond=new THREE.Mesh(new THREE.CircleGeometry(1,80),waterMaterial);pond.rotation.x=-Math.PI/2;pond.scale.set(east.pond.rx,east.pond.rz,1);pond.position.set(east.pond.x,east.pond.height,east.pond.z);pond.name='Pond water — non solid';group.add(pond);}
 const updateHelicarrier=buildHelicarrierVisuals(data,group);
 group.add(collisionGroup);
 return {group,updateHelicarrier,water:waterMesh,pond,collisionGroup,surfaces,obstacles,terrains,roadSurfaces,surfacesAt:(x,z)=>surfaceGrid.get(`${Math.floor(x/100)},${Math.floor(z/100)}`)??[],obstaclesAt:(x,z)=>{const results=new Set();for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const b of obstacleGrid.get(`${Math.floor(x/100)+dx},${Math.floor(z/100)+dz}`)??[])results.add(b);return [...results];}};
}
