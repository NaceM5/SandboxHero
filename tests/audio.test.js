import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CUES, LOOP_FILES, GameAudio } from '../src/fx/Audio.js';

class Param {
  constructor () { this.value = 0; }
  setTargetAtTime (v) { assert.ok(Number.isFinite(v)); this.value = v; }
}
class Node {
  constructor () {
    for (const k of ['gain', 'frequency', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release', 'playbackRate', 'Q']) this[k] = new Param();
  }
  connect (node) { return node; }
  disconnect () { this.disconnected = true; }
  start () { this.started = true; }
  stop () { this.stopped = true; }
}
class Context {
  constructor () { this.state = 'running'; this.currentTime = 1; this.destination = new Node(); this.nodes = []; }
  createGain () { const n = new Node(); this.nodes.push(n); return n; }
  createBufferSource () { return this.createGain(); }
  createBiquadFilter () { return this.createGain(); }
  createStereoPanner () { return this.createGain(); }
  createDynamicsCompressor () { return this.createGain(); }
  async decodeAudioData (data) { return { duration: 1, data }; }
  suspend () { this.state = 'suspended'; return Promise.resolve(); }
  resume () { this.state = 'running'; return Promise.resolve(); }
}

test('sample loading, variations, stereo direction, caps, cleanup and focus', async () => {
  globalThis.document = { hidden: false, addEventListener () {} };
  globalThis.window = { AudioContext: Context };
  globalThis.fetch = async url => ({ ok: true, arrayBuffer: async () => readFile(url) });
  const settings = { soundVolume: .7, soundMuted: false };
  const world = {
    settings: { get: k => settings[k] }, input: { locked: true }, menu: { open: false },
    player: { pos: { x: 0, y: 0, z: 0 }, vel: { length: () => 60 }, flying: true, powerIndex: 0 },
    effects: { beams: [] }, cameraRig: { yaw: 0 }
  };
  const audio = new GameAudio(world);
  audio.play('blast'); assert.equal(audio.ctx, null);
  audio.unlock(); audio.update(.016); await audio.ready;
  assert.deepEqual(audio.failed, []);
  assert.equal(audio.buffers.size, new Set([...Object.values(CUES).flatMap(c => c.files), ...LOOP_FILES]).size);
  audio.update(.016);
  assert.equal(audio.master.gain.value, .7);
  assert.ok(audio.loops.get('wind').gain.gain.value > 0);
  audio.play('blast', { x: 1000, y: 0, z: 0 }); assert.equal(audio.voices, 0);
  audio.play('blast'); assert.equal(audio.voices, 1);
  audio.play('blast'); assert.equal(audio.voices, 1);
  const voice = audio.ctx.nodes.find(n => n.onended);
  voice.onended(); assert.equal(audio.voices, 0); assert.ok(voice.disconnected);
  audio.play('impact', { x: -8, y: 0, z: 0 });
  assert.ok(audio.ctx.nodes.at(-1).pan.value > 0, 'camera-right source pans right');
  const previous = audio.previous.get('impact'); audio.ctx.currentTime++;
  audio.play('impact'); assert.notEqual(audio.previous.get('impact'), previous);
  for (let i = 0; i < 30; i++) { audio.ctx.currentTime++; audio.play('impact'); }
  assert.equal(audio.voices, 24);
  settings.soundMuted = true; audio.update(.016); assert.equal(audio.master.gain.value, 0);
  audio.ctx.currentTime += 5; audio.update(.016); assert.equal(audio.loops.size, 0);
  settings.soundMuted = false; world.menu.open = true; audio.update(.016);
  assert.equal(audio.master.gain.value, 0); assert.equal(audio.active, false);
  world.menu.open = false; document.hidden = true; audio.update(.016); assert.equal(audio.active, false);
  document.hidden = false; world.input.locked = false; audio.update(.016); assert.equal(audio.master.gain.value, 0);
  // Every cue maps to a real local recording.
  for (const cue of Object.values(CUES)) for (const file of cue.files) assert.ok(audio.buffers.has(file));
});


test('material collisions scale with speed and mass, suppress rest and repeated contacts', () => {
  const audio = Object.create(GameAudio.prototype);
  audio.active = true; audio.ctx = { currentTime: 1 }; audio.contacts = new WeakMap();
  const calls = []; audio.play = (...args) => calls.push(args);
  const body = {}, pos = { x: 0, y: 0, z: 0 };
  audio.collision('lamp', pos, 1, 1, body); assert.equal(calls.length, 0);
  audio.collision('lamp', pos, 8, 1, body); assert.equal(calls[0][0], 'metalCrash');
  audio.collision('lamp', pos, 25, 1, body); assert.equal(calls.length, 1);
  audio.ctx.currentTime += .2;
  audio.collision('lamp', pos, 25, 2, body); assert.ok(calls[1][2] > calls[0][2]);
  for (const [kind,cue] of [['tree','woodCrash'],['bench','woodCrash'],['rock','stoneCrash'],['car','carCrash'],['water','splash']]) {
    audio.collision(kind, pos, 15); assert.equal(calls.at(-1)[0], cue);
  }
  audio.active = false; const count = calls.length;
  audio.collision('rock', pos, 100); assert.equal(calls.length, count);
});

test('ambience follows coast, altitude, shelter and daylight, with an independent volume', () => {
  const audio = Object.create(GameAudio.prototype);
  let water = false, covered = false;
  const settings = { soundVolume: .7, ambienceVolume: .65 };
  audio.world = {
    settings: { get: k => settings[k] }, input: { locked: true }, menu: { open: false }, sky: { night: 0 },
    player: { pos: {x:0,y:0,z:0}, vel: {length:()=>0}, powerIndex: 0 }, effects: {beams:[]},
    city: {isWater:()=>water,groundSurface:()=>0,covered:()=>covered},
    roads: {nearestWalkNode:()=>({x:0,z:0,busy:.8})}
  };
  audio.ctx = {currentTime:1}; audio.master={gain:new Param()}; audio.environmentTimer=0;
  const levels = {}; audio.setLoop=(name,volume)=>{levels[name]=volume};
  const update=()=>{audio.environmentTimer=0;audio.update(.1)};
  update(); const street=levels.city; assert.ok(street>0); assert.equal(levels.ocean,0);
  audio.world.player.pos.y=500; update(); assert.ok(levels.city<street*.2);
  audio.world.player.pos.y=0; covered=true;update();assert.ok(levels.city<street*.3);
  covered=false;water=true;update();assert.ok(levels.ocean>0);assert.equal(levels.birds,0);
  water=false;audio.world.roads.nearestWalkNode=()=>({x:1000,z:1000,busy:.1});update();assert.ok(levels.birds>0);
  audio.world.sky.night=1;update();assert.equal(levels.birds,0);
  settings.ambienceVolume=0;update();assert.equal(levels.city+levels.ocean+levels.birds+levels.wind,0);
  assert.equal(audio.master.gain.value,.7,'ambience mute preserves action volume');
});
