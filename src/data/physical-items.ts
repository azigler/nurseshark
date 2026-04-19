// Physical medical items (Bandage, Gauze, Ointment, Regenerative Mesh,
// Medicated Suture, Blood Pack, Tourniquet, etc). As of vs-3il.2 this module
// NO LONGER hand-models heal amounts — the full list is extracted at build
// time by `src/gen/resolve-physical-items.ts` from the VS14 YAML and shipped
// as `public/data/physical-items.json`. Load it via `useData()` /
// `data.physicalItems` or `data.physicalItemsById`.
//
// This file stays as a tiny shim so any legacy `import { PhysicalItem }`
// still resolves. The canonical type definition lives in `../types.ts`.

export type { PhysicalItem } from '../types';
