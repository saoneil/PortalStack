function placeAthletesDelayedConfrontation(competitors, bracketSize) {
  const m = bracketSize;
  const n = competitors.length;
  if (n === 0) return new Array(m).fill(null);

  const teams = {};
  competitors.forEach((comp) => {
    const t = comp.team || '';
    if (!teams[t]) teams[t] = [];
    teams[t].push(comp);
  });

  const sortedTeamKeys = Object.keys(teams).sort((a, b) => {
    const diff = teams[b].length - teams[a].length;
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  const slots = new Array(m).fill(null);

  function emptySlotIndices(indices) {
    return indices.filter((i) => slots[i] == null);
  }

  function pickBestSlot(available) {
    const empty = emptySlotIndices(available);
    if (!empty.length) return null;
    for (const s of empty) {
      const partner = s ^ 1;
      if (partner < m && slots[partner] == null) return s;
    }
    return empty[0];
  }

  function placeMemberInSlot(member, preferred) {
    let candidates = emptySlotIndices(preferred || [...Array(m).keys()]);
    if (!candidates.length) {
      candidates = slots.map((s, i) => (s == null ? i : -1)).filter((i) => i >= 0);
    }
    if (!candidates.length) return false;
    const slot = pickBestSlot(candidates);
    if (slot == null) return false;
    slots[slot] = member;
    return true;
  }

  for (const teamKey of sortedTeamKeys) {
    const members = [...teams[teamKey]].sort(() => Math.random() - 0.5);
    const t = members.length;
    if (t === 1) {
      placeMemberInSlot(members[0]);
      continue;
    }

    const rStar = Math.max(1, Math.floor(Math.log2(m / t)));
    let placed = false;
    for (let r = rStar; r >= 1; r--) {
      const subtreeSize = 1 << r;
      const subAvail = {};
      for (let i = 0; i < m; i++) {
        if (slots[i] == null) {
          const sid = Math.floor(i / subtreeSize);
          if (!subAvail[sid]) subAvail[sid] = [];
          subAvail[sid].push(i);
        }
      }
      const chosenSids = Object.keys(subAvail)
        .map(Number)
        .sort((a, b) => subAvail[b].length - subAvail[a].length)
        .slice(0, t);
      if (chosenSids.length < t) continue;

      let teamPlaced = true;
      members.forEach((member, idx) => {
        const sid = chosenSids[idx];
        if (!placeMemberInSlot(member, subAvail[sid])) teamPlaced = false;
      });
      if (teamPlaced) {
        placed = true;
        break;
      }
    }
    if (!placed) {
      members.forEach((member) => placeMemberInSlot(member));
    }
  }

  const key = (comp) => `${comp.name}|${comp.team}`;
  const placedKeys = new Set(slots.filter(Boolean).map(key));
  competitors.forEach((comp) => {
    if (!placedKeys.has(key(comp))) {
      if (placeMemberInSlot(comp)) placedKeys.add(key(comp));
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    const doubleByes = [];
    const doubleAthletes = [];
    for (let i = 0; i < m - 1; i += 2) {
      if (slots[i] == null && slots[i + 1] == null) doubleByes.push(i);
      else if (slots[i] != null && slots[i + 1] != null) doubleAthletes.push(i);
    }
    while (doubleByes.length && doubleAthletes.length) {
      const byeIdx = doubleByes.pop();
      const athIdx = doubleAthletes.pop();
      slots[byeIdx] = slots[athIdx + 1];
      slots[athIdx + 1] = null;
      changed = true;
    }
  }

  return slots;
}

function singleElimBracketSize(athleteCount) {
  const n = Math.max(0, Number(athleteCount) || 0);
  if (n <= 1) return 2;
  let slots = 2;
  while (slots < n) slots *= 2;
  return slots;
}

function poolCountForPremier(competitorCount) {
  const n = competitorCount;
  if (n < 6) throw new Error('Premier League auto-pooling requires at least 6 athletes.');
  if (n <= 10) return 2;
  if (n <= 20) return 4;
  return 8;
}

function assignCompetitorsToPools(competitors, poolCount) {
  const total = competitors.length;
  if (poolCount <= 0) throw new Error('Pool count must be positive.');
  if (total < poolCount) throw new Error('Not enough competitors to populate all pools.');
  if (total > poolCount * 5) throw new Error('Too many competitors for pool cap of 5 athletes per pool.');

  const baseSize = Math.floor(total / poolCount);
  const remainder = total % poolCount;
  const targetSizes = Array.from({ length: poolCount }, (_, i) => baseSize + (i < remainder ? 1 : 0));
  if (targetSizes.some((sz) => sz > 5)) {
    throw new Error('Computed pool target exceeds 5 athletes in at least one pool.');
  }

  const pools = Array.from({ length: poolCount }, () => []);
  const teamCounts = Array.from({ length: poolCount }, () => ({}));
  const teams = {};
  competitors.forEach((comp) => {
    const teamKey = String(comp.team || '').trim();
    if (!teams[teamKey]) teams[teamKey] = [];
    teams[teamKey].push(comp);
  });

  const orderedTeamKeys = Object.keys(teams).sort((a, b) => {
    const diff = teams[b].length - teams[a].length;
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  for (const teamKey of orderedTeamKeys) {
    for (const member of teams[teamKey]) {
      let bestPoolIdx = null;
      let bestKey = null;
      for (let idx = 0; idx < poolCount; idx++) {
        if (pools[idx].length >= targetSizes[idx]) continue;
        const candidate = [teamCounts[idx][teamKey] || 0, pools[idx].length, idx];
        if (bestKey == null || candidate[0] < bestKey[0] ||
          (candidate[0] === bestKey[0] && candidate[1] < bestKey[1]) ||
          (candidate[0] === bestKey[0] && candidate[1] === bestKey[1] && candidate[2] < bestKey[2])) {
          bestKey = candidate;
          bestPoolIdx = idx;
        }
      }
      if (bestPoolIdx == null) throw new Error('Could not assign competitors to pools without exceeding targets.');
      pools[bestPoolIdx].push(member);
      teamCounts[bestPoolIdx][teamKey] = (teamCounts[bestPoolIdx][teamKey] || 0) + 1;
    }
  }

  pools.forEach((group, idx) => {
    if (group.length < 2 || group.length > 5) {
      throw new Error(`Pool ${idx + 1} has invalid size: ${group.length}.`);
    }
  });
  return pools;
}

module.exports = {
  placeAthletesDelayedConfrontation,
  singleElimBracketSize,
  poolCountForPremier,
  assignCompetitorsToPools
};
