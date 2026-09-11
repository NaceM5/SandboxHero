// Shared by rendering, terrain colliders, road grading, and building foundations.
export function insidePolygon(x,z,outline){let c=false;for(let i=0,j=outline.length-1;i<outline.length;j=i++){const a=outline[i],b=outline[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
export function segmentDistance(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);}
export function smooth(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
export function terrainHeight(x,z,island){if(!island.hilly&&!island.estate)return 8;let coast=Infinity;const o=island.outline;for(let i=0;i<o.length;i++)coast=Math.min(coast,segmentDistance(x,z,o[i],o[(i+1)%o.length]));
 const gauss=(cx,cz,sx,sz,h)=>h*Math.exp(-(((x-cx)/sx)**2+((z-cz)/sz)**2));
 let h=8+(gauss(2280,-660,780,680,240)+gauss(1560,460,480,570,140)+gauss(2900,360,400,530,125)+11*Math.sin(x*.006+z*.002)*Math.sin(z*.005))*smooth(coast/210)*smooth((x-820)/450);
 if(island.pond){const p=island.pond,r=Math.hypot((x-p.x)/p.rx,(z-p.z)/p.rz);h=(p.height+2)*(1-smooth((r-1)/1.8))+h*smooth((r-1)/1.8);}
 // A broad reclaimed apron for the eastern logistics district.
 const port=smooth((x-2890)/180)*(1-smooth((Math.abs(z+620)-190)/170));h=h*(1-port)+8*port;
 if(island.estate){const e=island.estate,dist=Math.hypot(x-e.x,z-e.z),mound=8+e.height*Math.exp(-(((x-e.x)/430)**2+((z-e.z)/400)**2))*smooth((-x-2790)/300);h=mound*(smooth((dist-100)/120))+(8+e.height)*(1-smooth((dist-100)/120));}
 if(island.roadGrid){let roadTop=-Infinity;const candidates=island.roadGrid[`${Math.floor(x/100)},${Math.floor(z/100)}`]??[];for(const [a,b,w]of candidates){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1))),dist=Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz),target=a[2]+(b[2]-a[2])*t;const rise=Math.pow(Math.max(0,dist-w/2-2),1.5)*.035;h=Math.min(h,target+rise);if(dist<w/2+2)roadTop=Math.max(roadTop,target);}if(roadTop!==-Infinity)h=roadTop;}

 // Finished residential pads and graded access lanes share the rendered heights.
 for(const p of island.residentialPads??[]){
   const c=Math.cos(p.rotation),s=Math.sin(p.rotation),dx=x-p.x,dz=z-p.z;
   const edge=Math.max(Math.abs(c*dx-s*dz)-p.w/2,Math.abs(s*dx+c*dz)-p.d/2);
   const weight=1-smooth(edge/2);h=h*(1-weight)+p.height*weight;
 }
 for(const d of island.residentialDrives??[])for(let i=1;i<d.points.length;i++){
   const a=d.points[i-1],b=d.points[i],dx=b[0]-a[0],dz=b[1]-a[1];
   const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
   const dist=Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz),weight=1-smooth((dist-d.width/2)/1.5);
   const target=a[2]+t*(b[2]-a[2])-.22;h=h*(1-weight)+target*weight;
 }
 return h;
}
export function smoothOutline(points,iterations=2){for(let k=0;k<iterations;k++){const next=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];next.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);}points=next;}return points;}
export function sampleCurve(control,spacing=18){const result=[];for(let i=0;i<control.length-1;i++){const a=control[Math.max(0,i-1)],b=control[i],c=control[i+1],d=control[Math.min(control.length-1,i+2)];const n=Math.ceil(Math.hypot(c[0]-b[0],c[1]-b[1])/spacing);for(let j=0;j<n;j++){const t=j/n,t2=t*t,t3=t2*t;result.push([0,1].map(k=>.5*((2*b[k])+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t2+(-a[k]+3*b[k]-3*c[k]+d[k])*t3)));}}result.push(control.at(-1));return result;}
export function roadDistance(x,z,road){let best=Infinity;for(let i=0;i<road.points.length-1;i++)best=Math.min(best,segmentDistance(x,z,road.points[i],road.points[i+1]));return best;}
