// Shared 8-color palette used to assign colors to the original seeded categories.
// Order matches the ADR-023 seed table: food, drinks, transport, shopping, alcohol,
// fun, bills, travel — each outgoing seed category consumes exactly one slot, in order.
//
// Any new category (e.g. "miscellaneous", or future user-added categories) cannot reuse
// a palette slot since all 8 are exhausted by the original 8 outgoing seeds; color
// assignment for those falls back to a deterministic name-hash -> HSL -> hex derivation
// (see server/src/migrations/003_categories.sql header comment for the frozen
// 'miscellaneous' value and how it was computed). Backend color-assignment code for
// future user-added categories should reuse the same hash-fallback algorithm and consult
// this PALETTE array first to confirm no exact collision before freezing a new hex.
export const PALETTE = [
  '#CC785C', // food
  '#4FB3A7', // drinks
  '#D4A24E', // transport
  '#7C8CDE', // shopping
  '#C06A9E', // alcohol
  '#5FA85A', // fun
  '#B4754A', // bills
  '#8A8F98', // travel
];
