// Replace three existing Eastbank shells; everything is real world geometry
// and uses the same solid/floor collision records as the landmark interiors.
export function addResidences(data) {
  const east=data.islands[1];
  // One home by the bridge, one in the southern terraces, one in the northeast.
  const anchors=[[910,-97],[1350,420],[2200,-430]];
  const candidates=data.boxes.filter(b=>b.name==='Eastbank house'&&b.w>12.5&&b.w<18.5&&b.d>21);
  const houses=anchors.map(([x,z])=>candidates.reduce((best,b)=>!best||Math.hypot(b.x-x,b.z-z)<Math.hypot(best.x-x,best.z-z)?b:best,null));
  if(houses.some(h=>!h)||new Set(houses).size!==3)throw new Error('Eastbank requires three separate residential lots');
  const nearestRoad=(px,pz)=>{
    let nearest=null;
    for(const r of data.curvedRoads.filter(r=>(r.island??1)===1))for(let i=1;i<r.points.length;i++){
      const a=r.points[i-1],b=r.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len2=dx*dx+dz*dz;
      if(!len2)continue;
      const t=Math.max(0,Math.min(1,((px-a[0])*dx+(pz-a[1])*dz)/len2));
      const x=a[0]+dx*t,z=a[1]+dz*t,dist=Math.hypot(x-px,z-pz);
      if(!nearest||dist<nearest.dist)nearest={x,z,y:a[2]+(b[2]-a[2])*t,dist,width:r.width,name:r.name};
    }
    return nearest;
  };
  data.residences=[];east.residentialPads=[];east.residentialDrives=[];
  const styles=[
    {name:'01 · Birch House',wall:'cream',roof:'roofSlate',accent:'homeSage'},
    {name:'02 · Cedar House',wall:'clay',roof:'roofTile',accent:'homeTerracotta'},
    {name:'03 · Stone House',wall:'warmStone',roof:'roofMetal',accent:'homeBlue'},
  ];
  for(const [index,old] of houses.entries()) {
    const style=styles[index], id=`eastbank-home-${index+1}`,road=nearestRoad(old.x,old.z);
    let angle=old.rotation||0;
    if(Math.sin(angle)*(road.x-old.x)+Math.cos(angle)*(road.z-old.z)<0)angle+=Math.PI;
    const c=Math.cos(angle),s=Math.sin(angle);
    const W=old.w/2,D=old.d/2,H=4.2,front=D,garageX=(W+1)/2,garageW=W-1;
    const world=(x,z)=>[old.x+c*x+s*z,old.z-s*x+c*z];
    const start=world(garageX,front+2.6),nearest=nearestRoad(...start);
    const ux=(nearest.x-start[0])/nearest.dist,uz=(nearest.z-start[1])/nearest.dist;
    const end=[nearest.x-ux*(nearest.width/2-.4),nearest.z-uz*(nearest.width/2-.4),nearest.y+.34];
    const run=Math.hypot(end[0]-start[0],end[1]-start[1]);
    const F=Math.max(end[2]-run*.10,Math.min(old.floor,end[2]+run*.10));
    const point=(x,y,z)=>{const [wx,wz]=world(x,z);return [wx,F+y,wz];};
    // Remove the opaque shell and its cap, chimney and old foundation only.
    data.boxes=data.boxes.filter(b=>!(Math.hypot(b.x-old.x,b.z-old.z)<.01 || (b.name==='House chimney'&&Math.hypot(b.x-old.x,b.z-old.z)<old.w*.3)));
    const lot=data.lots.find(l=>Math.hypot(l.x-old.x,l.z-old.z)<.01);
    if(lot){lot.terrainOnly=true;lot.residenceId=id;}
    const oldDrive=data.driveways.reduce((best,d)=>Math.hypot(d.points[0][0]-old.x,d.points[0][1]-old.z)<Math.hypot(best.points[0][0]-old.x,best.points[0][1]-old.z)?d:best,data.driveways[0]);
    data.driveways=data.driveways.filter(d=>d!==oldDrive);
    let seq=0;
    const box=(name,x,y,z,w,h,d,material='interiorWall',extra={})=>{
      const [wx,wz]=world(x,z), b={id:`${id}-${seq++}`,residenceId:id,name:`${style.name}: ${name}`,x:wx,y:F+y,z:wz,w,h,d,rotation:angle,material,solid:true,kind:'structure',...extra};data.boxes.push(b);return b;
    };
    const slab=(name,x,z,w,d,material='woodFloor',top=0)=>box(name,x,top-.10,z,w,.20,d,material,{kind:'surface'});
    const wall=(name,x,z,w,d,material='interiorWall')=>box(name,x,H/2,z,w,H,d,material);
    // Wall runs with genuine apertures. Window glazing collides, doors remain open.
    function facade(name,z,openings) {
      let cursor=-W;
      for(const o of openings.sort((a,b)=>a.x-b.x)) {
        const left=o.x-o.w/2,right=o.x+o.w/2;
        if(left>cursor)wall(name,(cursor+left)/2,z,left-cursor,.30,style.wall);
        if(o.bottom>0)box('Window sill wall',o.x,o.bottom/2,z,o.w,o.bottom,.30,style.wall);
        box('Opening lintel',o.x,(H+o.top)/2,z,o.w,H-o.top,.30,style.wall);
        if(o.bottom>0){box('Window glass',o.x,(o.bottom+o.top)/2,z,o.w,o.top-o.bottom,.06,'clearGlass');box('Window mullion',o.x,(o.bottom+o.top)/2,z,.065,o.top-o.bottom,.13,'warmStone');}
        for(const x of [left,right])box('Opening surround',x,(o.bottom+o.top)/2,z,.09,o.top-o.bottom,.40,'warmStone');
        cursor=right;
      }
      if(cursor<W)wall(name,(cursor+W)/2,z,W-cursor,.30,style.wall);
    }
    const doorX=-1.5,doorW=2.0;
    facade('Front wall',front,[{x:-W+1.7,w:2.3,bottom:1,top:3.2},{x:doorX,w:doorW,bottom:0,top:3.1},{x:garageX,w:garageW-.6,bottom:0,top:3.3}]);
    facade('Rear wall',-D,[{x:-W/2,w:2.6,bottom:1,top:3.1},{x:W/2,w:2.0,bottom:1.4,top:3.1}]);
    for(const side of [-1,1]) {
      const x=side*W,centers=side<0?[-D+2.5,-D*.25+2,front-4]:[-D+2.5,0];
      let cursor=-D;
      for(const z of centers.sort((a,b)=>a-b)) {
        const left=z-1.1,right=z+1.1;
        if(left>cursor)wall('Side wall',x,(cursor+left)/2,.30,left-cursor,style.wall);
        box('Side window sill',x,.55,z,.30,1.1,2.2,style.wall);
        box('Side window lintel',x,3.65,z,.30,1.1,2.2,style.wall);
        box('Side window glazing',x,2.1,z,.06,2.0,2.2,'clearGlass');
        box('Side window mullion',x,2.1,z,.14,2.0,.065,'warmStone');
        cursor=right;
      }
      if(cursor<D)wall('Side wall',x,(cursor+D)/2,.30,D-cursor,style.wall);
    }
    slab('Continuous interior floor',0,0,old.w,old.d);
    box('Foundation',0,-.8,0,old.w,1.4,old.d,'foundation');
    // Central corridor connects the front door and every room without a step.
    const split=-D*.25,door=2.0;
    for(const [a,b] of [[-W,-1-door/2],[-1+door/2,W]])wall('Bedroom hall partition',(a+b)/2,split,b-a,.18);
    box('Bedroom doorway lintel',-1,(H+3.1)/2,split,door,H-3.1,.18);
    // Doorway between the bathroom and the back hall (through divider).
    const bathDoorZ=split-2;
    for(const [a,b] of [[-D,bathDoorZ-1],[bathDoorZ+1,split]])if(b>a)wall('Bathroom partition',1,(a+b)/2,.18,b-a);
    box('Bathroom doorway lintel',1,(H+3.1)/2,bathDoorZ,.18,H-3.1,2);
    // Enclosed garage, internal passage at its rear and wide raised roller door.
    const garageBack=front-6.8;
    wall('Garage side wall',1,(front+garageBack+2)/2,.18,front-garageBack-2);
    box('Garage passage lintel',1,(H+3.1)/2,garageBack+1,.18,H-3.1,2);
    wall('Garage rear wall',garageX,garageBack,garageW,.18);
    slab('Garage concrete floor',garageX,(front+garageBack)/2,garageW-.2,6.7,'concrete',.01);
    box('Raised garage door',garageX,3.42,front-1.1,garageW-.5,.14,2.1,'brushedMetal');
    for(const x of [1.25,W-.25])box('Garage door rail',x,3.45,front-1.7,.08,.10,3.2,'metal');
    box('Garage workbench',W-.7,.48,garageBack+1.2,1.0,.96,1.8,'woodFloor');
    // Furniture is solid so the hero cannot walk through beds or kitchen units.
    const lx=-W+1.0,lz=front-4;
    box('Sofa seat',lx+.2,.42,lz,1.2,.55,3.0,style.accent);
    box('Sofa back',lx-.35,.85,lz,.25,1.05,3.0,style.accent);
    for(const z of [lz-1.4,lz+1.4])box('Sofa arm',lx+.2,.68,z,1.2,.32,.22,style.accent);
    slab('Living room rug',-W+3.0,lz,3.2,3.8,'homeRug',.015);
    box('Coffee table',-W+2.7,.34,lz,.8,.68,1.45,'woodFloor');
    box('TV console',.45,.45,lz,.70,.90,2.2,'woodFloor');
    box('Television',.48,1.5,lz,.10,1.10,1.9,'slate');
    const kitchenZ=split+2.0;
    box('Kitchen cabinetry',-W+.7,.48,kitchenZ,1.1,.96,3.2,'woodFloor');
    box('Stone countertop',-W+.7,1.0,kitchenZ,1.2,.10,3.3,'stoneFloor');
    box('Sink basin',-W+.7,1.06,kitchenZ-.55,.75,.035,.65,'brushedMetal');
    box('Cooktop',-W+.7,1.07,kitchenZ+.65,.8,.035,.7,'slate');
    for(const dx of [-.2,.2])for(const dz of [-.18,.18])box('Cooktop burner',-W+.7+dx,1.09,kitchenZ+.65+dz,.14,.015,.14,'metal');
    box('Refrigerator',-W+.75,1.05,split+4.6,1.2,2.1,1.15,'brushedMetal');
    box('Dining tabletop',-2.1,.83,kitchenZ,1.5,.13,1.3,'woodFloor');
    for(const x of [-2.6,-1.6])for(const z of [kitchenZ-.4,kitchenZ+.4])box('Table leg',x,.4,z,.10,.8,.10,'woodFloor');
    for(const z of [kitchenZ-1.15,kitchenZ+1.15]){box('Dining chair',-2.1,.44,z,.65,.12,.65,style.accent);box('Chair back',-2.1,.85,z+(z>kitchenZ?.28:-.28),.65,.7,.10,style.accent);}
    // Bedroom and bathroom occupy the quieter rear of each home.
    const bedX=-W+2.1,bedZ=-D+2.4;
    box('Bed frame',bedX,.23,bedZ,2.15,.46,2.9,'woodFloor');
    box('Mattress',bedX,.57,bedZ,2.05,.24,2.75,'cream');
    box('Duvet',bedX,.73,bedZ+.35,2.08,.09,1.9,style.accent);
    box('Headboard',bedX,.75,bedZ-1.4,2.2,1.5,.15,'woodFloor');
    for(const x of [bedX-.5,bedX+.5])box('Pillow',x,.76,bedZ-.91,.80,.15,.52,'cream');
    box('Bedside cabinet',bedX+1.65,.38,bedZ-.7,.7,.76,.7,'woodFloor');
    box('Wardrobe',-W+.55,1.2,split-2.0,.8,2.4,2.4,'woodFloor');
    slab('Bathroom tiled floor',(1+W)/2,(-D+split)/2,W-1,D+split,'stoneFloor',.012);
    box('Bathroom vanity',W-1.05,.47,split-1.15,1.6,.94,.75,'cream');
    box('Vanity basin',W-1.05,.98,split-1.15,1.1,.10,.6,'brushedMetal');
    box('Bathroom mirror',W-1.05,1.8,split-.13,1.25,1.05,.045,'clearGlass',{solid:false});
    box('Shower tray',W-1.15,.08,-D+1.25,1.8,.16,1.9,'cream');
    box('Shower screen',W-2.05,1.15,-D+1.25,.055,2.3,1.9,'clearGlass');
    box('Toilet pedestal',2.2,.25,-D+1.15,.5,.5,.7,'cream');
    box('Toilet seat',2.2,.52,-D+1.15,.65,.08,.8,'cream');
    box('Toilet cistern',2.2,.75,-D+.64,.65,.8,.26,'cream');
    for(const [x,z] of [[-2,front-4],[-2,kitchenZ],[bedX,bedZ],[W/2,-D+3],[garageX,front-3]])
      box('Ceiling light',x,H-.05,z,.6,.08,.6,'homeLight',{solid:false});
    // Full roof, porch canopy, and a level apron that joins both entrances.
    box('Ceiling',0,H+.08,0,old.w,.16,old.d,'interiorRoof',{cutaway:true});
    box('Pitched roof',0,H+1.0,0,old.w+1.1,1.8,old.d+1.1,style.roof,{roofShape:index===1?'hip':'gable',cutaway:true});
    slab('Front terrace',0,front+1.3,old.w+1,2.6,'stoneFloor');
    box('Porch canopy',doorX,3.35,front+1.5,3.1,.16,3.0,style.accent,{cutaway:true});
    for(const x of [doorX-1.4,doorX+1.4])box('Porch post',x,1.6,front+2.7,.14,3.2,.14,'warmStone');
    // Terrain is graded under each building and driveway, avoiding buried floors.
    const pad={x:old.x,z:old.z,w:old.w+2,d:old.d+6,rotation:angle,height:F-.22};east.residentialPads.push(pad);
    const driveway={name:`${style.name} driveway`,residenceId:id,width:5.4,graded:true,points:[[...start,F],end]};
    data.driveways.push(driveway);east.residentialDrives.push(driveway);
    // Reserve the front walk from procedural trees, rocks, bins and benches too.
    data.driveways.push({name:`${style.name} entrance walk`,residenceId:id,width:2.4,graded:true,points:[[...world(doorX,front+.4),F+.012],[...world(garageX,front+.4),F+.012]]});
    const home={id,name:style.name,street:nearest.name,x:old.x,z:old.z,w:old.w,d:old.d,rotation:angle,floor:F,entrance:point(doorX,0,front+1.3),driveway,rooms:[
      {name:'Living room',position:point(-2,0,front-4)},
      {name:'Kitchen',position:point(-W+2.6,0,kitchenZ)},
      {name:'Bedroom',position:point(-1,0,split-2)},
      {name:'Bathroom',position:point(2.5,0,split-2)},
      {name:'Garage',position:point(garageX,0,front-3)},
    ]};
    data.residences.push(home);data.rooms.push(...home.rooms.map(r=>({...r,name:`${style.name} ${r.name}`})));
  }
}
