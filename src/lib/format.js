export const rupee = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('en-IN'));
export const prettyYmd = (s) => { s = String(s); return `${s.slice(6, 8)}-${s.slice(4, 6)}-${s.slice(0, 4)}`; };
export const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const whenStr = (s) => {
  if (!s) return '';
  const [d, t] = String(s).split(' ');
  const p = d.split('-');
  return `${p[2]} ${MON[+p[1]]} · ${(t || '').slice(0, 5)}`;
};
