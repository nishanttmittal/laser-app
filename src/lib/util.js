// Period utilization from the time_periods-derived day fields — the SAME metrics the
// Dashboard tile shows (powered-on %, cutting % of on-time, offline). One definition.
export function periodUtil(days) {
  const u = (days || []).filter((d) => d.runningH != null);
  const sum = (f) => u.reduce((a, d) => a + (d[f] || 0), 0);
  const runningH = +sum('runningH').toFixed(1);
  const workH = +sum('workH').toFixed(1);
  const offlineH = +sum('offlineH').toFixed(1);
  const idleH = +Math.max(0, runningH - workH).toFixed(1); // on but not cutting (incl pause)
  const alarmCount = u.reduce((a, d) => a + (d.alarmCount || 0), 0);
  const alarmH = +sum('alarmPeriodH').toFixed(2);
  const nDays = u.length;
  const powerOnPct = nDays ? +((runningH / (nDays * 24)) * 100).toFixed(1) : 0;
  const workUtilPct = runningH ? +((workH / runningH) * 100).toFixed(1) : 0;
  return { nDays, runningH, workH, offlineH, idleH, alarmCount, alarmH, powerOnPct, workUtilPct };
}

const STATES = {
  RUNNING: { text: 'Running', tone: 'good' },
  IDLE: { text: 'Idle', tone: 'warn' },
  ALARM: { text: 'Alarm', tone: 'bad' },
  OFFLINE: { text: 'Offline', tone: 'mut' },
  UNKNOWN: { text: 'Unknown', tone: 'mut' },
};
export const stateLabel = (s) => STATES[String(s || '').toUpperCase()] || { text: 'Unknown', tone: 'mut' };
