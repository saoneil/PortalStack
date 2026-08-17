/**
 * Seed varied fake draws_results for event 4 ("King of PMA V").
 *
 * Usage:
 *   node sql/run_seed_fake_draw_results_event4.js
 *
 * PL overall ranks are elim-based (PDF also derives them from matches):
 *   1 = final winner, 2 = final loser,
 *   SF losers tied for 3rd unless a bronze match sets 3rd/4th.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const EVENT_ID = 4;
const EVENT_NAME = 'King of PMA V';
const CLUBS = ['club:PMA', 'club:AITFC', 'club:X', 'club:Y', 'province:ON', 'country:CAN'];

const FIRST = [
  'Ava', 'Mia', 'Zoe', 'Liam', 'Noah', 'Ethan', 'Owen', 'Mason', 'Lucas', 'Jordan',
  'Casey', 'Riley', 'Taylor', 'Sam', 'Alex', 'Jamie', 'Chris', 'Nina', 'Kai', 'Quinn',
  'Blake', 'Drew', 'Harper', 'Skyler', 'Reese', 'Finley', 'Rowan', 'Parker', 'Cameron', 'Morgan',
  'Aiden', 'Elena', 'Sofia', 'Marcus', 'Ivy', 'Leo', 'Nora', 'Felix', 'Chloe', 'Hugo'
];
const LAST = [
  'Nguyen', 'Torres', 'Park', 'Chen', 'Kim', 'Brooks', 'Diaz', 'Lee', 'Reed', 'Blake',
  'Morgan', 'Quinn', 'Shaw', 'Rivera', 'Ortiz', 'Patel', 'Singh', 'Walsh', 'Cruz', 'Hayes',
  'Bennett', 'Cole', 'Dunn', 'Ford', 'Grant', 'Hart', 'Ives', 'Jones', 'King', 'Lopez',
  'Moore', 'Nash', 'Owen', 'Price', 'Ross', 'Stone', 'Tran', 'Underwood', 'Vega', 'West'
];

function athlete(i, clubIdx = i) {
  const name = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`;
  return {
    id: `a${i + 1}`,
    name,
    country: CLUBS[clubIdx % CLUBS.length],
    competitor_id: name
  };
}

function athletes(n) {
  return Array.from({ length: n }, (_, i) => athlete(i));
}

function baseMeta(drawId, divisionType, divisionName, eventKey) {
  return {
    draw_id: String(drawId),
    event_id: EVENT_ID,
    event_name: EVENT_NAME,
    category_id: divisionName,
    division_name: divisionName,
    division_type: divisionType,
    event_key: eventKey,
    completed: true,
    completed_at: new Date().toISOString(),
    app_url: 'https://example.local/fake-results'
  };
}

function buildRoundRobin(drawId, n, label) {
  const people = athletes(n);
  const matches = [];
  let m = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      m += 1;
      const redWins = (i + j + m) % 3 !== 0;
      const red = people[i];
      const blue = people[j];
      matches.push({
        match_id: `Match ${m}`,
        draw_label: `Match ${m}`,
        stage: null,
        pool_id: null,
        round_id: null,
        is_custom: false,
        winner: redWins ? 'hong' : 'chong',
        red: { name: red.name, country: red.country, bye: false, competitor_id: red.id },
        blue: { name: blue.name, country: blue.country, bye: false, competitor_id: blue.id },
        overall_scores: {
          redOverall: redWins ? 4 : 1,
          blueOverall: redWins ? 1 : 4
        },
        referee_scores: null
      });
    }
  }
  const wins = Object.fromEntries(people.map((p) => [p.id, 0]));
  matches.forEach((match) => {
    const winnerId = match.winner === 'hong'
      ? match.red.competitor_id
      : match.blue.competitor_id;
    wins[winnerId] = (wins[winnerId] || 0) + 1;
  });
  const ranked = [...people].sort((a, b) => (wins[b.id] || 0) - (wins[a.id] || 0));
  const placements = ranked.map((p, idx) => ({
    rank: idx + 1,
    name: p.name,
    country: p.country,
    competitor_id: p.id,
    wins: wins[p.id] || 0,
    losses: (n - 1) - (wins[p.id] || 0),
    refereesFor: (wins[p.id] || 0) * 4,
    refereesAgainst: ((n - 1) - (wins[p.id] || 0)) * 4,
    pointsFor: (wins[p.id] || 0) * 4,
    pointsAgainst: ((n - 1) - (wins[p.id] || 0)) * 4
  }));
  return {
    draw_id: drawId,
    result: {
      ...baseMeta(drawId, 'round-robin', label, 'individual_patterns'),
      list_athletes: null,
      placements,
      matches
    }
  };
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function roundDefsForSize(bracketSize) {
  const rounds = [];
  let size = bracketSize;
  let order = 1;
  while (size >= 2) {
    let round_id;
    let name;
    if (size === 2) {
      round_id = 'F';
      name = 'Final';
    } else if (size === 4) {
      round_id = 'SF';
      name = 'Semi-Final';
    } else if (size === 8) {
      round_id = 'QF';
      name = 'Quarter-Final';
    } else {
      round_id = `R${size}`;
      name = `Round of ${size}`;
    }
    rounds.push({ round_id, name, order });
    order += 1;
    size /= 2;
  }
  return rounds;
}

function buildSingleElim(drawId, n, label) {
  const people = athletes(n);
  const bracketSize = nextPow2(n);
  const slots = Array.from({ length: bracketSize }, (_, i) => (i < n ? people[i] : null));
  const rounds = roundDefsForSize(bracketSize);
  const resultMatches = [];
  const bracketMatches = [];
  const roundSlots = [];

  const r1Count = bracketSize / 2;
  const r1 = [];
  for (let i = 0; i < r1Count; i += 1) {
    const redAth = slots[2 * i];
    const blueAth = slots[2 * i + 1];
    const match_id = rounds[0].round_id === 'F' ? 'F' : `${rounds[0].round_id}${i + 1}`;
    const red = redAth
      ? { name: redAth.name, country: redAth.country, bye: false, competitor_id: redAth.id }
      : { bye: true, name: 'BYE' };
    const blue = blueAth
      ? { name: blueAth.name, country: blueAth.country, bye: false, competitor_id: blueAth.id }
      : { bye: true, name: 'BYE' };
    let winnerSide = 'hong';
    let winnerAth = redAth;
    if (red.bye && !blue.bye) {
      winnerSide = 'chong';
      winnerAth = blueAth;
    } else if (!red.bye && blue.bye) {
      winnerSide = 'hong';
      winnerAth = redAth;
    } else if (!red.bye && !blue.bye) {
      winnerSide = i % 2 === 0 ? 'hong' : 'chong';
      winnerAth = winnerSide === 'hong' ? redAth : blueAth;
    }
    const scored = !red.bye && !blue.bye;
    const row = {
      match_id,
      draw_label: match_id,
      stage: rounds[0].name.toLowerCase().replace(/\s+/g, '_'),
      pool_id: null,
      round_id: rounds[0].round_id,
      is_custom: false,
      winner: scored || red.bye || blue.bye ? winnerSide : null,
      red,
      blue,
      overall_scores: scored
        ? {
          redOverall: winnerSide === 'hong' ? 5 : 2,
          blueOverall: winnerSide === 'chong' ? 5 : 2
        }
        : null
    };
    resultMatches.push(row);
    bracketMatches.push({
      match_id,
      draw_label: match_id,
      round_id: rounds[0].round_id,
      aka: { ...red },
      ao: { ...blue }
    });
    r1.push({
      match_id,
      winner: winnerAth
        ? { name: winnerAth.name, country: winnerAth.country, competitor_id: winnerAth.id }
        : null,
      loser: scored
        ? (winnerSide === 'hong'
          ? { name: blueAth.name, country: blueAth.country, competitor_id: blueAth.id }
          : { name: redAth.name, country: redAth.country, competitor_id: redAth.id })
        : null,
      red,
      blue
    });
  }
  roundSlots.push(r1);

  for (let ri = 1; ri < rounds.length; ri += 1) {
    const prev = roundSlots[ri - 1];
    const cur = [];
    const count = prev.length / 2;
    for (let i = 0; i < count; i += 1) {
      const left = prev[2 * i];
      const right = prev[2 * i + 1];
      const match_id = rounds[ri].round_id === 'F' ? 'F' : `${rounds[ri].round_id}${i + 1}`;
      const redSrc = left.winner;
      const blueSrc = right.winner;
      const red = redSrc
        ? {
          name: redSrc.name,
          country: redSrc.country,
          bye: false,
          competitor_id: redSrc.competitor_id,
          source_match_id: left.match_id
        }
        : { bye: true, name: 'BYE', source_match_id: left.match_id };
      const blue = blueSrc
        ? {
          name: blueSrc.name,
          country: blueSrc.country,
          bye: false,
          competitor_id: blueSrc.competitor_id,
          source_match_id: right.match_id
        }
        : { bye: true, name: 'BYE', source_match_id: right.match_id };
      const winnerSide = i % 2 === 0 ? 'hong' : 'chong';
      const winnerAth = winnerSide === 'hong' ? redSrc : blueSrc;
      const loserAth = winnerSide === 'hong' ? blueSrc : redSrc;
      const row = {
        match_id,
        draw_label: match_id,
        stage: rounds[ri].name.toLowerCase().replace(/\s+/g, '_'),
        pool_id: null,
        round_id: rounds[ri].round_id,
        is_custom: false,
        winner: winnerSide,
        red: {
          name: red.name,
          country: red.country,
          bye: !!red.bye,
          competitor_id: red.competitor_id
        },
        blue: {
          name: blue.name,
          country: blue.country,
          bye: !!blue.bye,
          competitor_id: blue.competitor_id
        },
        overall_scores: {
          redOverall: winnerSide === 'hong' ? 4 : 1,
          blueOverall: winnerSide === 'chong' ? 4 : 1
        }
      };
      resultMatches.push(row);
      bracketMatches.push({
        match_id,
        draw_label: match_id,
        round_id: rounds[ri].round_id,
        aka: { ...red },
        ao: { ...blue }
      });
      cur.push({ match_id, winner: winnerAth, loser: loserAth, red, blue });
    }
    roundSlots.push(cur);
  }

  const finalRound = roundSlots[roundSlots.length - 1][0];
  const champion = finalRound?.winner;
  const silver = finalRound?.loser;
  const sfRound = roundSlots.length >= 2 ? roundSlots[roundSlots.length - 2] : [];
  const bronzeTied = (sfRound || [])
    .map((m) => m.loser)
    .filter(Boolean)
    .filter((p) => p.competitor_id !== champion?.competitor_id
      && p.competitor_id !== silver?.competitor_id);

  const placements = [];
  if (champion) {
    placements.push({
      rank: 1,
      medal: 'gold',
      name: champion.name,
      country: champion.country,
      competitor_id: champion.competitor_id
    });
  }
  if (silver) {
    placements.push({
      rank: 2,
      medal: 'silver',
      name: silver.name,
      country: silver.country,
      competitor_id: silver.competitor_id
    });
  }
  bronzeTied.forEach((p) => {
    placements.push({
      rank: 3,
      medal: 'bronze',
      tied: true,
      name: p.name,
      country: p.country,
      competitor_id: p.competitor_id
    });
  });

  return {
    draw_id: drawId,
    result: {
      ...baseMeta(drawId, 'single-elimination', label, 'individual_sparring'),
      list_athletes: null,
      rounds,
      bracket_matches: bracketMatches,
      placements,
      matches: resultMatches
    }
  };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.withBronze] include bronze match between SF losers
 */
