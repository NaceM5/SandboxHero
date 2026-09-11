// Harbor Island's reclaimed northern campus. All room shells are hollow solids.
export const campusDistrict={name:'Meridian Campus',subtitle:'Offices · Secure mission control',target:[-2140,15,-1700],camera:[-2480,320,-1260],spawn:[-1950,8.28,-1455]};
export function addCampus(data){
 const island=data.islands[0];
 island.outline=island.outline.map(([x,z])=>[x,z-(z < -1100 ? 700*Math.min(1,(-z-1100)/180)*Math.max(0,1-Math.max(0,Math.abs(x+2140)-450)/450):0)]);
 const X=-2180,Z=-1780,F=8.28,U=18.28,B=2.28;
 let seq=0;
 const box=(name,x,y,z,w,h,d,material='warmStone',extra={})=>{const b={id:`campus-${seq++}`,name:`Meridian: ${name}`,x,y,z,w,h,d,material,solid:true,kind:'structure',...extra};data.boxes.push(b);return b;};
 const slab=(name,x,z,w,d,y=F,mat='paving')=>box(name,x,y-.12,z,w,.24,d,mat,{kind:'surface'});
 const sign=(text,x,y,z,width=8)=>{(data.signs??=[]).push({text,position:[x,y,z],width,height:width*.2});};
 const local=(name,x,y,z,w,h,d,mat,extra)=>box(name,X+x,y,Z+z,w,h,d,mat,extra);
 const roomHeight=f=>f===F?9.76:5.76;
 const wall=(name,x,z,w,d,f,mat='interiorWall')=>local(name,x,f+roomHeight(f)/2,z,w,roomHeight(f),d,mat);
 const doors=data.campusDoors=[];
 const door=(name,x,y,z,w,h,travel)=>doors.push({name,x,y,z,w,h,d:.24,travel});
 // Connect to the existing north/south city avenue; the gate is on its centerline.
 slab('Access road',-1950,-1300,18,480,F+.06,'road');
 data.routes.push({name:'Meridian access road',type:'road',x:-1950,z:-1300,width:18,depth:480,y:F+.06});
 for(let z=-1110;z>-1520;z-=20)box('Road center line',-1950,F+.08,z,.15,.02,8,'paint',{solid:false});
 // Courtyard paving is split around the underground footprint so it cannot seal the basement.
 slab('East court',-2018,-1690,260,400,F,'grass');slab('West garden walk',-2300,-1690,176,400,F,'grass');
 slab('North court',X,-1852,64,84,F,'grass');slab('South court',X,-1621,64,262,F,'grass');
 slab('Parking asphalt',-2010,-1600,186,140,F+.10,'road');
 for(const z of [-1550,-1600,-1650])for(let x=-2080;x<=-1940;x+=10){
  box('Parking bay stripe',x,F+.13,z,.13,.02,18,'paint',{solid:false});
  box('Wheel stop',x+5,F+.15,z-7,5,.25,.35,'concrete');
 }
 // The bays are filled by the game's own traffic system (real cars, parked
 // nose to the wheel stop) — see Traffic.parkAt and main._parkCampusCars.
 const bays=[];
 for(const z of [-1550,-1600,-1650])for(let x=-2080;x<-1940;x+=10)bays.push({x:x+5,z:z-4.6,heading:Math.PI,y:F+.10});
 for(const [x,z,w,d] of [[-2388,-1690,.3,400],[-1888,-1690,.3,400],[-2138,-1890,500,.3],[-2175,-1490,426,.3],[-1913,-1490,50,.3]]){
  box('Perimeter plinth',x,F+.3,z,w,.6,d,'concrete');
  box('Perimeter glass fence',x,F+1.7,z,w,2.4,d,'clearGlass');
  const n=Math.ceil(Math.max(w,d)/8);for(let i=0;i<=n;i++)box('Fence post',x+(w>d?(i/n-.5)*w:0),F+1.7,z+(d>w?(i/n-.5)*d:0),.18,3.4,.18,'metal');
  box('Fence top rail',x,F+3.3,z,Math.max(w,.15),.12,Math.max(d,.15),'metal');
 }
 door('Campus security gate',-1950,F+1.4,-1490,24,2.8,25);
 box('Security booth',-1975,F+1.5,-1479,7,3,7,'facadeGlass');box('Security canopy',-1960,F+4,-1484,42,.35,12,'metal');
 sign('MERIDIAN  /  SECURITY',-1960,F+3.2,-1477,15);
 sign('AUTOMATIC GATE · APPROACH TO ENTER',-1950,F+4.7,-1489,12);
 // Two companion modern office buildings with stepped glazed volumes.
 const buildings=[{name:'01 · Meridian Research',x:X,z:Z,w:64,d:56,interior:true}];
 for(const [name,x,z,w,d,h] of [['02 · Design Studio',-2300,-1630,70,64,23],['03 · Engineering',-2015,-1780,104,66,35]]){
  buildings.push({name,x,z,w,d,interior:false});
  box(name,x,F+h/2,z,w,h,d,'campusGlass',{building:true});
  for(let y=F;y<=F+h;y+=5.5)box('White facade ribbon',x,y,z,w+1,.24,d+1,'warmStone');
  for(let y=F+2.75;y<F+h;y+=5.5)box('Glazing transom',x,y,z,w+.12,.09,d+.12,'metal');
  box('Setback roof pavilion',x+8,F+h+3,z-5,w*.64,6,d*.65,'facadeDark',{building:true});
  for(let dx=-w/2;dx<=w/2;dx+=4)for(const side of [-1,1])box('Facade fin',x+dx,F+h/2,z+side*(d/2+.2),.14,h,.5,'brushedMetal');
  for(let dz=-d/2;dz<=d/2;dz+=4)for(const side of [-1,1])box('Side mullion',x+side*(w/2+.12),F+h/2,z+dz,.25,h,.14,'brushedMetal');
  box('Entry canopy',x,F+3.8,z+d/2+3,15,.3,7,'metal');sign(name.toUpperCase(),x,F+4.8,z+d/2+.7,20);
 }
 // Excavation matches the exterior shell, leaving a genuinely below-ground room.
 island.holes=[...(island.holes??[]),{x:X,z:Z,w:64,d:56}];
 for(const [f,label] of [[B,'B1'],[F,'G'],[U,'01']]){
  slab(`${label} floor`,X,Z,64,56,f,f===B?'slate':f===F?'stoneFloor':'woodFloor');
  slab(`${label} ceiling`,X,Z,64,56,f+roomHeight(f),'interiorRoof');
  wall('Rear wall',0,-28,64,.4,f,f===B?'concrete':'campusGlass');
  for(const x of [-32,32])wall('Side wall',x,0,.4,56,f,f===B?'concrete':'campusGlass');
  if(f===F){wall('Front glass',-18,28,28,.3,f,'campusGlass');wall('Front glass',18,28,28,.3,f,'campusGlass');local('Entrance header',0,f+6.88,28,8,5.76,.4,'campusGlass');}
  else wall('Front wall',0,28,64,.4,f,f===B?'concrete':'campusGlass');
  for(const x of [-31, -16,0,16,31])for(const z of [-28,28])if(!(f===F&&x===0&&z===28))local('Facade column',x,f+roomHeight(f)/2,z,.3,roomHeight(f),.5,'warmStone');
  for(const x of [-22,-7,7,22])for(const z of [-19,0,19])local('Linear ceiling light',x,f+roomHeight(f)-.16,z,6,.06,.25,f===B?'hqCyan':'homeLight',{solid:false});
  // Two lifts, each with a separate, unambiguous destination on the ground floor.
  for(const x of [-24,24]){
   wall('Lift back',x,26,5,.25,f,'brushedMetal');wall('Lift side',x-2.5,23.5,.2,5,f,'brushedMetal');wall('Lift side',x+2.5,23.5,.2,5,f,'brushedMetal');
   local('Lift header',x,f+4.5,21,5,2.5,.3,'metal');sign(`${label}  /  ELEVATOR`,X+x,f+4.6,Z+20.8,4);
  }
 }
 // Match the companion buildings' dark curtain wall, fine mullions and stepped roof.
 for(let y=F+2.5;y<U+6;y+=2.5){
  for(const z of [-28.22,28.22]){if(z>0&&y<F+4){for(const x of [-18,18])local('Research glazing transom',x,y,z,28,.09,.12,'metal');}else local('Research glazing transom',0,y,z,64,.09,.12,'metal');}
  for(const x of [-32.22,32.22])local('Research side transom',x,y,0,.12,.09,56,'metal');
 }
 for(let x=-32;x<=32;x+=4)for(const z of [-28.22,28.22])if(!(z>0&&Math.abs(x)<4))local('Research mullion',x,F+8,z,.14,16,.35,'brushedMetal');
 for(let z=-28;z<=28;z+=4)for(const x of [-32.22,32.22])local('Research side mullion',x,F+8,z,.35,16,.14,'brushedMetal');
 slab('Research roof finish',X,Z,64,56,U+6.15,'roof');
 local('Research roof pavilion',5,U+9,-4,42,6,35,'facadeDark',{building:true});
 local('Research pavilion crown',5,U+12.15,-4,43,.3,36,'brushedMetal');
 door('Lobby secure entrance',X,F+2,Z+28,8,4,8.5);
 local('Lobby access reader',4.4,F+1.4,28.4,.3,.6,.15,'hqCyan',{solid:false});
 sign('SECURE ENTRY / MERIDIAN',X,F+5,Z+28.5,12);
 for(const f of [F,U,U+6])local('Floating facade band',0,f,0,65,.3,57,'warmStone');
 local('Entrance canopy',0,F+4,31,14,.25,7,'brushedMetal');sign('01 / MERIDIAN RESEARCH',X,F+8.3,Z+28.4,19);
 const desk=(x,f,z,control=false)=>{
  local('Desk',x,f+.78,z,3,.14,1.4,control?'brushedMetal':'woodFloor');
  for(const dx of [-1.3,1.3])local('Desk leg',x+dx,f+.38,z,.12,.76,1.1,'metal');
  local('Monitor frame',x,f+1.35,z-.4,1.3,.75,.12,'slate');local('Monitor display',x,f+1.35,z-.325,1.13,.59,.02,control?'hqCyan':'homeBlue',{solid:false});
  local('Keyboard',x,f+.88,z+.3,.9,.04,.3,'slate');
  local('Chair seat',x,f+.5,z+1.5,.8,.14,.8,'homeBlue');local('Chair back',x,f+1,z+1.85,.8,1,.15,'homeBlue');local('Chair base',x,f+.25,z+1.5,.15,.5,.15,'metal');
 };
 local('Reception',-10,F+.65,11,9,1.3,2,'woodFloor');local('Reception stone counter',-10,F+1.34,11,9.2,.12,2.2,'warmStone');sign('WELCOME / MERIDIAN',X-10,F+5.4,Z+8,9);
 for(const z of [3,9,15]){local('Lobby sofa',13,F+.5,z,5,.7,1.6,'homeSage');local('Sofa back',13,F+1,z-.7,5,1.2,.2,'homeSage');}
 local('Coffee table',13,F+.4,6,3,.8,1.5,'woodFloor');
 // Upper floor: open-plan desks, with the rear corners given over to the
 // manager's office (west) and the conference room (east).
 for(const x of [-24,-18,-12,-6,6,12,18,24])for(const z of [-20,-12,-4,4]){
  if(z===-20&&(x===-24||x===-18))continue;                         // manager's office
  if(x>0&&(z===-20||z===-12))continue;                              // conference room
  desk(x,U,z);
 }
 for(const x of [-24,-18,-12,-6])desk(x,U,12);                      // the kitchen has the other half of this row
 for(const x of [-18,-12,-6,6,12,18])desk(x,U,20);                  // between the two lifts
 // Manager's office: glass on two sides, a doorway toward the floor, the desk facing the door.
 wall('Office glass',-15,-22,.12,12,U,'clearGlass');
 wall('Office glass',-26.25,-16,10.5,.12,U,'clearGlass');wall('Office glass',-16.5,-16,3,.12,U,'clearGlass');
 local('Office door header',-19.5,U+4.9,-16,3,1.7,.2,'brushedMetal');
 local('Executive desk',-23,U+.78,-22.5,3.6,.14,1.6,'woodFloor');
 for(const dx of [-1.6,1.6])local('Executive desk leg',-23+dx,U+.38,-22.5,.14,.76,1.3,'metal');
 local('Executive monitor',-23,U+1.35,-22.1,1.4,.8,.12,'slate');local('Executive display',-23,U+1.35,-22.03,1.22,.64,.02,'homeBlue',{solid:false});
 local('Executive chair seat',-23,U+.55,-24.3,.9,.16,.9,'slate');local('Executive chair back',-23,U+1.15,-24.7,.9,1.3,.16,'slate');
 for(const dx of [-1.5,1.5]){local('Visitor chair seat',-23+dx,U+.5,-20,.8,.14,.8,'homeBlue');local('Visitor chair back',-23+dx,U+1,-19.6,.8,1,.15,'homeBlue');}
 local('Office cabinet',-30.8,U+1.1,-24,1,2.2,4,'woodFloor');local('Office plant pot',-30.5,U+.4,-18,.8,.8,.8,'clay');local('Office plant',-30.5,U+1.5,-18,1.2,1.6,1.2,'homeSage',{solid:false});
 sign('MANAGING DIRECTOR',X-19.5,U+4.6,Z-15.8,7);
 // Conference room: glazed off the floor, one long table, a wall display.
 wall('Conference glass',6,-19,.12,18,U,'clearGlass');
 wall('Conference glass',20.75,-10,21.5,.12,U,'clearGlass');
 local('Conference door header',8.5,U+4.9,-10,3,1.7,.2,'brushedMetal');
 local('Conference table',18.5,U+.8,-19,12,.2,4,'woodFloor');
 for(const dx of [-4.5,4.5])local('Conference table leg',18.5+dx,U+.4,-19,.5,.8,3,'metal');
 for(const x of [13,15.5,18,20.5,23])for(const z of [-21.8,-16.2]){local('Conference chair seat',x,U+.5,z,.8,.14,.8,'homeBlue');local('Conference chair back',x,U+1,z+(z<-19?-.4:.4),.8,1,.15,'homeBlue');}
 local('Conference display',18.5,U+3,-27.6,8,2.6,.15,'slate');local('Conference screen',18.5,U+3,-27.5,7.6,2.2,.02,'hqCyan',{solid:false});
 sign('CONFERENCE / 01',X+18.5,U+4.6,Z-9.8,9);
 for(const x of [-24,-18,-12,-6])for(const z of [-20,-12,-4,4])desk(x,F,z);
 local('Meeting table',15,F+.8,-12,12,.2,4,'woodFloor');
 for(const x of [10,14,18,22])for(const z of [-15,-9])local('Meeting chair',x,F+.5,z,.8,1,.8,'homeBlue');
 wall('Meeting glass',5,-12,.12,22,F,'clearGlass');sign('COLLABORATION / 01',X+16,F+5.8,Z-25,12);
 local('Upper kitchen',18,U+.55,12,14,1.1,1.5,'woodFloor');local('Kitchen countertop',18,U+1.15,12,14,.12,1.7,'warmStone');local('Coffee machine',18,U+1.6,12,1,.8,.8,'slate');
 // Basement lift vestibule -> sliding steel door -> offices -> second secure door -> control.
 for(const [z,label] of [[17,'BASEMENT / AUTHORIZED ACCESS'],[-3,'MISSION OPERATIONS / CONTROL']]){
  wall('Secure partition',-17,z,30,.3,B,'concrete');wall('Secure partition',17,z,30,.3,B,'concrete');
  local('Secure door header',0,B+4.6,z,4,2.32,.4,'brushedMetal');
  door(label,X,B+1.7,Z+z,4,3.4,4.3);sign(label,X,B+4.6,Z+z+.23,11);
  local('Access indicator',3,B+1.6,z+.25,.22,.4,.12,'hqCyan',{solid:false});
 }
 // Basement offices: desks, with the west end walled off as a conference room.
 for(const x of [-10,10,19])for(const z of [7,13])desk(x,B,z);
 desk(15,B,1);                                                      // clear of the secure door at x = 0
 wall('Basement conference glass',-17,2.25,.12,10.2,B,'clearGlass');
 wall('Basement conference glass',-17,13.75,.12,6.5,B,'clearGlass');
 local('Basement conference door header',-17,B+4.9,9,.2,1.7,3,'brushedMetal');
 local('Basement conference table',-24.5,B+.8,7,9,.2,3.6,'woodFloor');
 for(const dx of [-3.5,3.5])local('Basement conference table leg',-24.5+dx,B+.4,7,.5,.8,2.6,'metal');
 for(const x of [-28,-25.5,-23,-20.5])for(const z of [4.4,9.6]){local('Basement conference chair seat',x,B+.5,z,.8,.14,.8,'homeBlue');local('Basement conference chair back',x,B+1,z+(z<7?-.4:.4),.8,1,.15,'homeBlue');}
 local('Basement conference display',-31.6,B+3,7,.15,2.4,6,'slate');local('Basement conference screen',-31.5,B+3,7,.02,2,5.6,'hqCyan',{solid:false});
 sign('CONFERENCE / B1',X-24.5,B+4.6,Z-2.7,9);
 for(const x of [-20,-10,0,10,20])for(const z of [-18,-10])desk(x,B,z,true);
 local('Mission video wall',0,B+3.2,-27.65,27,4,.3,'metal');
 for(const x of [-10,10]){local('Telemetry display',x,B+3.2,-27.44,6,3.4,.05,'slate');sign(x<0?'ORBIT / TRACKING':'SYSTEMS / NOMINAL',X+x,B+4.4,Z-27.38,5.8);for(let j=0;j<7;j++)local('Telemetry signal',x-2+j*.65,B+2.2+j%3*.2,-27.36,.35,.5+j%3*.3,.02,'hqCyan',{solid:false});}
 sign('LIVE / BATTLESHIP AERIAL',X,B+5.25,Z-27.35,12);
 for(const x of [-29,29])for(const z of [-22,-16,-10]){local('Server rack',x,B+1.6,z,2.5,3.2,2.5,'slate');for(let y=.5;y<3;y+=.4)local('Rack status',x,B+y,z+1.27,1.8,.07,.02,'hqCyan',{solid:false});}
 for(const [x,z] of [[-2350,-1830],[-2330,-1515],[-2120,-1720],[-1905,-1850],[-2110,-1510]]){box('Landscape planter',x,F+.5,z,7,1,7,'warmStone');box('Sculpted greenery',x,F+2,z,5,3,5,'homeSage');}
 // Planted courts break up the paving and frame the pedestrian approach.
 for(const [x,z,w,d] of [[-2280,-1780,62,110],[-2180,-1575,58,90],[-2100,-1835,24,70]]){
  slab('Garden bed',x,z,w,d,F+.08,'grass');
  for(const side of [-1,1])box('Garden border',x+side*w/2,F+.18,z,.3,.36,d,'warmStone');
  for(let dz=-d/2+12;dz<d/2;dz+=22){box('Tree trunk',x,F+2.3,z+dz,.65,4.6,.65,'woodFloor');box('Tree crown',x,F+5.4,z+dz,7,5,7,'homeSage',{solid:false});box('Garden bench',x+w/2-4,F+.5,z+dz,2,1,4,'woodFloor');}
 }
 // A planted commons with outdoor working terraces and narrow connecting paths.
 const paths=[[-2370,-1690,6,364],[-1906,-1690,6,364],[-2138,-1872,458,6],[-2138,-1508,458,6],[-2128,-1680,8,340],[-2160,-1704,420,8],[-2154,-1738,60,8],[-2180,-1746,12,16],[-2245,-1590,226,8],[-2015,-1736,24,24],[-2300,-1596,18,12]];
 for(const [x,z,w,d] of paths)slab('Pedestrian path',x,z,w,d,F+.04,'paving');
 const trees=[];
 for(const b of data.boxes.filter(b=>b.name==='Meridian: Tree crown'))trees.push({x:b.x,z:b.z,r:4.3,h:6.8});
 data.boxes=data.boxes.filter(b=>!['Meridian: Tree crown','Meridian: Garden border'].includes(b.name));
 for(const x of [-2350,-2320,-2280,-2240,-2200,-2160,-2080,-2040,-2000,-1960,-1926])for(const z of [-1845,-1528])trees.push({x,z,r:4.5+(Math.abs(x)%3),h:9});
 for(const x of [-2345,-2290,-2235,-2180])for(const z of [-1555,-1665,-1725]){
  if(z===-1665&&x<-2250)continue;
  trees.push({x,z,r:5.5,h:10+(Math.abs(x)%3)});
 }
 for(const t of trees)box('Landscape tree trunk',t.x,F+t.h*.35,t.z,.7,t.h*.7,.7,'woodFloor');
 for(const [x,z] of [[-2220,-1548],[-2335,-1735],[-2070,-1855]]){
  slab('Outdoor work terrace',x,z,24,18,F+.08,'woodFloor');paths.push([x,z,24,18]);
  box('Outdoor communal table',x,F+.8,z,9,.18,2,'warmStone');
  for(const dz of [-2,2])box('Outdoor bench',x,F+.45,z+dz,9,.18,.8,'woodFloor');
  for(const dx of [-10,10])for(const dz of [-7,7])box('Pergola post',x+dx,F+2,z+dz,.25,4,.25,'metal');
  for(let dx=-11;dx<=11;dx+=1.5)box('Pergola shade slat',x+dx,F+4.1,z,.3,.25,17,'woodFloor');
 }
 const link=(x,from,to,label)=>{(data.elevators??=[]).push({id:`campus-lift-${x}-${from}`,label,arrival:`Meridian Research · ${to===B?'Basement':to===U?'Upper floor':'Main floor'}`,position:[X+x,from,Z+23.5],target:[X+x,to,Z+23.5],yaw:Math.PI});};
 link(-24,F,U,'Elevator to upper offices');link(-24,U,F,'Elevator to main floor');link(24,F,B,'Elevator to secure basement');link(24,B,F,'Elevator to main floor');
 sign('← UPPER OFFICES    |    BASEMENT →',X,F+6,Z+19,16);
 data.campus={name:'Meridian Campus',x:X,z:Z,buildings,trees,bays,lobbyHeight:9.76,floors:{main:F,upper:U,basement:B},monitor:[X,B+3.15,Z-27.4],entrance:[X,F,Z+31]};
 for(const [name,y] of [['Main floor',F],['Upper offices',U],['Mission control',B]])data.rooms.push({name:`Meridian ${name}`,position:[X,y,Z+(y===B?-8:5)]});
 // Remove paving beneath inset planting, asphalt and the access lane to avoid
 // coplanar surfaces flickering when the campus is seen from flight altitude.
 const insets=[...paths,[-2010,-1600,186,140],[-2280,-1780,62,110],[-2180,-1575,58,90],[-2100,-1835,24,70],[-1950,-1300,18,480]];
 const courts=data.boxes.filter(b=>b.id.startsWith('campus-')&&/court|West garden walk/.test(b.name));
 for(const original of courts){
  let pieces=[original];
  for(const [x,z,w,d] of insets){
   const next=[];
   for(const p of pieces){
    const l=p.x-p.w/2,r=p.x+p.w/2,n=p.z-p.d/2,s=p.z+p.d/2;
    const a=Math.max(l,x-w/2),b=Math.min(r,x+w/2),c=Math.max(n,z-d/2),e=Math.min(s,z+d/2);
    if(a>=b||c>=e){next.push(p);continue;}
    for(const [x1,x2,z1,z2] of [[l,a,n,s],[b,r,n,s],[a,b,n,c],[a,b,e,s]])if(x2-x1>.001&&z2-z1>.001)next.push({...p,id:`campus-${seq++}`,x:(x1+x2)/2,z:(z1+z2)/2,w:x2-x1,d:z2-z1});
   }
   pieces=next;
  }
  data.boxes=data.boxes.filter(b=>b!==original);data.boxes.push(...pieces);
 }
 data.bounds.min[2]=Math.min(data.bounds.min[2],...island.outline.map(p=>p[1]));
}
