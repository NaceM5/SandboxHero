// Hollow two storeys of an existing city building; keep its original skyline.
export function addOffice(data) {
  const old=data.boxes.find(b=>b.name==='City expansion building'&&b.x===-1875.75&&b.z===115.2);
  if(!old)throw new Error('Harbor Exchange office lot is missing');
  buildOffice(data,old,{id:'exchange',name:'Harbor Exchange',floor:4,office:24.28,walkEnd:163.1,direction:1});
  const tower=data.boxes.filter(b=>b.name==='City expansion building').sort((a,b)=>b.h-a.h)[0];
  if(!tower)throw new Error('Skyline office tower is missing');
  buildOffice(data,tower,{id:'skyline',name:'Skyline Tower',floor:140,office:568.28,walkEnd:-282.9,direction:-1});
}

function buildOffice(data,old,config) {
  const {id,name,floor,office,direction}=config;
  const x=old.x,z=old.z,W=old.w/2,D=old.d/2,lobby=8.28,H=5.2,top=old.y+old.h/2;
  const point=(u,y,v)=>[x+direction*u,y,z+direction*v];
  // Remove the filled podium as well as the shaft at the playable lobby.
  data.boxes=data.boxes.filter(b=>!(b.name==='Tower podium'&&b.x===x&&b.z===z));
  data.boxes=data.boxes.filter(b=>b!==old);
  let seq=0;
  const box=(name,u,y,v,w,h,d,material='interiorWall',extra={})=>{
    const b={id:`${id}-office-${seq++}`,officeId:id,name:`${config.name}: ${name}`,x:x+direction*u,y,z:z+direction*v,w,h,d,material,solid:true,kind:'structure',...extra};data.boxes.push(b);return b;
  };
  const slab=(name,y,w,d,material='stoneFloor',u=0,v=0)=>box(name,u,y-.12,v,w,.24,d,material,{kind:'surface'});
  const wall=(name,u,f,v,w,d,mat='interiorWall')=>box(name,u,f+H/2,v,w,H,d,mat);
  const sign=(text,u,y,v,w=3)=>{(data.signs??=[]).push({text,position:point(u,y,v),rotation:direction<0?Math.PI:0,width:w,height:w*.22});};
  // Former solid shell is split ABOVE the walkable rooms rather than left inside them.
  box('Intermediate storeys',0,(lobby+H+office-.24)/2,0,old.w,office-.24-lobby-H,old.d,old.material,{building:true,facade:true});
  box('Upper office storeys',0,(office+H+top)/2,0,old.w,top-office-H,old.d,old.material,{building:true,facade:true});
  for(const [f,label] of [[lobby,'Lobby'],[office,`Office floor ${floor}`]]) {
    slab(`${label} floor`,f,old.w,old.d,f===lobby?'stoneFloor':'woodFloor');
    slab(`${label} ceiling`,f+H,old.w,old.d,'interiorRoof');
    wall('Rear wall',0,f,-D,old.w,.35);
    for(const side of [-1,1]) {
      wall('Side glazing',side*W,f,0,.12,old.d,'clearGlass');
      for(let v=-D;v<=D;v+=5)wall('Window pier',side*W,f,v,.45,.40,'warmStone');
      wall('Front glazing',side*(W+2)/2,f,D,W-2,.12,'clearGlass');
    }
    if(f===office)wall('Front central glazing',0,f,D,4,.12,'clearGlass');
    else box('Entrance lintel',0,f+4.2,D,4,2,.40,'warmStone');
    // Lift cabin, open doorway, call buttons and a distinct level sign.
    wall('Elevator back',0,f,-D+1.5,4.8,.24,'brushedMetal');
    for(const side of [-1,1])wall('Elevator side',side*2.4,f,-D+3.5,.24,4,'brushedMetal');
    box('Lift doorway header',0,f+3.95,-D+5.5,4.8,2.5,.35,'brushedMetal');
    for(const side of [-1,1])box('Lift door jamb',side*1.95,f+1.5,-D+5.5,.5,3,.3,'metal');
    slab('Lift threshold',f+.015,3.4,3.5,'brushedMetal',0,-D+3.8);
    box('Elevator call panel',2.1,f+1.35,-D+5.71,.22,.5,.08,'slate',{solid:false});
    box('Lit call button',2.1,f+1.35,-D+5.76,.09,.09,.015,'homeLight',{solid:false});
    sign(f===lobby?`E  ·  ${floor} / OFFICES`:'E  ·  G / LOBBY',0,f+3.1,-D+5.72,3.1);
    for(const u of [-16,0,16])for(const v of [-6,9])box('Ceiling light',u,f+H-.2,v,2,.06,.6,'homeLight',{solid:false});
  }
  // Continuous, flush approach from the south sidewalk, clear of the carriageway.
  const walkEnd=(config.walkEnd-z)*direction;
  slab('Entrance walk',lobby,5.8,walkEnd-D,'paving',0,(walkEnd+D)/2);
  box('Entrance canopy',0,lobby+3.7,D+1.7,7,.24,3.8,'brushedMetal');
  sign(name.toUpperCase(),0,lobby+4.4,D+.3,10);
  // Lobby: reception, waiting area, directory and security-free central aisle.
  box('Reception desk',-8,lobby+.6,7,5.4,1.2,1.4,'woodFloor');
  box('Reception counter',-8,lobby+1.25,7,5.6,.12,1.6,'warmStone');
  box('Reception monitor',-8,lobby+1.65,6.7,1,.6,.12,'slate');
  sign('RECEPTION',-8,lobby+.85,7.72,3);
  const seat=(u,f,v)=>{box('Lounge seat',u,f+.4,v,2.7,.5,1.0,'homeBlue');box('Lounge back',u,f+.85,v-.45,2.7,1,.16,'homeBlue');};
  for(const v of [4,10])seat(13,lobby,v);
  box('Lobby coffee table',13,lobby+.35,7,2.0,.7,1.0,'woodFloor');
  for(const u of [-24,24]){box('Planter',u,lobby+.5,13,1.6,1,1.6,'warmStone');box('Indoor greenery',u,lobby+1.4,13,1.2,1.3,1.2,'homeSage',{solid:false});}
  box('Directory panel',-7,lobby+2,-D+5.5,3,2,.15,'slate');sign('G  LOBBY   |   4  OFFICES',-7,lobby+2,-D+5.4,2.8);
  // Workstations keep wide circulation aisles between banks and the elevator.
  const desk=(u,v)=>{
    box('Desk surface',u,office+.80,v,2.2,.12,1.1,'warmStone');
    for(const side of [-1,1])box('Desk leg',u+side*.92,office+.38,v,.10,.76,.85,'metal');
    box('Monitor',u,office+1.24,v-.22,.85,.52,.08,'slate');box('Monitor stand',u,office+.91,v-.22,.1,.2,.12,'metal');
    box('Keyboard',u,office+.88,v+.23,.65,.03,.22,'slate');
    box('Office chair seat',u,office+.47,v+1.15,.65,.12,.65,'homeBlue');box('Office chair back',u,office+.9,v+1.45,.65,.8,.12,'homeBlue');
    box('Chair pedestal',u,office+.22,v+1.15,.12,.44,.12,'metal');
  };
  for(const u of [-18,-12,-6,6,12,18])for(const v of [3,10])desk(u,v);
  // Meeting room in the northwest corner, with a 2.4 m open entrance.
  wall('Meeting glass partition',-10,office,-11,.12,14,'clearGlass');
  wall('Meeting front glass',-23,office,-4,16,.12,'clearGlass');
  wall('Meeting front glass',-11.5,office,-4,3,.12,'clearGlass');
  box('Meeting table',-21,office+.8,-11,7,.16,2.3,'woodFloor');
  for(const u of [-23.5,-21,-18.5])for(const v of [-13,-9]){box('Meeting chair',u,office+.45,v,.7,.12,.7,'homeSage');box('Meeting chair back',u,office+.9,v+(v<-11?-.3:.3),.7,.8,.12,'homeSage');}
  box('Presentation screen',-21,office+2.2,-D+.25,5,2.3,.1,'slate');
  sign('MEETING 01',-23,office+3,-3.88,4);
  // Break area on the opposite side, storage and coffee equipment.
  box('Kitchen cabinets',23,office+.5,-D+1.1,9,1,1.3,'woodFloor');box('Kitchen worktop',23,office+1.05,-D+1.1,9.2,.12,1.5,'warmStone');
  box('Coffee machine',24,office+1.42,-D+1.1,.65,.65,.55,'slate');
  box('Fridge',29,office+1.05,-D+1.1,1.25,2.1,1.3,'brushedMetal');
  seat(21,office,-8);box('Break table',21,office+.35,-5.5,2,.7,1,'woodFloor');
  box('Printer cabinet',-6,office+.55,-10,1.8,1.1,1,'cream');
  box('Printer',-6,office+1.24,-10,1.2,.3,.8,'slate');
  const lift=point(0,lobby,-D+3.7),upper=point(0,office,-D+3.7),yaw=direction<0?Math.PI:0;
  data.elevators=[...(data.elevators??[]),{id:`${id}-up`,label:`Elevator to office floor ${floor}`,arrival:`${name} · Office floor ${floor}`,position:lift,target:upper,yaw},{id:`${id}-down`,label:'Elevator to lobby',arrival:`${name} · Ground floor lobby`,position:upper,target:lift,yaw}];
  const entry={id,name,floor,direction,x,z,w:old.w,d:old.d,lobbyFloor:lobby,officeFloor:office,entrance:point(0,lobby,D+2),lift,upper,meeting:point(-21,office,-7),workstations:point(0,office,8),breakArea:point(21,office,-4)};
  (data.offices??=[]).push(entry);
  if(id==='exchange')data.office=entry;
  data.rooms.push({name:`${name} lobby`,position:point(0,lobby,7)},{name:`${name} office`,position:point(0,office,8)});
}
