export function elevatorAt(elevators, player) {
  if(player.vehicle||player.downed||player.flying)return null;
  return elevators.find(e=>Math.abs(player.pos.y-e.position[1])<.6&&Math.hypot(player.pos.x-e.position[0],player.pos.z-e.position[2])<1.65)??null;
}

export function useElevator(world) {
  const p=world.player,e=elevatorAt(world.city.data.elevators??[],p);
  if(!e)return false;
  p.power?.cancel?.();p.vel.set(0,0,0);p.pos.fromArray(e.target);
  p.groundY=e.target[1];p.grounded=true;p.airTime=0;p.slamDive=false;
  p.heading=e.yaw;p.holder.position.copy(p.pos);p.cape?.reset();
  world.cameraRig.yaw=e.yaw;world.cameraRig.pitch=-.08;world.cameraRig._init=false;
  world.notify(e.arrival??e.label);
  return true;
}

export class ElevatorPrompt {
  constructor(world){
    this.world=world;this.el=document.createElement('div');this.el.id='elevator-prompt';
    Object.assign(this.el.style,{position:'fixed',bottom:'110px',left:'50%',transform:'translateX(-50%)',padding:'12px 20px',background:'#142631eb',color:'#fff3d9',border:'1px solid #a4b5bb',borderRadius:'8px',font:'600 15px system-ui',pointerEvents:'none',display:'none',zIndex:'20'});
    document.body.append(this.el);
  }
  update(){const e=elevatorAt(this.world.city.data.elevators??[],this.world.player);this.el.style.display=e&&!this.world.menu?.open?'block':'none';if(e)this.el.textContent=`[E] ${e.label}`;}
}
