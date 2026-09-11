// A separate airborne landmark; the offshore naval carrier stays in place.
export function addHelicarrier(data) {
  const X=-350,Z=650,deck=920,floor=904,id='aegis';let seq=0;
  const point=(x,y,z)=>[X+x,y,Z+z];
  const box=(name,x,y,z,w,h,d,material='hqHull',extra={})=>{const b={id:`${id}-${seq++}`,helicarrier:true,name:`Aegis: ${name}`,x:X+x,y,z:Z+z,w,h,d,material,solid:true,kind:'structure',...extra};data.boxes.push(b);return b;};
  const slab=(name,x,y,z,w,d,mat='hqFloor',h=.3)=>box(name,x,y-h/2,z,w,h,d,mat,{kind:'surface'});
  const prism=(name,bottom,top,outline,material,extra={})=>box(name,0,(bottom+top)/2,0,Math.max(...outline.map(p=>p[0]))-Math.min(...outline.map(p=>p[0])),top-bottom,Math.max(...outline.map(p=>p[1]))-Math.min(...outline.map(p=>p[1])),material,{shape:'prism',outline,...extra});
  const outline=[[-25,-156],[25,-156],[44,-115],[44,115],[32,148],[-32,148],[-44,115],[-44,-115]];
  prism('Armored lower hull',878,floor-.3,outline,'hqHull',{bottomScale:[.60,.83]});
  prism('Flight deck',deck-2,deck,outline,'carrierDeck',{kind:'surface'});
  slab('Headquarters floor',0,floor,0,76,228);
  // Actual side walls and windows surround open rooms, never a filled hull box.
  for(const side of [-1,1]){
    box('Hull belt',side*39,floor+1,0,2,2,230);
    box('Panoramic glazing',side*38.1,floor+7,0,.16,10,224,'clearGlass');
    for(let z=-112;z<=112;z+=16)box('Structural rib',side*38,floor+7,z,.7,14,.8,'brushedMetal');
    box('Upper hull belt',side*39,deck-3,0,2,2,230);
    // Exterior outriggers, armored fan housings and underside braces.
    for(const z of [-88,88]){
      box('Rotor outrigger',side*62,deck-5,z,48,5,20);
      box('Rotor armor platform',side*91,deck-7,z,64,4,68);
      box('Rotor support spar',side*58,deck-12,z,36,4,8,'brushedMetal');
    }
    for(let z=-130;z<=130;z+=13){box('Deck edge beacon',side*40,deck+.16,z,.45,.25,1.5,'hqCyan',{solid:false});}
  }
  box('Forward observation glass',0,floor+7,-113,75,14,.15,'clearGlass');
  for(const x of [-26,26])box('Stern bulkhead',x,floor+7,113,24,14,.6);
  box('Fly-in entrance lintel',0,floor+12,113,28,4,.6);
  slab('Stern landing balcony',0,floor,128,52,28,'carrierDeck');
  for(const x of [-26,26])box('Balcony side rail',x,floor+.8,128,.3,1.6,28,'brushedMetal');
  // Two distinct flight-deck tiers: elevated aft runway over an open
  // lower-deck hangar, joined by a broad, physically graded center ramp.
  const upperDeck=deck+12;
  prism('Raised aft flight deck',upperDeck-2,upperDeck,[[-24,147],[24,147],[40,120],[40,50],[-40,50],[-40,120]],'carrierDeck',{kind:'surface'});
  for(const side of [-1,1]){
    box('Upper deck edge girder',side*38,upperDeck-3.5,91,2,3,80,'hqHull');
    for(const z of [115,80,54])box('Upper deck support',side*33,deck+5,z,2,10,3,'brushedMetal');
    for(let z=54;z<139;z+=12)box('Upper runway beacon',side*22,upperDeck+.15,z,.4,.25,1.4,'hqCyan',{solid:false});
    slab('Upper runway edge',side*13,upperDeck+.025,98,.35,90,'paint',.03);
    slab('Lower runway edge',side*13,deck+.025,-72,.35,104,'paint',.03);
  }
  for(let z=56;z<139;z+=12)slab('Upper runway centerline',0,upperDeck+.03,z,.5,6,'paint',.025);
  for(let z=-132;z<-27;z+=12)slab('Lower runway centerline',0,deck+.03,z,.5,6,'paint',.025);
  for(const [z,y] of [[137,upperDeck],[-139,deck]])for(const x of [-10,-6,-2,2,6,10])slab('Runway threshold',x,y+.03,z,1.3,7,'paint',.025);
  data.ramps.push({id:'aegis-deck-ramp',name:'Aegis: flight deck connecting ramp',axis:'z',x1:Z-20,x2:Z+50,z:X,width:26,y1:deck,y2:upperDeck,thickness:1.2,material:'carrierDeck'});
  // Thin physical edge strips follow the same slope and mark the transition.
  for(const side of [-1,1])data.ramps.push({id:`aegis-ramp-edge-${side}`,name:'Aegis: ramp edge stripe',axis:'z',x1:Z-20,x2:Z+50,z:X+side*12.5,width:.22,y1:deck+.025,y2:upperDeck+.025,thickness:.02,material:'paint'});
  box('Operations bridge lower',27,upperDeck+5,92,21,10,40);
  box('Operations bridge glazing',27,upperDeck+12,94,24,4,32,'glass');
  box('Operations bridge roof',27,upperDeck+15,94,26,2,34,'brushedMetal');
  box('Radar mast',28,upperDeck+27,83,1.5,24,1.5,'brushedMetal');
  box('Radar array',28,upperDeck+37,83,15,4,1.1,'hqHull');
  for(const x of [-29,29])for(const z of [-124,122]){
    box('Engine pod',x,891,z,13,14,25);
    for(const dx of [-3,3])box('Engine exhaust',x+dx,889,z+13,4,4,.5,'hqAmber',{solid:false});
  }
  const wall=(name,x,z,w,d)=>box(name,x,floor+7,z,w,14,d,'hqPanel');
  // The central spine and cross-room doorways preserve generous clear routes.
  for(const side of [-1,1])for(const [a,b]of [[-43,-25],[-19,10],[16,47],[53,109]])wall('Corridor partition',side*9,(a+b)/2,.3,b-a);
  for(const z of [-43,35])for(const side of [-1,1])wall('Room divider',side*24,z,29,.3);
  for(const side of [-1,1])for(const z of [-22,13,50])box('Doorway lintel',side*9,floor+11.5,z,.35,5,6,'brushedMetal');
  const sign=(text,x,y,z,width=9)=>{(data.signs??=[]).push({text,position:point(x,y,z),width,height:width*.20});};
  sign('AEGIS / COMMAND',0,floor+10,-109,18);
  sign('SCIENCE / ARMORY',-24,floor+5,-42.7,13);sign('MISSION BRIEFING',24,floor+5,-42.7,13);
  sign('CREW LOUNGE',-24,floor+5,35.3,11);sign('MEDICAL BAY',24,floor+5,35.3,11);
  // Command center: luminous tactical table, curved console banks, viewport.
  box('Tactical table base',0,floor+1,-76,10,2,7,'brushedMetal');
  box('Tactical hologram surface',0,floor+2.05,-76,10.5,.15,7.5,'hqCyan',{solid:false});
  for(let x=-3;x<=3;x+=1.5)box('Holographic city block',x,floor+3+Math.abs(x)*.3,-76,1,1.8+Math.abs(x)*.6,1,'hqHologram',{solid:false});
  for(const x of [-25,-17,17,25]){
    box('Command console',x,floor+.7,-93,5,1.4,2,'hqPanel');
    box('Command display',x,floor+2,-93.6,4,1.3,.15,'hqCyan',{solid:false});
    box('Command chair',x,floor+.6,-89.5,1.2,1.2,1.2,'homeBlue');
  }
  // Lab and equipment displays.
  for(const z of [-32,-16,0,22]){
    box('Lab workbench',-28,floor+.8,z,12,1.6,2,'brushedMetal');
    box('Lab terminal',-28,floor+2,z-.6,2.5,1,.15,'hqCyan',{solid:false});
    box('Equipment case',-35,floor+2,z,1.8,4,4,'clearGlass');
    box('Suit display torso',-35,floor+2.2,z,.9,1.5,.7,'homeBlue');
    box('Suit display helmet',-35,floor+3.2,z,.6,.6,.6,'brushedMetal');
  }
  // Briefing room, six seats around a tactical desk and a wall display.
  box('Briefing table',23,floor+1,-12,10,2,12,'hqPanel');
  box('Briefing tabletop',23,floor+2.1,-12,10.2,.12,12.2,'brushedMetal');
  for(const z of [-16,-12,-8])for(const x of [16,30]){box('Briefing chair',x,floor+.55,z,1.2,1.1,1.2,'homeBlue');}
  box('Mission screen',24,floor+4,-42.5,18,5,.18,'hqCyan',{solid:false});
  const sofa=(x,z)=>{box('Lounge sofa',x,floor+.6,z,8,1.2,2,'homeBlue');box('Sofa back',x,floor+1.4,z-.9,8,1.6,.3,'homeBlue');};
  sofa(-24,52);sofa(-24,68);box('Lounge table',-24,floor+.6,60,5,1.2,3,'woodFloor');
  box('Galley counter',-34,floor+.65,92,3,1.3,16,'brushedMetal');
  box('Coffee station',-34,floor+1.7,88,1.2,.8,1.2,'slate');
  for(const z of [53,70,87]){box('Medical bed',25,floor+.65,z,3,1.3,6,'cream');box('Medical scanner',30,floor+2,z,1,4,1,'brushedMetal');box('Medical monitor',30,floor+3,z+.5,2,1.2,.15,'hqCyan',{solid:false});}
  // Recessed deck lift has a real cabin above and below, plus a fly-in rear door.
  for(const f of [floor,upperDeck]){
    box('Lift rear wall',0,f+3,96,6,6,.3,'brushedMetal');
    for(const x of [-3,3])box('Lift cabin side',x,f+3,99,.3,6,6,'brushedMetal');
    box('Lift cabin canopy',0,f+6,99,6,.3,6,'hqHull');
    slab('Lift landing',0,f+.015,99,6,6,'brushedMetal');
    sign(f===upperDeck?'E / HEADQUARTERS':'E / FLIGHT DECK',0,f+4.2,102.2,5.5);
  }
  const upper=point(0,upperDeck,100),lower=point(0,floor,100);
  (data.elevators??=[]).push({id:'aegis-down',label:'Lift to Aegis headquarters',arrival:'Aegis · Headquarters',position:upper,target:lower,yaw:0},{id:'aegis-up',label:'Lift to flight deck',arrival:'Aegis · Flight deck',position:lower,target:upper,yaw:0});
  for(const x of [-34,-7,7,34])for(const z of [-80,-20,60])box('Ceiling light strip',x,deck-2.1,z,.35,.12,24,'hqCyan',{solid:false});
  for(const x of [-7,7])slab('Corridor guidance light',x,floor+.025,26,.12,152,'hqCyan',.025);
  data.helicarrier={name:'Aegis Helicarrier',x:X,z:Z,deck,upperDeck,floor,upper,lower,entry:point(0,floor,126),rotors:[[-91,-88],[91,-88],[-91,88],[91,88]],rooms:[{name:'Command center',position:point(0,floor,-58)},{name:'Science lab',position:point(-15,floor,-22)},{name:'Briefing room',position:point(14,floor,13)},{name:'Crew lounge',position:point(-15,floor,50)},{name:'Medical bay',position:point(15,floor,50)}]};
  data.rooms.push(...data.helicarrier.rooms);data.landmarks.helicarrier=data.helicarrier;
  data.bounds.max[1]=Math.max(data.bounds.max[1],upperDeck+42);
}
