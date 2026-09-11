import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { makePrism } from '../../../src/world/Colliders.js';

/** Standalone parked aircraft. Metres, +Y up, +Z nose, origin on ground. */
export function createAtlas42() {
  const group = new THREE.Group(); group.name = 'ATLAS_42';
  const collisionParts = [];
  const mats = {
    hull: new THREE.MeshStandardMaterial({color:0x62675f, metalness:.65, roughness:.48}),
    panel: new THREE.MeshStandardMaterial({color:0x85877a, metalness:.6, roughness:.44}),
    dark: new THREE.MeshStandardMaterial({color:0x242a29, metalness:.55, roughness:.55}),
    glass: new THREE.MeshStandardMaterial({color:0x172d36, metalness:.82, roughness:.18}),
    rubber: new THREE.MeshStandardMaterial({color:0x141819, roughness:.88}),
    steel: new THREE.MeshStandardMaterial({color:0xa9b1ad, metalness:.9, roughness:.27}),
    lamp: new THREE.MeshStandardMaterial({color:0xffe1a0,emissive:0xffbb55,emissiveIntensity:2}),
  };
  function mesh(name, geo, mat) { const m=new THREE.Mesh(geo,mats[mat]);m.name=name;m.castShadow=true;m.receiveShadow=true;group.add(m);return m; }
  function hull(name, points, mat='hull') { return mesh(name,new ConvexGeometry(points.map(p=>new THREE.Vector3(...p))),mat); }
  function box(name,p,s,mat='hull') {const m=mesh(name,new THREE.BoxGeometry(...s),mat);m.position.set(...p);return m;}
  function rod(name,a,b,r,mat='steel') { const d=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));const m=mesh(name,new THREE.CylinderGeometry(r,r,d.length(),10),mat);m.position.copy(new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return m; }
  function prism(name,outline,base,top,mat='hull',solid=true) {hull(name,outline.flatMap(([x,z])=>[[x,base,z],[x,top,z]]),mat);if(solid)collisionParts.push({name,outline,base,top});}
  // Cross-section loft makes a deep cargo belly taper into a short armored nose.
  const sections=[[-8,1.25,3.5,5.1],[-5,2.65,2.05,5.75],[0,2.9,1.9,6.15],[4,2.45,2.45,5.7],[7,1.6,2.7,4.7],[8.5,.6,3.05,3.85],[8.8,.15,3.35,3.55]];
  for(let i=0;i<sections.length-1;i++){
    const a=sections[i],b=sections[i+1];
    const ring=([z,w,lo,hi])=>[[-w*.65,lo,z],[w*.65,lo,z],[w,lo+.55,z],[w,hi-.55,z],[w*.62,hi,z],[-w*.62,hi,z],[-w,hi-.55,z],[-w,lo+.55,z]];
    hull('Fuselage_'+i,[...ring(a),...ring(b)],i%2?'hull':'panel');
    collisionParts.push({name:'Fuselage_'+i,outline:[[-a[1],a[0]-.01],[a[1],a[0]-.01],[b[1],b[0]+.01],[-b[1],b[0]+.01]],base:Math.min(a[2],b[2]),top:Math.max(a[3],b[3])});
  }
  for(const s of [-1,1]) {
    const outline=[[s*2,3],[s*11.9,-.8],[s*12.4,-4],[s*6.5,-4.7],[s*2,-3.8]];
    prism('Swept_wing_'+s,outline,4.55,4.9);
    prism('Wing_root_armor_'+s,[[s*2,3.2],[s*4.2,2.3],[s*4.1,-4.3],[s*2,-4.8]],4.9,5.22,'panel');
    // Narrow chordwise seams on each broad wing.
    for(let j=0;j<7;j++){let x=3.8+j*1.13;rod('Wing_seam_'+s+'_'+j,[s*x,4.915,2.6-(x-2)*.38],[s*x,4.915,-4.15],.018,'dark');}
    hull('Downturned_tip_'+s,[[s*11.7,4.95,-.6],[s*12.1,5.1,-3.9],[s*13.05,.7,-2.6],[s*12.55,.9,-.2],[s*12,4.85,-.6],[s*12.45,5,-3.9],[s*13.35,.7,-2.6],[s*12.85,.9,-.2]]);
    collisionParts.push({name:'Wingtip_'+s,outline:[[s*11.7,-.6],[s*12.1,-3.9],[s*13.35,-2.6],[s*12.85,-.2]],base:.7,top:5.1});
    // Raised twin engine nacelles and recessed fan faces, aft at -Z.
    const eng=mesh('Engine_shroud_'+s,new THREE.CylinderGeometry(1.35,1.12,4.8,12,1,true),'hull');eng.rotation.x=Math.PI/2;eng.position.set(s*3.35,5.6,-5.8);
    for(const z of [-8.2,-3.4]){
      const rim=mesh('Engine_lip_'+s+'_'+z,new THREE.TorusGeometry(z< -5?1.33:1.12,.13,8,24),'panel');rim.position.set(s*3.35,5.6,z);
      const fan=mesh('Engine_recess_'+s+'_'+z,new THREE.CylinderGeometry(1.12,1.12,.12,24),'dark');fan.rotation.x=Math.PI/2;fan.position.set(s*3.35,5.6,z+(z< -5?.2:-.2));
      for(let j=0;j<10;j++){const t=j*Math.PI/5;rod('Fan_blade',[s*3.35+Math.cos(t)*.28,5.6+Math.sin(t)*.28,z],[s*3.35+Math.cos(t+.28),5.6+Math.sin(t+.28),z],.055,'steel');}
    }
    collisionParts.push({name:'Engine_'+s,outline:[[s*2,-8.35],[s*4.7,-8.35],[s*4.7,-3.25],[s*2,-3.25]],base:4.2,top:7});
    hull('Canted_tail_'+s,[[s*3.5,6.2,-7.8],[s*5.15,9.6,-8.3],[s*5.5,9.6,-7.6],[s*4.25,6.2,-4.8],[s*3.7,6.2,-7.8],[s*5.35,9.6,-8.3],[s*5.7,9.6,-7.6],[s*4.45,6.2,-4.8]],'panel');
    collisionParts.push({name:'Tail_'+s,outline:[[s*3.5,-7.8],[s*5.15,-8.3],[s*5.7,-7.6],[s*4.45,-4.8]],base:6.2,top:9.6});
    // Main windshield halves and side glazing, separated by armor mullions.
    hull('Windshield_'+s,[[s*.10,5.79,3.9],[s*1.44,5.79,3.9],[s*1.02,5.03,6.3],[s*.10,5.03,6.3],[s*.10,5.76,3.9]],'glass');
    hull('Side_window_'+s,[[s*2.52,5.12,3.7],[s*2.49,4.18,3.9],[s*1.88,4.12,6.1],[s*1.88,4.48,6.1],[s*2.54,5.1,3.7]],'glass');
    rod('Cockpit_frame_'+s,[s*.10,5.04,6.3],[s*1.02,5.04,6.3],.07,'panel');
    box('Side_intake_'+s,[s*2.79,3.2,.3],[.15,.75,2.8],'dark');
    for(let j=0;j<8;j++)box('Intake_louver',[s*2.9,3.2,-.9+j*.34],[.11,.69,.06],'steel');
    box('Gear_bay_'+s,[s*2.0,2,-2.1],[1.3,.15,2.7],'dark');
    rod('Main_strut_'+s,[s*2.5,.68,-2.2],[s*2.15,2.65,-2.2],.14);
    rod('Gear_brace_'+s,[s*2.5,.8,-2.2],[s*1.9,2.4,-3.1],.085);
    for(const z of [-2.85,-1.55])for(const dx of [-.32,.32])wheel(s*2.5+dx,.62,z,.62,.4);
    collisionParts.push({name:'Main_gear_'+s,outline:[[s*1.95,-3.5],[s*3.05,-3.5],[s*3.05,-.9],[s*1.95,-.9]],base:0,top:2.5});
    const light=box('Landing_light_'+s,[s*.78,3.13,7.68],[.33,.18,.08],'lamp');
  }
  function wheel(x,y,z,r,w){const m=mesh('Tire',new THREE.CylinderGeometry(r,r,w,20),'rubber');m.rotation.z=Math.PI/2;m.position.set(x,y,z);for(const side of [-1,1]){const hub=mesh('Wheel_hub',new THREE.CylinderGeometry(r*.49,r*.49,.025,12),'steel');hub.rotation.z=Math.PI/2;hub.position.set(x+side*w*.51,y,z);}}
  rod('Nose_gear',[0,.45,6.4],[0,2.9,6],.13);for(const x of [-.24,.24])wheel(x,.43,6.4,.43,.3);
  collisionParts.push({name:'Nose_gear',outline:[[-.42,5.8],[.42,5.8],[.42,6.85],[-.42,6.85]],base:0,top:2.95});
  box('Dorsal_spine',[0,6,-1.8],[.7,.3,6],'panel');
  // Exact triangle surface for raycasts; conservative prism solids for existing gameplay.
  const raycast=(raycaster)=>raycaster.intersectObject(group,true);
  function getColliders({position=[0,0,0],yaw=0,scale=1}={}) {
    if(!(scale>0) || !Number.isFinite(scale))throw new Error('scale must be finite and positive');
    return collisionParts.map(p=>makePrism({name:'ATLAS_42/'+p.name,x:position[0],z:position[2],outline:p.outline.map(([x,z])=>[x*scale,z*scale]),base:position[1]+p.base*scale,top:position[1]+p.top*scale,rotation:yaw}));
  }
  function createCollisionDebug(){const g=new THREE.Group();g.name='ATLAS_42_COLLIDERS';for(const p of collisionParts){const geo=new ConvexGeometry(p.outline.flatMap(([x,z])=>[new THREE.Vector3(x,p.base,z),new THREE.Vector3(x,p.top,z)]));const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x3affe0,wireframe:true,transparent:true,opacity:.35}));m.name=p.name;g.add(m);}return g;}
  return {group,collisionParts,getColliders,createCollisionDebug,raycast};
}
