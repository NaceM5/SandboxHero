import * as THREE from 'three';
import {makeMaterial} from './materials.js';

export function buildHelicarrierVisuals(data,group) {
  if(!data.helicarrier)return ()=>{};
  const h=data.helicarrier,rotors=[];
  const metal=makeMaterial('hqHull').clone(),bladeMat=makeMaterial('brushedMetal').clone(),wellMat=makeMaterial('slate').clone(),glow=makeMaterial('hqCyan');
  for(const mat of [metal,bladeMat,wellMat])mat.vertexColors=false;
  for(const [i,[x,z]]of h.rotors.entries()){
    const center=new THREE.Vector3(h.x+x,h.deck-1,h.z+z);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(27,2.5,10,64),metal);ring.rotation.x=Math.PI/2;ring.position.copy(center);ring.castShadow=true;group.add(ring);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(28.5,.20,6,64),glow);rim.rotation.x=Math.PI/2;rim.position.copy(center).add(new THREE.Vector3(0,1.6,0));group.add(rim);
    const well=new THREE.Mesh(new THREE.CylinderGeometry(26,22,5,48),wellMat);well.position.copy(center).add(new THREE.Vector3(0,-4,0));group.add(well);
    const rotor=new THREE.Group();rotor.position.copy(center);group.add(rotor);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(3,5,3,24),bladeMat);rotor.add(hub);
    for(let n=0;n<12;n++){
      const blade=new THREE.Mesh(new THREE.BoxGeometry(3.0,.35,21),bladeMat);const a=n*Math.PI/6;
      blade.position.set(Math.sin(a)*14,-.4,Math.cos(a)*14);blade.rotation.set(.10,a,.08);rotor.add(blade);
    }
    rotors.push({rotor,speed:(i%2?1:-1)*1.7});
  }
  // Soft local fill gives the HQ readable rooms at night, without shadow maps.
  for(const [x,z]of [[0,-76],[-23,-12],[23,-12],[0,60]]){
    const light=new THREE.PointLight(0x86dbff,32,65,1.2);light.position.set(h.x+x,h.floor+10,h.z+z);group.add(light);
  }
  return dt=>{for(const r of rotors)r.rotor.rotation.y+=dt*r.speed;};
}