function buildPremierLeague(drawId, poolCount, perPool, label, opts = {}) {
  const withBronze = !!opts.withBronze;
  const pools = [];
  const people = [];
  let idx = 0;
  for (let p = 0; p < poolCount; p += 1) {
    const ids = [];
    for (let a = 0; a < perPool; a += 1) {
      const ath = athlete(idx, idx);
      people.push(ath);
      ids.push(ath.id);
      idx += 1;
    }
    pools.push({ pool_id: String.fromCharCode(65 + p), competitor_ids: ids });
  }

  const poolPlacements = [];
  const matches = [];
  pools.forEach((pool) => {
    const members = pool.competitor_ids.map((id) => people.find((x) => x.id === id));
    members.forEach((m, i) => {
      poolPlacements.push({
        pool_id: pool.pool_id,
        rank: i + 1,
        name: m.name,
        country: m.country,
        competitor_id: m.id,
        wins: perPool - 1 - i,
        losses: i
      });
    });
    let mi = 0;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        mi += 1;
        const redWins = i < j;
        matches.push({
          match_id: `${pool.pool_id}${mi}`,
          draw_label: `Pool ${pool.pool_id} - Match ${mi}`,
          pool_id: pool.pool_id,
          stage: 'pool',
          round_id: null,
          is_custom: false,
          winner: redWins ? 'hong' : 'chong',
          red: { name: members[i].name, country: members[i].country, bye: false },
          blue: { name: members[j].name, country: members[j].country, bye: false },
          overall_scores: {
            redOverall: redWins ? 4 : 1,
            blueOverall: redWins ? 1 : 4
          }
        });
      }
    }
  });

  const advancePerPool = poolCount >= 4 ? 1 : Math.min(2, perPool);
  const elimSeeds = pools.flatMap((pool) => poolPlacements
    .filter((x) => x.pool_id === pool.pool_id)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, advancePerPool));

  const elimination = { matches: [] };
  const sideOf = (p) => ({
    name: p.name,
    country: p.country,
    competitor_id: p.competitor_id
  });
  const pushElimResult = (em, winner, roundId) => {
    matches.push({
      match_id: em.match_id,
      draw_label: em.stage,
      pool_id: null,
      stage: em.stage,
      round_id: roundId,
      is_custom: false,
      winner,
      red: { name: em.aka.name, country: em.aka.country, bye: false, competitor_id: em.aka.competitor_id },
      blue: { name: em.ao.name, country: em.ao.country, bye: false, competitor_id: em.ao.competitor_id },
      overall_scores: {
        redOverall: winner === 'hong' ? 5 : 2,
        blueOverall: winner === 'chong' ? 5 : 2
      }
    });
  };

  let gold = null;
  let silver = null;
  let third = [];
  let fourth = null;

  if (elimSeeds.length >= 4) {
    const sf1 = {
      match_id: 'SF1',
      stage: 'Semi-Final',
      aka: sideOf(elimSeeds[0]),
      ao: sideOf(elimSeeds[3])
    };
    const sf2 = {
      match_id: 'SF2',
      stage: 'Semi-Final',
      aka: sideOf(elimSeeds[1]),
      ao: sideOf(elimSeeds[2])
    };
    // SF1: hong wins -> seed0; SF2: chong wins -> seed2
    const sf1Winner = elimSeeds[0];
    const sf1Loser = elimSeeds[3];
    const sf2Winner = elimSeeds[2];
    const sf2Loser = elimSeeds[1];
    const fin = {
      match_id: 'F',
      stage: 'Final',
      aka: sideOf(sf1Winner),
      ao: sideOf(sf2Winner)
    };
    elimination.matches.push(sf1, sf2, fin);
    pushElimResult(sf1, 'hong', 'SF');
    pushElimResult(sf2, 'chong', 'SF');
    pushElimResult(fin, 'hong', 'F');
    gold = sf1Winner;
    silver = sf2Winner;

    if (withBronze) {
      const br = {
        match_id: 'BR',
        stage: 'Bronze',
        aka: sideOf(sf1Loser),
        ao: sideOf(sf2Loser)
      };
      elimination.matches.push(br);
      pushElimResult(br, 'hong', 'BR');
      third = [sf1Loser];
      fourth = sf2Loser;
    } else {
      third = [sf1Loser, sf2Loser];
    }
  } else if (elimSeeds.length === 2) {
    const fin = {
      match_id: 'F',
      stage: 'Final',
      aka: sideOf(elimSeeds[0]),
      ao: sideOf(elimSeeds[1])
    };
    elimination.matches.push(fin);
    pushElimResult(fin, 'hong', 'F');
    gold = elimSeeds[0];
    silver = elimSeeds[1];
  }

  const overall = [];
  if (gold) {
    overall.push({
      rank: 1,
      medal: 'gold',
      name: gold.name,
      country: gold.country,
      competitor_id: gold.competitor_id
    });
  }
  if (silver) {
    overall.push({
      rank: 2,
      medal: 'silver',
      name: silver.name,
      country: silver.country,
      competitor_id: silver.competitor_id
    });
  }
  third.forEach((p) => {
    overall.push({
      rank: 3,
      medal: 'bronze',
      tied: !fourth,
      name: p.name,
      country: p.country,
      competitor_id: p.competitor_id
    });
  });
  if (fourth) {
    overall.push({
      rank: 4,
      medal: null,
      name: fourth.name,
      country: fourth.country,
      competitor_id: fourth.competitor_id
    });
  }

  return {
    draw_id: drawId,
    result: {
      ...baseMeta(drawId, 'premier-league', label, 'individual_patterns'),
      list_athletes: null,
      pools,
      athletes: people,
      elimination,
      // Pool ranks kept for reference; overall is elim-only (PDF derives from matches too).
      placements: [...poolPlacements, ...overall],
      matches
    }
  };
}

