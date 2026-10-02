/** AD&D 2e initiative: d10, lowest result acts first. */
export default class AD2ECombat extends Combat {
  _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : Infinity;
    return (ia - ib) || a.name.localeCompare(b.name) || (a.id > b.id ? 1 : -1);
  }
}
