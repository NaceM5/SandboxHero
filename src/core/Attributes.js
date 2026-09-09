/** Attributes reachable in-game with Alt + scroll, in slot order. */
export const QUICK_ATTRS = [
  { k: 'strength',    label: 'Strength',     min: 0.2, max: 8,    step: 0.2, fmt: v => '×' + v.toFixed(1) },
  { k: 'jogSpeed',    label: 'Jog speed',    min: 0.3, max: 6,    step: 0.2, fmt: v => '×' + v.toFixed(1) },
  { k: 'sprintSpeed', label: 'Sprint speed', min: 0.3, max: 8,    step: 0.2, fmt: v => '×' + v.toFixed(1) },
  { k: 'jumpPower',   label: 'Jump power',   min: 0.5, max: 8,    step: 0.2, fmt: v => '×' + v.toFixed(1) },
  { k: 'flightSpeed', label: 'Flight speed', min: 0.3, max: 5,    step: 0.2, fmt: v => '×' + v.toFixed(1) },
  { k: 'flightAccel', label: 'Flight accel', min: 0.3, max: 5,    step: 0.2, fmt: v => '×' + v.toFixed(1) },
  { k: 'boostSpeed',  label: 'Sprint fly speed', min: 0.3, max: 5, step: 0.2, fmt: v => '×' + v.toFixed(1) },
  { k: 'boostAccel',  label: 'Sprint fly accel', min: 0.3, max: 5, step: 0.2, fmt: v => '×' + v.toFixed(1) },
  { k: 'maxHealth',   label: 'Max health',   min: 50,  max: 2000, step: 50,  fmt: v => String(Math.round(v)) }
];
