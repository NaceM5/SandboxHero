import * as THREE from 'three';
import { MODELS, buildModel, buildWheel } from './VehicleModels.js';

export const VEHICLE_TYPES = Object.keys(MODELS);
const CAR_COLORS = ['#c9ced6','#2c3138','#8d2027','#1f3d70','#5c6570','#0f1216','#2f5d4a','#d8d3c8','#1b6b74','#e0a92c'];
export const randomCarColor = type => {
  const colors = MODELS[type]?.colors || CAR_COLORS;
  return colors[Math.floor(Math.random()*colors.length)];
};

export class VehicleFactory {
  constructor(scene,maxPerType=40) {
    this.scene=scene; this.pools={};
    this.zero=new THREE.Matrix4().makeScale(0,0,0);
    const materials={
      shell:new THREE.MeshStandardMaterial({color:0xffffff,roughness:.26,metalness:.65,side:THREE.DoubleSide}),
      trim:new THREE.MeshStandardMaterial({color:0x14212a,roughness:.24,metalness:.35,side:THREE.DoubleSide}),
      chrome:new THREE.MeshStandardMaterial({color:0xc1ccd5,roughness:.19,metalness:.85}),
      head:new THREE.MeshStandardMaterial({color:0xf4f5e9,emissive:0xfff3db,emissiveIntensity:.4}),
      tail:new THREE.MeshStandardMaterial({color:0xbc1524,emissive:0xff1830,emissiveIntensity:.9}),
    };
    // Per-car lamp intensity keeps brake lights responsive within shared batches.
    for(const key of ['head','tail']) materials[key].onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;',
        'vec3 totalEmissiveRadiance = emissive * vColor.r;');
    };
    this.lampColor=new THREE.Color();
    this.headMat=materials.head;this.tailMat=materials.tail;
    const instance=(geometry,material,max)=>{
      const mesh=new THREE.InstancedMesh(geometry,material,max);
      mesh.frustumCulled=false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for(let i=0;i<max;i++) mesh.setMatrixAt(i,this.zero);
      scene.add(mesh);return mesh;
    };
    for(const type of VEHICLE_TYPES) {
      const T=MODELS[type], geometry=buildModel(T),p={T,count:0,max:maxPerType};
      for(const key of Object.keys(materials)) p[key]=instance(geometry[key],materials[key],maxPerType);
      for(const key of ['head','tail']) p[key].setColorAt(0,new THREE.Color(1,1,1));
      p.shell.castShadow=true;p.shell.receiveShadow=true;
      p.shell.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(maxPerType*3).fill(1),3);
      this.pools[type]=p;
    }
    const wheel=buildWheel(), max=maxPerType*VEHICLE_TYPES.length*4;
    this.wheels=instance(wheel.tyre,new THREE.MeshStandardMaterial({color:0x151719,roughness:.92}),max);
    this.rims=instance(wheel.rim,materials.chrome,max);
    this.whitewalls=instance(wheel.whitewall,new THREE.MeshStandardMaterial({color:0xeee8d8,roughness:.75}),max);
    this.wheels.castShadow=true;this.wheelCount=0;
  }
  alloc(type) {const p=this.pools[type];return !p||p.count>=p.max ? -1 : p.count++;}
  setColor(type,idx,color) {
    // THREE.Color already converts CSS sRGB input to linear working space.
    this.pools[type].shell.setColorAt(idx,new THREE.Color(color));
    this.pools[type].shell.instanceColor.needsUpdate=true;
  }
  beginFrame(){this.wheelCount=0;}
  writeVehicle(v,m4) {
    const p=this.pools[v.type];
    for(const key of ['shell','trim','chrome','head','tail']) p[key].setMatrixAt(v.idx,m4);
    const head=v.headlights?1:.18, tail=v.braking?1:(v.headlights?.45:.15);
    p.head.setColorAt(v.idx,this.lampColor.setRGB(head,head,head));
    p.tail.setColorAt(v.idx,this.lampColor.setRGB(tail,tail,tail));
    p.head.instanceColor.needsUpdate=true;p.tail.instanceColor.needsUpdate=true;
  }
  writeWheel(m4,type) {
    if(this.wheelCount>=this.wheels.instanceMatrix.count)return;
    const i=this.wheelCount++;
    this.wheels.setMatrixAt(i,m4);this.rims.setMatrixAt(i,m4);
    this.whitewalls.setMatrixAt(i,type==='classic'?m4:this.zero);
  }
  endFrame() {
    for(const p of Object.values(this.pools)) for(const key of ['shell','trim','chrome','head','tail']) {
      p[key].count=p.count;p[key].instanceMatrix.needsUpdate=true;
    }
    for(const mesh of [this.wheels,this.rims,this.whitewalls]) {
      mesh.count=this.wheelCount;mesh.instanceMatrix.needsUpdate=true;
    }
  }
  typeInfo(type){return MODELS[type];}
  setNight(n){this.headMat.emissiveIntensity=.4+n*3;this.tailMat.emissiveIntensity=.9+n*1.6;}
}
