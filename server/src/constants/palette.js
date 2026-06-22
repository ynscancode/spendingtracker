// Shared 8-color palette used to assign colors to the original seeded categories.
// Order matches the ADR-023 seed table: food, drinks, transport, shopping, alcohol,
// fun, bills, travel — each outgoing seed category consumes exactly one slot, in order.
//
// Hues are spaced 36 degrees apart around the wheel (10 slots total across this
// palette plus 'miscellaneous'/'income'/'other' below) so that no two categories
// read as the same color at a glance — see server/src/migrations/005_recolor_categories.sql
// for the full set and server/src/services/categoryService.js's assignColor() for how
// future user-added categories get a hue at least 30 degrees from every color already
// in use on that account, rather than just an exact-hex check.
//
// Any new category (e.g. "miscellaneous", or future user-added categories) cannot reuse
// a palette slot since all 8 are exhausted by the original 8 outgoing seeds; color
// assignment for those falls back to assignColor()'s hue-distance search.
export const PALETTE = [
  '#C76060', // food
  '#60C7C7', // drinks
  '#C79E60', // transport
  '#7560C7', // shopping
  '#B360C7', // alcohol
  '#75C760', // fun
  '#C7609E', // bills
  '#8A8F98', // travel
];