function buildList(drawId, n, label) {
  const people = athletes(n).map((p, i) => {
    const techniques = Array.from({ length: 5 }, (_, t) => Math.max(0, 3 - Math.floor((i + t) / 3)));
    const total = techniques.reduce((s, v) => s + v, 0);
    return { ...p, techniques, total };
  }).sort((a, b) => b.total - a.total);
  return {
    draw_id: drawId,
    result: {
      ...baseMeta(drawId, 'list', label, 'individual_power_test'),
      matches: [],
      list_athletes: people.map((p) => ({
        id: p.id,
        name: p.name,
        country: p.country,
        techniques: p.techniques,
        total: p.total
      })),
      placements: people.map((p, i) => ({
        order: i + 1,
        medal: i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : null,
        name: p.name,
        country: p.country,
        competitor_id: p.id,
        total: p.total
      }))
    }
  };
}

function buildCoreNamed() {
  // Real PL 3482: final Liam beats Owen; SF losers Noah + Mason tied for 3rd.
  return [
    {
      draw_id: 3489,
      result: {
        ...baseMeta(3489, 'round-robin',
          'Individual Patterns - 12 To 14 - Female - 4th Gup-1st Gup',
          'individual_patterns'),
        list_athletes: null,
        placements: [
          { rank: 1, name: 'Ava Nguyen', country: 'club:PMA', competitor_id: 'Ava Nguyen', wins: 2, losses: 0, refereesFor: 8, refereesAgainst: 2, pointsFor: 12, pointsAgainst: 4 },
          { rank: 2, name: 'Mia Torres', country: 'club:AITFC', competitor_id: 'Mia Torres', wins: 1, losses: 1, refereesFor: 5, refereesAgainst: 5, pointsFor: 7, pointsAgainst: 7 },
          { rank: 3, name: 'Zoe Park', country: 'club:PMA', competitor_id: 'Zoe Park', wins: 0, losses: 2, refereesFor: 2, refereesAgainst: 8, pointsFor: 3, pointsAgainst: 11 }
        ],
        matches: [
          { match_id: 'Match 1', draw_label: 'Match 1', stage: null, pool_id: null, round_id: null, is_custom: false, winner: 'hong', red: { name: 'Ava Nguyen', country: 'club:PMA', bye: false, competitor_id: 'Ava Nguyen' }, blue: { name: 'Mia Torres', country: 'club:AITFC', bye: false, competitor_id: 'Mia Torres' }, overall_scores: { redOverall: 4, blueOverall: 1 }, referee_scores: null },
          { match_id: 'Match 2', draw_label: 'Match 2', stage: null, pool_id: null, round_id: null, is_custom: false, winner: 'hong', red: { name: 'Ava Nguyen', country: 'club:PMA', bye: false, competitor_id: 'Ava Nguyen' }, blue: { name: 'Zoe Park', country: 'club:PMA', bye: false, competitor_id: 'Zoe Park' }, overall_scores: { redOverall: 4, blueOverall: 1 }, referee_scores: null },
          { match_id: 'Match 3', draw_label: 'Match 3', stage: null, pool_id: null, round_id: null, is_custom: false, winner: 'chong', red: { name: 'Zoe Park', country: 'club:PMA', bye: false, competitor_id: 'Zoe Park' }, blue: { name: 'Mia Torres', country: 'club:AITFC', bye: false, competitor_id: 'Mia Torres' }, overall_scores: { redOverall: 1, blueOverall: 4 }, referee_scores: null }
        ]
      }
    },
    {
      draw_id: 3482,
      result: {
        ...baseMeta(3482, 'premier-league',
          'Individual Patterns - 7 To 9 - Male - 10th Gup-8th Gup',
          'individual_patterns'),
        list_athletes: null,
        placements: [
          { pool_id: 'A', rank: 1, name: 'Liam Chen', country: 'club:PMA', competitor_id: 'Liam Chen', wins: 2, losses: 0 },
          { pool_id: 'A', rank: 2, name: 'Noah Kim', country: 'club:AITFC', competitor_id: 'Noah Kim', wins: 1, losses: 1 },
          { pool_id: 'A', rank: 3, name: 'Ethan Brooks', country: 'club:PMA', competitor_id: 'Ethan Brooks', wins: 0, losses: 2 },
          { pool_id: 'B', rank: 1, name: 'Owen Diaz', country: 'club:AITFC', competitor_id: 'Owen Diaz', wins: 2, losses: 0 },
          { pool_id: 'B', rank: 2, name: 'Mason Lee', country: 'club:PMA', competitor_id: 'Mason Lee', wins: 1, losses: 1 },
          { pool_id: 'B', rank: 3, name: 'Lucas Reed', country: 'club:AITFC', competitor_id: 'Lucas Reed', wins: 0, losses: 2 },
          { rank: 1, medal: 'gold', name: 'Liam Chen', country: 'club:PMA', competitor_id: 'Liam Chen' },
          { rank: 2, medal: 'silver', name: 'Owen Diaz', country: 'club:AITFC', competitor_id: 'Owen Diaz' },
          { rank: 3, medal: 'bronze', tied: true, name: 'Noah Kim', country: 'club:AITFC', competitor_id: 'Noah Kim' },
          { rank: 3, medal: 'bronze', tied: true, name: 'Mason Lee', country: 'club:PMA', competitor_id: 'Mason Lee' }
        ],
        matches: [
          { match_id: 'A1', draw_label: 'Pool A - Match 1', pool_id: 'A', stage: 'pool', round_id: null, is_custom: false, winner: 'hong', red: { name: 'Liam Chen', country: 'club:PMA', bye: false }, blue: { name: 'Noah Kim', country: 'club:AITFC', bye: false }, overall_scores: { redOverall: 5, blueOverall: 2 } },
          { match_id: 'A2', draw_label: 'Pool A - Match 2', pool_id: 'A', stage: 'pool', round_id: null, is_custom: false, winner: 'hong', red: { name: 'Liam Chen', country: 'club:PMA', bye: false }, blue: { name: 'Ethan Brooks', country: 'club:PMA', bye: false }, overall_scores: { redOverall: 4, blueOverall: 1 } },
          { match_id: 'B1', draw_label: 'Pool B - Match 1', pool_id: 'B', stage: 'pool', round_id: null, is_custom: false, winner: 'hong', red: { name: 'Owen Diaz', country: 'club:AITFC', bye: false }, blue: { name: 'Mason Lee', country: 'club:PMA', bye: false }, overall_scores: { redOverall: 3, blueOverall: 2 } },
          { match_id: 'SF1', draw_label: 'Semi-Final 1', pool_id: null, stage: 'Semi-Final', round_id: 'SF', is_custom: false, winner: 'hong', red: { name: 'Liam Chen', country: 'club:PMA', bye: false }, blue: { name: 'Mason Lee', country: 'club:PMA', bye: false }, overall_scores: { redOverall: 4, blueOverall: 0 } },
          { match_id: 'SF2', draw_label: 'Semi-Final 2', pool_id: null, stage: 'Semi-Final', round_id: 'SF', is_custom: false, winner: 'chong', red: { name: 'Noah Kim', country: 'club:AITFC', bye: false }, blue: { name: 'Owen Diaz', country: 'club:AITFC', bye: false }, overall_scores: { redOverall: 1, blueOverall: 4 } },
          { match_id: 'F', draw_label: 'Final', pool_id: null, stage: 'Final', round_id: 'F', is_custom: false, winner: 'hong', red: { name: 'Liam Chen', country: 'club:PMA', bye: false }, blue: { name: 'Owen Diaz', country: 'club:AITFC', bye: false }, overall_scores: { redOverall: 5, blueOverall: 3 } }
        ]
      }
    }
  ];
}

