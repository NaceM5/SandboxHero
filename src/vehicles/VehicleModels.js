import * as THREE from 'three';

// All coordinates are in metres, with the nose facing +Z and tyres on y=0.
// Each model is merged by material before instancing, never one mesh per car.
const define = (name, w, len, wheelR, wheelbase, speed, deck, cabin, style, colors) => ({
  name, w, len, wheelR, wheelbase, speed, deck, cabin, style, colors,
  track: w / 2 - wheelR * 0.20, ride: 0,
});
export const MODELS = {
  sedan: define('Executive sedan',1.86,4.72,.35,2.78,16.5,.91,[-1.35,.92,-.79,.59,1.47],'sedan'),
  coupe: define('Sport fastback',1.94,4.55,.35,2.68,20,.80,[-1.53,.83,-.47,.44,1.30],'coupe'),
  suv: define('Luxury SUV',2.02,4.96,.42,2.92,15,1.12,[-1.91,1.02,-1.53,.58,1.83],'suv'),
  van: define('City passenger van',2.08,5.38,.40,3.20,13,1.10,[-2.25,1.75,-2.08,1.20,2.06],'van'),
  hatch: define('Urban hatchback',1.78,4.08,.33,2.46,17.5,.91,[-1.57,.94,-1.04,.51,1.49],'hatch'),
  pickup: define('Crew pickup',2.02,5.35,.43,3.16,15.5,1.13,[-.48,1.21,-.37,.72,1.82],'pickup'),
  m4: define('M4-inspired performance coupe',1.91,4.67,.36,2.81,22,.88,[-1.40,.91,-.68,.40,1.40],'m4', ['#8dabb3','#234b9b','#ecebe5','#22262b','#ac202e','#bda634']),
  cabrio: define('911-inspired cabriolet',1.89,4.52,.35,2.65,21,.86,[-1.16,.83,-.71,.43,1.31],'cabrio', ['#253aab','#deddd6','#a82031','#171d25','#35847d','#e7b33f']),
  classic: define('Thunderbird-inspired hardtop',1.88,4.62,.37,2.59,17,.94,[-1.16,.73,-.80,.40,1.47],'classic', ['#cf202d','#64c5c4','#f1dfb9','#151d23','#f0eae0','#e699ae']),
  supercar: define('F40-inspired supercar',1.98,4.43,.35,2.45,25,.71,[-1.10,.76,-.56,.18,1.15],'supercar', ['#d92128','#e7bd27','#20252b','#e9e6dc','#225a9c','#409b83']),
};

export function mergeGeos(list) {
  const positions = [], normals = [];
  for (const source of list) {
    const g = source.index ? source.toNonIndexed() : source;
    positions.push(...g.attributes.position.array);
    normals.push(...g.attributes.normal.array);
    if (g !== source) g.dispose();
    source.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals,3));
  g.computeBoundingSphere();
  return g;
}

function surface(vertices, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flat(),3));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}

