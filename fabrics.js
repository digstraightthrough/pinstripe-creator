// Fabric models and their maximum rapport (repeat length) in millimetres.
// To add or change a fabric, edit this list: one line per fabric.
const FABRICS = [
  { code: 'Q103', maxRapport: 16 },
  { code: 'S300', maxRapport: 48 },
  { code: 'S301', maxRapport: 46 },
  { code: 'Z103', maxRapport: 46 },
  { code: 'T1',   maxRapport: 26 },
  { code: 'V2',   maxRapport: 26 },
];

// The fabric a new design starts with.
const DEFAULT_FABRIC = 'S300';
