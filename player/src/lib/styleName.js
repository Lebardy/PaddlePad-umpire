// ============================================================
// A playstyle name without the model's label for the player's group.
//
// The pipeline starts every style name with a word for the skill group
// it was found in: "Developing", "Intermediate", "Advanced" -- or, once
// it finds more than three groups, "Group 3". A number like that means
// nothing to a player and makes them wonder what groups 1 and 2 are,
// and the rating screen's ladder already shows where their group sits.
// So the prefix is dropped whatever it is, and every name reads the
// same way: "Erratic Patient All-Court Player".
//
// The prefix is worked out from the group's own name the same way the
// pipeline does (_skill_group_prefix in ml/pipeline/clustering.py), so
// a trait word that happens to look like a level is never removed.
// ============================================================

const KNOWN = {
  'Developing / Lower-Performance': 'Developing',
  'Higher-Performance': 'Advanced',
}

function prefixFor(group) {
  return KNOWN[group] ?? group.replace('-Performance', '').replace('Performance Group', 'Group')
}

export function styleName(name, group) {
  if (!name || !group) return name
  const prefix = `${prefixFor(group)} `
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}
