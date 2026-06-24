export const kWhCost = (kWh, rate = 14) => +(((kWh || 0) * rate)).toFixed(2);
export const energyPer1000 = (kWh, pieces) =>
  pieces > 0 ? +(((kWh || 0) / pieces) * 1000).toFixed(2) : null;