function allEntries() {
  return [
    ...buildCoreNamed(),
    buildRoundRobin(900010, 2, 'DEMO RR - 2 athletes'),
    buildRoundRobin(900011, 5, 'DEMO RR - 5 athletes'),
    buildRoundRobin(900012, 8, 'DEMO RR - 8 athletes'),
    buildPremierLeague(900020, 2, 2, 'DEMO PL - 2 pools x 2'),
    buildPremierLeague(900021, 2, 4, 'DEMO PL - 2 pools x 4'),
    buildPremierLeague(900022, 4, 3, 'DEMO PL - 4 pools x 3'),
    buildPremierLeague(900023, 4, 5, 'DEMO PL - 4 pools x 5'),
    buildPremierLeague(900024, 2, 3, 'DEMO PL - with bronze match', { withBronze: true }),
    buildSingleElim(900001, 4, 'DEMO SE - 4 athletes (SF->Final)'),
    buildSingleElim(900030, 2, 'DEMO SE - 2 athletes (Final only)'),
    buildSingleElim(900031, 8, 'DEMO SE - 8 athletes (QF->Final)'),
    buildSingleElim(900032, 16, 'DEMO SE - 16 athletes (R16->Final)'),
    buildSingleElim(900033, 6, 'DEMO SE - 6 athletes (byes into SF)'),
    buildList(900002, 4, 'DEMO List - 4 athletes'),
    buildList(900040, 2, 'DEMO List - 2 athletes'),
    buildList(900041, 8, 'DEMO List - 8 athletes'),
    buildList(900042, 16, 'DEMO List - 16 athletes')
  ];
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    ssl: { rejectUnauthorized: false }
  });

  const entries = allEntries();
  for (const entry of entries) {
    await c.query(
      `INSERT INTO draws_results (draw_id, event_id, result_json)
       VALUES (?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         event_id = VALUES(event_id),
         result_json = VALUES(result_json),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [entry.draw_id, EVENT_ID, JSON.stringify(entry.result)]
    );
  }

  const [rows] = await c.query(`
    SELECT draw_id, event_id,
           JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.division_type')) AS division_type,
           JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.division_name')) AS division_name
    FROM draws_results
    WHERE event_id = ?
    ORDER BY draw_id
  `, [EVENT_ID]);
  console.log(`Seeded ${entries.length} result rows for event ${EVENT_ID}:`);
  console.table(rows);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