export function buildModel(T) {
  const parts = { shell: [], trim: [], chrome: [], head: [], tail: [] };
  const box = (part,w,h,d,x,y,z) => {
    const g = new THREE.BoxGeometry(w,h,d); g.translate(x,y,z); parts[part].push(g); return g;
  };
  const sphere = (part,x,y,z,sx,sy,sz) => {
    const g = new THREE.SphereGeometry(1,16,10); g.scale(sx,sy,sz); g.translate(x,y,z); parts[part].push(g);
  };
  const ring = (part,r,t,x,y,z) => {
    const g = new THREE.TorusGeometry(r,t,6,24); g.translate(x,y,z); parts[part].push(g);
  };
  const L=T.len/2, W=T.w/2, D=T.deck, classic=T.style==='classic', sport=T.style==='supercar';
  // Rounded transverse sections with an actual opening above each wheel.
  // Dense longitudinal samples keep the arch cutouts smooth at close range.
  const verts=[], indices=[], count=100, ringSize=10;
  for(let i=0;i<=count;i++) {
    const z=-L+T.len*i/count, end=Math.pow(Math.abs(z/L),6);
    const width=W*(1-.12*end);
    const wheelDistance=Math.min(Math.abs(z-T.wheelbase/2),Math.abs(z+T.wheelbase/2));
    const radius=T.wheelR*1.12;
    const low=wheelDistance<radius ? Math.max(.20,T.wheelR+Math.sqrt(radius*radius-wheelDistance*wheelDistance)) : .20;
    const top=Math.max(D-.13*end,low+.065);
    const section=[[-width,low],[-width,top-.035],[-width*.87,top+.025],[-width*.59,top+.055],[0,top+.067],[width*.59,top+.055],[width*.87,top+.025],[width,top-.035],[width,low],[0,low]];
    for(const [x,y] of section) verts.push([x,y,z]);
    if(i) for(let j=0;j<ringSize;j++) {
      const a=(i-1)*ringSize+j,b=(i-1)*ringSize+(j+1)%ringSize,c=i*ringSize+j,d=i*ringSize+(j+1)%ringSize;
      indices.push(a,c,b,b,c,d);
    }
  }
  for(let j=1;j<ringSize-1;j++) { indices.push(0,j,j+1); const k=count*ringSize; indices.push(k,k+j+1,k+j); }
  parts.shell.push(surface(verts,indices));
  const [rear,front,roofRear,roofFront,height]=T.cabin;
  const base=W*.87, roof=W*(classic?.72:.70);
  // Separate glass panes inset between painted pillars and roof.
  const pane=(points)=>parts.trim.push(surface(points,[0,1,2,0,2,3]));
  const beam=(a,b,r=.035,part='shell')=>{
    const start=new THREE.Vector3(...a), end=new THREE.Vector3(...b), delta=end.clone().sub(start);
    const g=new THREE.CylinderGeometry(r,r,delta.length(),8);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
    g.translate(...start.add(end).multiplyScalar(.5).toArray());parts[part].push(g);
  };
  pane([[-base,D+.04,front],[base,D+.04,front],[roof,height+.005,roofFront],[-roof,height+.005,roofFront]]);
  for(const s of [-1,1]) beam([s*base,D,front],[s*roof,height,roofFront]);
  if(T.style!=='cabrio') {
    pane([[base,D+.04,rear],[-base,D+.04,rear],[-roof,height+.005,roofRear],[roof,height+.005,roofRear]]);
    for(const s of [-1,1]) {
      pane([[s*base,D+.045,rear],[s*base,D+.045,front],[s*roof,height+.005,roofFront],[s*roof,height+.005,roofRear]]);
      beam([s*base,D,rear],[s*roof,height,roofRear],classic?.09:.065);
      beam([s*roof,height,roofRear],[s*roof,height,roofFront],.045);
      if(!sport) beam([s*base,D+.03,-.2],[s*roof,height-.02,-.2],.035,'trim');
    }
    const roofVertices=[], roofIndices=[];
    for(let row=0;row<2;row++) for(let i=0;i<=16;i++) {
      const u=i/8-1;
      roofVertices.push([u*(roof+.035),height+.055*(1-u*u),row?roofFront+.025:roofRear-.025]);
      if(row&&i){const a=i-1,b=i,c=17+i-1,d=17+i;roofIndices.push(a,c,b,b,c,d);}
    }
    parts.shell.push(surface(roofVertices,roofIndices));
  } else {
    box('trim',T.w*.73,.08,1.62,0,D+.04,-.24);
    for(const x of [-.43,.43]) {
      box('trim',.48,.33,.40,x,D+.20,-.40);
      box('trim',.25,.22,.18,x,D+.46,-.49);
      const g=new THREE.TorusGeometry(.17,.024,6,16);g.rotateX(-.45);g.translate(x,D+.30,.37);parts.chrome.push(g);
    }
    beam([-roof,height,roofFront],[roof,height,roofFront],.045);
  }
  // Sills, door handles, mirrors, grilles and inset bumper vents.
  for(const s of [-1,1]) {
    box('trim',.07,.10,T.wheelbase*.62,s*(W-.012),.24,0);
    box(classic?'chrome':'shell',.09,.045,.23,s*(W+.004),D-.12,-.26);
    sphere('shell',s*(W+.095),D+.13,front-.16,.13,.075,.11);
    box('trim',.018,.085,.15,s*(W+.20),D+.13,front-.19);
    box('trim',.37,.16,.045,s*W*.63,.40,L-.015);
    box('chrome',.17,.12,.14,s*W*.60,.30,-L-.015);
    // Thin door shut line visible against the paint.
    box('trim',.012,D-.42,.014,s*(W+.002),(D+.32)/2,-.53);
  }
  box('trim',T.w*.48,.17,.05,0,.42,L+.015);
  box('trim',T.w*.80,.12,.06,0,.26,-L+.005);
  box('chrome',.38,.11,.035,0,.54,-L-.026);
  if(T.style==='m4') {
    for(const s of [-1,1]) {
      box('chrome',.39,.25,.055,s*.225,D-.15,L+.02);
      box('trim',.33,.20,.06,s*.225,D-.15,L+.05);
      for(let n=0;n<5;n++) box('chrome',.012,.18,.012,s*.225+(n-2)*.057,D-.15,L+.087);
      for(let n=0;n<2;n++) ring('head',.072,.012,s*(.59+n*.17),D-.10,L-.015);
    }
  } else if(classic || T.style==='cabrio') {
    for(const s of [-1,1]) {
      sphere('shell',s*W*.77,D-.005,L-.12,.23,.22,.26);
      ring('chrome',classic?.16:.14,.025,s*W*.77,D+.015,L+.155);
      sphere('head',s*W*.77,D+.015,L+.17,.135,.135,.027);
    }
  } else {
    for(const s of [-1,1]) box('head',sport?.36:.43,.085,.07,s*W*.64,D-.10,L-.065);
  }
  for(const s of [-1,1]) box('tail',.43,.095,.05,s*W*.64,D-.12,-L-.005);
  if(T.style==='cabrio') box('tail',T.w*.72,.035,.035,0,D-.035,-L-.015);
  if(classic) {
    box('chrome',T.w*.95,.12,.18,0,.36,L+.075);
    box('chrome',T.w*.90,.12,.18,0,.37,-L-.075);
    box('trim',T.w*.60,.28,.04,0,.60,L+.025);
    for(let n=-9;n<=9;n++) box('chrome',.017,.26,.025,n*.058,.60,L+.053);
    for(let n=0;n<3;n++) box('chrome',T.w*.60,.012,.025,0,.50+n*.095,L+.065);
    for(const s of [-1,1]) {
      box('shell',.095,.23,.93,s*W*.91,D+.06,-L+.48);
      // The hardtop's circular portholes sit on broad rear pillars.
      sphere('shell',s*roof,height-.15,roofRear+.09,.08,.22,.27);
      const g=new THREE.TorusGeometry(.115,.019,6,24);g.rotateY(Math.PI/2);g.translate(s*(roof+.075),height-.15,roofRear+.09);parts.chrome.push(g);
      sphere('trim',s*(roof+.08),height-.15,roofRear+.09,.012,.10,.10);
    }
  }
  if(sport) {
    for(const s of [-1,1]) {
      box('shell',.085,.48,.22,s*W*.85,D+.22,-L+.22);
      box('trim',.025,.24,.48,s*(W+.003),D-.20,-.72);
      box('trim',.27,.018,.28,s*.43,D+.057,.99);
    }
    box('shell',T.w*.97,.095,.35,0,D+.49,-L+.20);
    for(let i=0;i<9;i++) box('trim',1.10,.019,.055,0,D+.065,-1.00-i*.10);
  }
  if(T.style==='pickup') {
    box('trim',T.w*.79,.04,1.83,0,D+.07,-1.55);
    for(const s of [-1,1]) box('shell',.13,.21,1.88,s*W*.90,D+.13,-1.56);
    box('shell',T.w*.90,.20,.12,0,D+.13,-L+.12);
  }
  if(T.style==='suv'||T.style==='van') for(const s of [-1,1]) box('chrome',.06,.07,roofFront-roofRear,s*roof*.85,height+.09,(roofRear+roofFront)/2);
  return Object.fromEntries(Object.entries(parts).map(([key,list])=>[key,mergeGeos(list)]));
}

export function buildWheel() {
  const tyre=new THREE.CylinderGeometry(1,1,1,32); tyre.rotateZ(Math.PI/2);
  const metal=[], white=[];
  for(const s of [-1,1]) {
    const rim=new THREE.TorusGeometry(.73,.065,8,24);rim.rotateY(Math.PI/2);rim.translate(s*.515,0,0);metal.push(rim);
    const hub=new THREE.CylinderGeometry(.19,.19,.06,16);hub.rotateZ(Math.PI/2);hub.translate(s*.55,0,0);metal.push(hub);
    for(let i=0;i<10;i++) {
      const a=i*Math.PI/5,g=new THREE.BoxGeometry(.05,.57,.065);g.rotateX(a);g.translate(s*.54,Math.cos(a)*.43,Math.sin(a)*.43);metal.push(g);
    }
    const wall=new THREE.TorusGeometry(.87,.09,8,32);wall.rotateY(Math.PI/2);wall.translate(s*.51,0,0);white.push(wall);
  }
  return { tyre, rim:mergeGeos(metal), whitewall:mergeGeos(white) };
}
