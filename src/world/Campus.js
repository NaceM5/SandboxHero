import * as THREE from 'three';
import {makeBox} from './Colliders.js';
import {makeMaterial} from './tideline/materials.js';

// Proximity doors open from either side, including for arriving vehicles.
export function updateCampus(world,dt){
 const city=world.city,campus=city.data.campus;if(!campus)return;
 if(!city.campusRuntime){
  const doors=city.data.campusDoors.map(d=>{
   const mesh=new THREE.Mesh(new THREE.BoxGeometry(d.w,d.h,d.d),makeMaterial('brushedMetal'));
   mesh.name=d.name;mesh.position.set(d.x,d.y,d.z);mesh.castShadow=true;city.group.add(mesh);
   // The opening is blocked until the panel has retracted far enough to pass.
   const collider=city.colliders.add(makeBox({...d,base:d.y-d.h/2,top:d.y+d.h/2}));
   for(let y=-d.h/2+.25;y<d.h/2;y+=.28){const rib=new THREE.Mesh(new THREE.BoxGeometry(d.w,.045,.035),makeMaterial('metal'));rib.position.set(0,y,d.d/2+.015);mesh.add(rib);}
   return {d,mesh,collider,open:0};
  });
  // Soft, irregular tree crowns replace block-shaped planting in the commons.
  const foliage=new THREE.MeshStandardMaterial({color:0x456e48,roughness:.95});
  const crownGeometry=new THREE.IcosahedronGeometry(1,2);
  for(const t of campus.trees??[])for(const [dx,dy,dz,scale] of [[0,0,0,1],[-.45,.12,.2,.75],[.4,-.05,-.25,.8]]){
   const crown=new THREE.Mesh(crownGeometry,foliage);crown.position.set(t.x+dx*t.r,campus.floors.main+t.h+dy*t.r,t.z+dz*t.r);crown.scale.set(t.r*scale,t.r*.85*scale,t.r*scale);crown.castShadow=true;crown.receiveShadow=true;city.group.add(crown);
  }
  const target=new THREE.WebGLRenderTarget(768,432);
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(12,3.4),new THREE.MeshBasicMaterial({map:target.texture,toneMapped:false}));
  screen.position.fromArray(campus.monitor);screen.name='Live battleship aerial feed';city.group.add(screen);
  // Shared legible telemetry texture across the mission consoles.
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#071a27';ctx.fillRect(0,0,512,256);
  ctx.fillStyle='#6ce0f1';ctx.font='bold 24px monospace';ctx.fillText('MERIDIAN / FLIGHT OPS',20,34);
  ctx.strokeStyle='#245164';ctx.lineWidth=1;
  for(let x=20;x<500;x+=30){ctx.beginPath();ctx.moveTo(x,55);ctx.lineTo(x,183);ctx.stroke();}
  for(let y=55;y<190;y+=25){ctx.beginPath();ctx.moveTo(20,y);ctx.lineTo(490,y);ctx.stroke();}
  ctx.strokeStyle='#61efd2';ctx.lineWidth=3;ctx.beginPath();
  for(let x=20;x<490;x+=4){const y=117+Math.sin(x*.055)*25+Math.cos(x*.13)*12;if(x===20)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
  ctx.fillStyle='#b8e7ec';ctx.font='18px monospace';ctx.fillText('LINK ACTIVE    /    TELEMETRY',20,218);ctx.fillText('TRACK 001      SIGNAL  98.4%',20,244);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const telemetry=new THREE.MeshBasicMaterial({map:texture,toneMapped:false});
  for(const b of city.data.boxes.filter(b=>b.name==='Meridian: Monitor display'&&b.y<campus.floors.main)){
   const display=new THREE.Mesh(new THREE.PlaneGeometry(b.w,b.h),telemetry);display.position.set(b.x,b.y,b.z+.02);city.group.add(display);
  }
  const ship=city.landmarks.carrier;
  const camera=new THREE.PerspectiveCamera(48,12/3.4,1,3000);
  camera.position.set(ship.x+80,ship.deckHeight+510,ship.z+160);camera.lookAt(ship.x,ship.deckHeight,ship.z);
  const lights=[];
  for(const y of Object.values(campus.floors))for(const z of [-16,10]){
   const light=new THREE.PointLight(y===campus.floors.basement?0x8edbff:0xffedda,35,48,1.1);light.position.set(campus.x,y+4,campus.z+z);city.group.add(light);lights.push(light);
  }
  city.campusRuntime={doors,target,screen,camera,lights,elapsed:1};
 }
 const state=city.campusRuntime,p=world.player.pos;
 for(const item of state.doors){const {d,mesh,collider}=item;
  const nearby=Math.abs(p.y-(d.y-d.h/2))<4&&Math.abs(p.x-d.x)<d.w/2+3&&Math.abs(p.z-d.z)<(d.w>10?24:6);
  item.open=THREE.MathUtils.damp(item.open,nearby?1:0,4,dt);
  mesh.position.x=d.x+item.open*d.travel;collider.gone=item.open>.92;
 }
 const near=Math.hypot(p.x-campus.x,p.z-campus.z)<100;
 for(const light of state.lights)light.visible=near;
 state.elapsed+=dt;
 if(!near||state.elapsed<.25)return;
 state.elapsed=0;
 const previous=world.renderer.getRenderTarget(),fog=world.scene.fog;
 const shadowUpdate=world.renderer.shadowMap.autoUpdate;
 try{
  state.screen.visible=false;world.scene.fog=null;world.renderer.shadowMap.autoUpdate=false;
  world.renderer.setRenderTarget(state.target);world.renderer.clear();world.renderer.render(world.scene,state.camera);
 }finally{
  world.renderer.setRenderTarget(previous);world.renderer.shadowMap.autoUpdate=shadowUpdate;world.scene.fog=fog;state.screen.visible=true;
 }
}
