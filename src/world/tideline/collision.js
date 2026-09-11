import {insidePolygon,segmentDistance} from './terrain.js';
// Cylinder against axis-aligned structural boxes. Substeps prevent tunneling.
export function intersectsBody(x,feet,z,b,radius=.65,height=1.8){
 if(feet>=b.y+b.h/2-(b.kind==='surface'?.15:.03)||feet+height<=b.y-b.h/2+.03)return false;
 const angle=b.rotation??0,c=Math.cos(angle),s=Math.sin(angle),lx=c*(x-b.x)-s*(z-b.z),lz=s*(x-b.x)+c*(z-b.z);
 if(b.shape==='prism')return insidePolygon(lx,lz,b.outline)||b.outline.some((a,i)=>segmentDistance(lx,lz,a,b.outline[(i+1)%b.outline.length])<radius);
 const nx=Math.max(-b.w/2,Math.min(lx,b.w/2)),nz=Math.max(-b.d/2,Math.min(lz,b.d/2));
 return (lx-nx)**2+(lz-nz)**2<radius**2;
}
export function intersectsRamp(x,feet,z,r,radius=.65,height=1.8){
 if(x+radius<=r.x1||x-radius>=r.x2||Math.abs(z-r.z)>=r.width/2+radius)return false;
 const sx=Math.max(r.x1,Math.min(x,r.x2));
 const top=r.y1+(sx-r.x1)/(r.x2-r.x1)*(r.y2-r.y1);
 return feet<top-.15&&feet+height>top-r.thickness;
}
export function moveBody(position,dx,dz,obstacles,groundAt,ramps=[]){
 const count=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.3));let grounded=false;
 for(let i=0;i<count;i++){for(const [axis,delta] of [['x',dx/count],['z',dz/count]]){let x=position.x+(axis==='x'?delta:0),z=position.z+(axis==='z'?delta:0);const floor=groundAt(x,z,position.y+.4);const feet=floor!==null&&floor>=position.y-.5?floor:position.y;
 if(!obstacles.some(b=>intersectsBody(x,feet,z,b))&&!ramps.some(r=>intersectsRamp(x,feet,z,r))){position[axis]+=delta;if(floor!==null&&Math.abs(floor-position.y)<.5){position.y=floor;grounded=true;}}}}
 return grounded;
}
