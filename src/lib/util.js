export function utilSummary(days) {
  const sum = (f) => (days || []).reduce((a, d) => a + (d[f] || 0), 0);
  const laserOnH = +sum('laserOnH').toFixed(2);
  const idleH = +sum('idleTimeH').toFixed(2);
  const processingH = +sum('processingH').toFixed(2);
  const activeH = +sum('activeH').toFixed(2);
  const alarmMin = +sum('alarmTimeMin').toFixed(1);
  const gasOnH = +sum('gasOnH').toFixed(2);
  const laserUtilPct = activeH ? +((laserOnH / activeH) * 100).toFixed(1) : 0;
  return { laserOnH, idleH, processingH, activeH, alarmMin, gasOnH, laserUtilPct };
}

const STATES = {
  RUNNING: { text: 'Running', tone: 'good' },
  IDLE: { text: 'Idle', tone: 'warn' },
  ALARM: { text: 'Alarm', tone: 'bad' },
  OFFLINE: { text: 'Offline', tone: 'mut' },
  UNKNOWN: { text: 'Unknown', tone: 'mut' },
};
export const stateLabel = (s) => STATES[String(s || '').toUpperCase()] || { text: 'Unknown', tone: 'mut' };
