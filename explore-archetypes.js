#!/usr/bin/env node
/**
 * Dionysus Program Archetype Explorer
 *
 * This program systematically explores the parameter space of the Epimetabolic
 * Equation to discover distinct organizational archetypes and their long-term fates.
 *
 * Usage: node explore-archetypes.js
 */

// ============================================================================
// Constants (structural parameters of social systems)
// ============================================================================
const DEFAULTS = {
  alpha: 0.02,   // Earn Rate: Trust builds slowly
  gamma: 0.10,   // Burn Rate: Trust burns 5x faster than it builds
  delta: 0.05,   // Oligarchic Drift: Power naturally freezes
  kappa: 0.50,   // Hollow Ritual Penalty: Fake ritual is toxic
  lambda: 0.20,  // Aesthetic Multiplier: Beauty is fuel
};

const CYCLES = 200;  // Simulation length
const TRIALS = 10;   // Monte Carlo trials per parameter set (for stochastic C)

// ============================================================================
// Core Simulation Engine
// ============================================================================

/**
 * Simulate the Epimetabolic Equation for a given parameter set.
 * Returns trajectory data and summary metrics.
 *
 * New model includes:
 * - mu_env: Environmental melt (exogenous, not a choice)
 * - mu_choice: Chosen melt (endogenous, deliberate disruption)
 * - S_threshold: Competitive threshold that rises with cumulative mu_env
 * - Two failure modes: internal collapse (R→0) and competitive collapse (S < S_threshold)
 */
function simulate(params, seed = 42) {
  const {
    mu_env,       // Environmental Melt (exogenous)
    mu_choice,    // Chosen Melt (endogenous)
    L,            // Li (Ritual capacity)
    R0,           // Initial Ren (Trust)
    rho,          // Rotation Rate
    beta,         // Beauty
    tau,          // Toxicity
    alpha = DEFAULTS.alpha,
    gamma = DEFAULTS.gamma,
    delta = DEFAULTS.delta,
    kappa = DEFAULTS.kappa,
    lambda = DEFAULTS.lambda,
  } = params;

  // Total melt is sum of environmental and chosen
  const mu = mu_env + mu_choice;

  // Seeded pseudo-random for reproducibility
  const random = seededRandom(seed);

  let S = 10.0;           // Initial Explanatory Reach
  let S_threshold = 10.0; // Competitive threshold starts at initial S
  let R = R0;
  let C = 1.0;

  const trajectory = [];
  let peakS = S;
  let totalGrowth = 0;
  let totalDecay = 0;
  let internalCollapseTime = null;
  let competitiveCollapseTime = null;

  for (let t = 0; t < CYCLES; t++) {
    // Step 1: Calculate Intermediate States
    const Omega = Math.min(L * C, R);
    const Theater = Math.max(0, (L * C) - R);
    const Overflow = Math.max(0, mu - Omega);

    // Step 2: Calculate Growth and Decay Terms
    const safeBeta = Math.max(0.1, beta);
    const G = Math.min(mu, Omega) * (1 + lambda * safeBeta);
    const D = (Overflow ** 2) * tau + (kappa * Theater) / safeBeta;

    totalGrowth += G;
    totalDecay += D;

    // Step 3: Update State Variables
    const deltaS = G - D;
    S += deltaS;
    peakS = Math.max(peakS, S);

    // Competitive threshold rises with environmental melt
    S_threshold += mu_env;

    const R_prev = R;
    R = Math.max(0, R + (alpha * beta * G) - (gamma * D));

    // Stewardship update (stochastic)
    if (random() < rho) {
      C = 1.0;  // Reset
    } else {
      C = C * (1 - delta);  // Drift
    }

    trajectory.push({ t, S, S_threshold, R, C, G, D, Omega, Theater, Overflow });

    // Check for internal collapse (trust death spiral)
    if (R <= 0 && internalCollapseTime === null) {
      internalCollapseTime = t;
    }

    // Check for competitive collapse (outpaced by environment)
    if (S < S_threshold && competitiveCollapseTime === null) {
      competitiveCollapseTime = t;
    }

    if (R <= 0) break;
  }

  const lastState = trajectory[trajectory.length - 1];

  return {
    trajectory,
    summary: {
      finalS: lastState.S,
      finalS_threshold: lastState.S_threshold,
      finalR: lastState.R,
      peakS,
      deltaS: lastState.S - 10,  // Change from initial
      competitiveMargin: lastState.S - lastState.S_threshold,
      internalCollapse: internalCollapseTime !== null,
      internalCollapseTime,
      competitiveCollapse: competitiveCollapseTime !== null,
      competitiveCollapseTime,
      avgGrowth: totalGrowth / trajectory.length,
      avgDecay: totalDecay / trajectory.length,
      survivalRate: trajectory.length / CYCLES,
      steadyStateC: rho / (1 - (1 - rho) * (1 - delta)),  // Analytical expectation
    },
  };
}

/**
 * Run multiple trials and average results (to handle stochastic C).
 */
function simulateWithTrials(params, trials = TRIALS) {
  const results = [];
  for (let i = 0; i < trials; i++) {
    results.push(simulate(params, 42 + i * 1000));
  }

  // Average the summaries
  const avgSummary = {
    finalS: avg(results.map(r => r.summary.finalS)),
    finalS_threshold: avg(results.map(r => r.summary.finalS_threshold)),
    finalR: avg(results.map(r => r.summary.finalR)),
    peakS: avg(results.map(r => r.summary.peakS)),
    deltaS: avg(results.map(r => r.summary.deltaS)),
    competitiveMargin: avg(results.map(r => r.summary.competitiveMargin)),
    internalCollapseRate: results.filter(r => r.summary.internalCollapse).length / trials,
    competitiveCollapseRate: results.filter(r => r.summary.competitiveCollapse).length / trials,
    avgInternalCollapseTime: avg(results.filter(r => r.summary.internalCollapse).map(r => r.summary.internalCollapseTime)) || null,
    avgCompetitiveCollapseTime: avg(results.filter(r => r.summary.competitiveCollapse).map(r => r.summary.competitiveCollapseTime)) || null,
    avgGrowth: avg(results.map(r => r.summary.avgGrowth)),
    avgDecay: avg(results.map(r => r.summary.avgDecay)),
    survivalRate: avg(results.map(r => r.summary.survivalRate)),
    steadyStateC: results[0].summary.steadyStateC,
  };

  return { results, avgSummary };
}

// ============================================================================
// Parameter Space Definition
// ============================================================================

const PARAMETER_RANGES = {
  mu_env: [1, 3, 5, 8, 12],           // Environmental Melt: low to high turbulence
  mu_choice: [0, 2, 5, 8],            // Chosen Melt: none to aggressive
  L: [2, 5, 8, 12, 18],               // Li: minimal to elaborate rituals
  R0: [10, 20, 50, 100, 150],         // Initial Trust: very fragile to robust
  rho: [0, 0.02, 0.05, 0.15, 0.3, 0.5], // Rotation: none to frequent
  beta: [0.2, 0.5, 1.0, 2.0, 3.5],    // Beauty: austere to rich
  tau: [0.5, 1.0, 1.5, 2.5],          // Toxicity: forgiving to harsh
};

// ============================================================================
// Archetype Classification
// ============================================================================

/**
 * Estimate metabolic capacity for classification purposes.
 */
function Omega_estimate(L, steadyStateC, R0) {
  return Math.min(L * steadyStateC, R0);
}

/**
 * Classify a simulation result into an archetype based on outcomes.
 *
 * New model recognizes two distinct failure modes:
 * - Internal collapse: Trust → 0 (the team dissolves)
 * - Competitive collapse: S < S_threshold (outpaced by environment)
 */
function classifyArchetype(summary, params) {
  const {
    finalS, finalR, peakS, deltaS, competitiveMargin,
    internalCollapseRate, competitiveCollapseRate,
    avgGrowth, avgDecay, survivalRate, steadyStateC
  } = summary;
  const { mu_env, mu_choice, L, R0, rho, beta, tau } = params;

  const mu = mu_env + mu_choice;
  const trustGrowth = finalR - R0;
  const trustGrowthRatio = trustGrowth / R0;

  // =========================================================================
  // FAILURE MODES: Check for collapse first
  // =========================================================================

  // Internal collapse dominates (trust death spiral)
  if (internalCollapseRate >= 0.8) {
    // Management Theater: rituals exceed trust capacity
    if (L > R0 * 0.8 && rho >= 0.05) {
      return 'MANAGEMENT_THEATER';
    }

    // Overwhelmed: melt far exceeds what rituals can handle
    if (mu > Omega_estimate(L, steadyStateC, R0) * 1.2) {
      return 'OVERWHELMED';
    }

    // Oligarchic Decay: very low rotation causes stewardship collapse
    if (rho <= 0.02 && L > 5) {
      return 'OLIGARCHIC_DECAY';
    }

    return 'DEATH_SPIRAL';
  }

  // Competitive collapse (outpaced by environment) - NEW ARCHETYPES
  if (competitiveCollapseRate >= 0.8 && internalCollapseRate < 0.5) {
    // The Sitting Duck: Low mu_choice in high mu_env environment
    // Refused to engage with disruption happening around them
    if (mu_choice < mu_env * 0.3) {
      return 'SITTING_DUCK';
    }

    // The Outpaced: Tried but couldn't keep up
    // Trust is healthy but growth too slow for competitive environment
    if (trustGrowthRatio > -0.2) {
      return 'OUTPACED';
    }

    return 'COMPETITIVE_COLLAPSE';
  }

  // Mixed collapse: both internal and competitive problems
  if (internalCollapseRate >= 0.5 || competitiveCollapseRate >= 0.5) {
    return 'FRAGILE_SURVIVOR';
  }

  // =========================================================================
  // SURVIVAL MODES: Organization survives, classify by trajectory
  // =========================================================================

  const efficiency = avgGrowth / Math.max(0.01, avgDecay);

  // Check competitive margin - are we staying ahead?
  const competitivelyHealthy = competitiveMargin > 0;

  // Virtuous cycle: trust and capability reinforce each other
  if (trustGrowthRatio > 0.5 && deltaS > 100 && competitivelyHealthy) {
    if (efficiency > 8) {
      return 'DIONYSIAN_IDEAL';
    }
    return 'VIRTUOUS_CYCLE';
  }

  // High performer: strong growth, trust maintained
  if (deltaS > 100 && trustGrowth > 0 && competitivelyHealthy) {
    if (efficiency > 10) {
      return 'DIONYSIAN_IDEAL';
    }
    return 'HIGH_PERFORMER';
  }

  // Pyrrhic victory: high growth but burning trust
  // Now also check: won the market but lost the team
  if (deltaS > 50 && trustGrowthRatio < -0.15) {
    if (competitivelyHealthy) {
      return 'PYRRHIC_LEADER';  // Renamed: ahead competitively but eroding trust
    }
    return 'PYRRHIC_VICTORY';
  }

  // The Gambler: High mu_choice, volatile outcomes
  if (mu_choice > mu_env && mu_choice >= 5 && competitiveCollapseRate > 0.2) {
    return 'GAMBLER';
  }

  // Aesthetic excess: high beauty, low melt, not much happening
  if (mu < L * 0.15 && beta > 2.5 && deltaS < 100) {
    return 'AESTHETIC_EXCESS';
  }

  // The Refugium: Survives in low-turbulence niche
  if (mu_env <= 2 && competitivelyHealthy && Math.abs(deltaS) < 50) {
    return 'REFUGIUM';
  }

  // Churn machine: high rotation but low beauty
  if (rho > 0.4 && beta < 0.5 && deltaS > 50) {
    return 'CHURN_MACHINE';
  }

  // Equilibrium and stagnation
  if (Math.abs(deltaS) < 15 && Math.abs(trustGrowthRatio) < 0.15) {
    if (mu_env < 2) {
      return 'STAGNANT_POND';
    }
    return 'EQUILIBRIUM';
  }

  // Decline patterns
  if (deltaS < 0 || !competitivelyHealthy) {
    if (avgDecay > avgGrowth * 1.5) {
      return 'EROSION';
    }
    return 'SLOW_DECLINE';
  }

  return 'MODERATE_GROWTH';
}

// ============================================================================
// Archetype Descriptions
// ============================================================================

const ARCHETYPE_DESCRIPTIONS = {
  DIONYSIAN_IDEAL: {
    name: 'The Dionysian Ideal',
    story: 'A team that has mastered the art of metabolizing error into structure. They face real challenges (high μ), have adequate ritual capacity (L), maintain trust through beauty and rotation, and grow both reach and social capital together. This is the goal state of the Dionysus Program.',
    characteristics: [
      'High melt successfully converted to growth',
      'Trust grows alongside explanatory reach',
      'Stewardship remains healthy through rotation',
      'Beauty provides thermal buffer for hard conversations',
    ],
  },

  HIGH_PERFORMER: {
    name: 'The High Performer',
    story: 'An organization achieving strong growth in explanatory reach while maintaining trust. Not quite optimal efficiency, but sustainable and productive. They may have minor inefficiencies in ritual or beauty, but the fundamentals are sound.',
    characteristics: [
      'Consistent positive growth in reach',
      'Trust remains stable or grows',
      'Occasional friction but no systemic breakdown',
    ],
  },

  VIRTUOUS_CYCLE: {
    name: 'The Virtuous Cycle',
    story: 'Trust and capability reinforce each other in an upward spiral. Success builds confidence which enables harder challenges which build more capability. Often seen in tight-knit founding teams or research groups with strong shared identity. The key difference from the Dionysian Ideal is less optimal efficiency—they could push harder, but the positive reinforcement is working.',
    characteristics: [
      'Trust grows significantly over time (>50% increase)',
      'Each success enables the next challenge',
      'Positive feedback between R and S',
      'High beauty amplifying trust gains',
    ],
  },

  PYRRHIC_VICTORY: {
    name: 'The Pyrrhic Victory',
    story: '"We won but lost ourselves." The organization achieves impressive growth in capability but at the cost of eroding trust. This is the classic startup death march—shipping product while burning through social capital. Can continue for a while but is fundamentally unstable.',
    characteristics: [
      'High growth in explanatory reach',
      'Significant decline in trust',
      'Winning the quarter while losing the team',
      'Sustainable only until trust is exhausted',
    ],
  },

  PYRRHIC_LEADER: {
    name: 'The Pyrrhic Leader',
    story: 'Ahead of the competition but burning through the team. This organization is winning the market—S stays above the competitive threshold—but at the cost of eroding trust. Eventually the team dissolves and the competitive lead evaporates. "We\'re number one... and no one wants to work here."',
    characteristics: [
      'Competitive position is strong (S > S̄)',
      'Trust eroding significantly',
      'Market success masking internal dysfunction',
      'Clock is ticking on social capital',
    ],
  },

  // =========================================================================
  // NEW: Competitive Collapse Archetypes
  // =========================================================================

  SITTING_DUCK: {
    name: 'The Sitting Duck',
    story: 'Refused to engage with disruption that was coming regardless. Low μ_choice in a high μ_env environment. The organization chose stability while the world was changing around them. Trust may be healthy, culture may be fine, but they became irrelevant. "We had a great team. Then the industry moved on without us."',
    characteristics: [
      'Low chosen melt (μ_choice) relative to environmental melt',
      'Trust often still healthy at time of failure',
      'Competitive threshold rose faster than reach',
      'Disruption happened TO them, not WITH them',
    ],
  },

  OUTPACED: {
    name: 'The Outpaced',
    story: 'Tried to keep up but couldn\'t. Unlike the Sitting Duck, this organization engaged with change—they chose to metabolize melt—but their capacity wasn\'t sufficient for the environment\'s pace. Good team, wrong decade. Sometimes the world just moves faster than you can learn.',
    characteristics: [
      'Active engagement with melt (moderate μ_choice)',
      'Insufficient capacity (L) or trust (R) to match μ_env',
      'Healthy internal dynamics but falling behind',
      'Lost the race with dignity intact',
    ],
  },

  COMPETITIVE_COLLAPSE: {
    name: 'Competitive Collapse',
    story: 'Generic competitive failure where S falls below S̄. The specific cause varies but the outcome is the same: the organization is outcompeted. They may still exist as a legal entity, but they\'ve lost the ability to solve the problems their environment presents.',
    characteristics: [
      'S falls below competitive threshold',
      'Growth insufficient for environmental pace',
      'May have internal problems compounding the issue',
    ],
  },

  GAMBLER: {
    name: 'The Gambler',
    story: 'Bet big on disruption, hoping to outrun the competition. High μ_choice creates volatile outcomes—sometimes spectacular growth, sometimes catastrophic failure. This is the "move fast and break things" philosophy. When it works, it looks like genius. When it fails, it looks like recklessness.',
    characteristics: [
      'μ_choice exceeds μ_env (deliberately aggressive)',
      'High variance in outcomes across trials',
      'Betting on speed over stability',
      'Success depends heavily on execution and luck',
    ],
  },

  REFUGIUM: {
    name: 'The Refugium',
    story: 'Found a protected niche where environmental melt is low. This organization survives not by metabolizing disruption but by avoiding it—a backwater where the competitive threshold rises slowly. Think tenured academia, regulated utilities, or dying industries with loyal customers. Stable, but fragile if the environment changes.',
    characteristics: [
      'Very low environmental melt (μ_env)',
      'Competitive threshold rises slowly',
      'Can afford low growth because demands are low',
      'Vulnerable to environmental shifts',
    ],
  },

  MANAGEMENT_THEATER: {
    name: 'Management Theater',
    story: 'Rituals exceed the trust available to fill them. The organization runs elaborate postmortems, crossings, and ceremonies, but without genuine Ren these become hollow performances. The gap between Li and Ren generates toxic "Theater" that actively destroys trust faster than melt ever could.',
    characteristics: [
      'Ritual capacity far exceeds available trust',
      'Forms performed without substance',
      'Each ritual makes things worse',
      'Death by meeting culture',
    ],
  },

  OVERWHELMED: {
    name: 'The Overwhelmed',
    story: 'Too much change, too little capacity to process it. The melt rate exceeds what even good rituals can handle. Common in hyper-growth startups or organizations facing massive external disruption without adequate time to build metabolic capacity.',
    characteristics: [
      'Melt far exceeds ritual capacity',
      'Constant overflow generates toxic waste',
      'Even good intent cannot keep up',
      'Need to either reduce melt or massively increase L',
    ],
  },

  OLIGARCHIC_DECAY: {
    name: 'Oligarchic Decay',
    story: 'The iron law of oligarchy in action. Without rotation, stewardship calcifies. Leaders protect their positions rather than serve the mission. Ritual capacity nominally exists but has been captured by a permanent priesthood who cannot allow their own forms to be questioned.',
    characteristics: [
      'Very low rotation rate',
      'Stewardship (C) drifts toward zero',
      'Ritual exists but serves the stewards',
      'Weber and Michels win',
    ],
  },

  DEATH_SPIRAL: {
    name: 'The Death Spiral',
    story: 'A generic collapse where decay exceeds growth and trust evaporates. The specific cause varies but the pattern is the same: each cycle makes the next one harder until the system cannot continue.',
    characteristics: [
      'Decay consistently exceeds growth',
      'Trust depletes to zero',
      'System cannot sustain itself',
    ],
  },

  FRAGILE_SURVIVOR: {
    name: 'The Fragile Survivor',
    story: 'Sometimes survives, sometimes collapses—depending on the luck of rotation timing or other stochastic factors. Operating right at the edge of sustainability. A gust of wind in the wrong direction and it falls.',
    characteristics: [
      'Survival depends on luck',
      'Barely positive or neutral dynamics',
      'No margin for error',
    ],
  },

  STAGNANT_POND: {
    name: 'The Stagnant Pond',
    story: 'Not enough melt to drive growth, but also not enough to cause collapse. The organization persists in a low-energy equilibrium, neither learning nor dying. Common in protected monopolies or heavily bureaucratized institutions.',
    characteristics: [
      'Very low melt rate',
      'Minimal growth or decline',
      'Stable but static',
      'No errors because nothing is tried',
    ],
  },

  EQUILIBRIUM: {
    name: 'The Equilibrium',
    story: 'A balanced state where growth roughly equals decay. The organization maintains itself but does not significantly advance. Unlike the Stagnant Pond (which has low melt), this organization faces moderate disruption but merely absorbs it rather than converting it to growth. May be appropriate for a mature system in a stable environment, but cannot adapt to changing conditions.',
    characteristics: [
      'Growth ≈ Decay',
      'Moderate melt rate but no net progress',
      'Stable but not improving',
      'Maintenance mode—treading water',
    ],
  },

  EROSION: {
    name: 'The Erosion',
    story: 'Slowly wearing away. Decay exceeds growth but not catastrophically—the decline is gradual enough to be invisible quarter-to-quarter but devastating over years. The frog in slowly boiling water.',
    characteristics: [
      'Persistent negative delta-S',
      'Decay greater than growth',
      'Slow enough to ignore, fast enough to matter',
    ],
  },

  SLOW_DECLINE: {
    name: 'The Slow Decline',
    story: 'A gentler form of erosion. The organization is losing ground but at a pace that allows continued operation for a long time. May have pockets of health but systemic issues prevent overall growth.',
    characteristics: [
      'Mild negative trajectory',
      'Survivable but not thriving',
      'Needs intervention to reverse',
    ],
  },

  AESTHETIC_EXCESS: {
    name: 'Aesthetic Excess',
    story: 'All beauty, insufficient challenge. The organization invests heavily in aesthetic ritual but lacks the melt rate to drive real growth. Beautiful deprecation ceremonies for things that never really mattered. Style over substance.',
    characteristics: [
      'High beauty, low melt',
      'Elaborate rituals for minor issues',
      'Feels good but accomplishes little',
    ],
  },

  CHURN_MACHINE: {
    name: 'The Churn Machine',
    story: 'Rotation so high that stewardship never has time to decay—but also never has time to build institutional memory. Constant leadership turnover prevents oligarchy but also prevents deep expertise. Everything is always starting over.',
    characteristics: [
      'Very high rotation rate',
      'Stewardship always near 1.0',
      'No oligarchy but no continuity',
      'Perpetual restart',
    ],
  },

  MODERATE_GROWTH: {
    name: 'Moderate Growth',
    story: 'A healthy but unspectacular trajectory. Growth exceeds decay, trust is maintained, nothing is dramatically wrong or right. The organizational equivalent of a solid B+.',
    characteristics: [
      'Positive but modest growth',
      'Sustainable dynamics',
      'Room for optimization',
    ],
  },
};

// ============================================================================
// Exploration Engine
// ============================================================================

/**
 * Generate all parameter combinations from ranges.
 */
function* generateParameterSets() {
  for (const mu_env of PARAMETER_RANGES.mu_env) {
    for (const mu_choice of PARAMETER_RANGES.mu_choice) {
      for (const L of PARAMETER_RANGES.L) {
        for (const R0 of PARAMETER_RANGES.R0) {
          for (const rho of PARAMETER_RANGES.rho) {
            for (const beta of PARAMETER_RANGES.beta) {
              for (const tau of PARAMETER_RANGES.tau) {
                yield { mu_env, mu_choice, L, R0, rho, beta, tau };
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Find representative parameter sets for each archetype.
 */
function exploreArchetypes() {
  const archetypeExamples = {};
  const allResults = [];

  let count = 0;
  const totalCombinations =
    PARAMETER_RANGES.mu_env.length *
    PARAMETER_RANGES.mu_choice.length *
    PARAMETER_RANGES.L.length *
    PARAMETER_RANGES.R0.length *
    PARAMETER_RANGES.rho.length *
    PARAMETER_RANGES.beta.length *
    PARAMETER_RANGES.tau.length;

  console.log(`Exploring ${totalCombinations} parameter combinations...\n`);

  for (const params of generateParameterSets()) {
    const { avgSummary } = simulateWithTrials(params);
    const archetype = classifyArchetype(avgSummary, params);

    const result = { params, summary: avgSummary, archetype };
    allResults.push(result);

    // Track best example for each archetype (by most extreme characteristic)
    if (!archetypeExamples[archetype]) {
      archetypeExamples[archetype] = [];
    }
    archetypeExamples[archetype].push(result);

    count++;
    if (count % 1000 === 0) {
      process.stdout.write(`  Processed ${count}/${totalCombinations}...\r`);
    }
  }

  console.log(`\nCompleted exploration of ${count} parameter sets.\n`);

  return { archetypeExamples, allResults };
}

/**
 * Select the most representative example for each archetype.
 */
function selectRepresentatives(archetypeExamples) {
  const representatives = {};

  for (const [archetype, examples] of Object.entries(archetypeExamples)) {
    // Sort by how "pure" an example is for this archetype
    examples.sort((a, b) => {
      // Different criteria for different archetypes
      switch (archetype) {
        case 'DIONYSIAN_IDEAL':
          return (b.summary.deltaS + b.summary.finalR - b.params.R0) -
                 (a.summary.deltaS + a.summary.finalR - a.params.R0);

        case 'PYRRHIC_VICTORY':
        case 'PYRRHIC_LEADER':
          return (b.summary.deltaS - (b.summary.finalR - b.params.R0)) -
                 (a.summary.deltaS - (a.summary.finalR - a.params.R0));

        case 'MANAGEMENT_THEATER':
        case 'OVERWHELMED':
        case 'DEATH_SPIRAL':
        case 'OLIGARCHIC_DECAY':
          return (a.summary.avgInternalCollapseTime || 999) - (b.summary.avgInternalCollapseTime || 999);

        case 'SITTING_DUCK':
        case 'OUTPACED':
        case 'COMPETITIVE_COLLAPSE':
          // Sort by earliest competitive collapse
          return (a.summary.avgCompetitiveCollapseTime || 999) - (b.summary.avgCompetitiveCollapseTime || 999);

        case 'GAMBLER':
          // Most volatile (highest variance proxy: difference between collapse rates)
          return Math.abs(b.summary.competitiveCollapseRate - b.summary.internalCollapseRate) -
                 Math.abs(a.summary.competitiveCollapseRate - a.summary.internalCollapseRate);

        case 'REFUGIUM':
          // Lowest mu_env that survives
          return a.params.mu_env - b.params.mu_env;

        case 'STAGNANT_POND':
          return Math.abs(a.summary.deltaS) - Math.abs(b.summary.deltaS);

        default:
          return b.summary.deltaS - a.summary.deltaS;
      }
    });

    // Take top 3 examples
    representatives[archetype] = examples.slice(0, 3);
  }

  return representatives;
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatArchetypeReport(representatives) {
  const output = [];

  output.push('═'.repeat(80));
  output.push('DIONYSUS PROGRAM: ARCHETYPE EXPLORATION REPORT');
  output.push('═'.repeat(80));
  output.push('');
  output.push('This report catalogs the distinct organizational archetypes that emerge from');
  output.push('different configurations of the Epimetabolic Equation. Each archetype represents');
  output.push('a qualitatively different fate that can befall an organization depending on its');
  output.push('structural parameters.');
  output.push('');

  // Sort archetypes by approximate "goodness"
  const archetypeOrder = [
    // Thriving
    'DIONYSIAN_IDEAL',
    'HIGH_PERFORMER',
    'VIRTUOUS_CYCLE',
    'MODERATE_GROWTH',
    // Survival / Edge Cases
    'EQUILIBRIUM',
    'REFUGIUM',
    'FRAGILE_SURVIVOR',
    // Pyrrhic outcomes
    'PYRRHIC_LEADER',
    'PYRRHIC_VICTORY',
    'GAMBLER',
    // Stagnation
    'STAGNANT_POND',
    'CHURN_MACHINE',
    'AESTHETIC_EXCESS',
    // Decline
    'SLOW_DECLINE',
    'EROSION',
    // Competitive collapse (new)
    'SITTING_DUCK',
    'OUTPACED',
    'COMPETITIVE_COLLAPSE',
    // Internal collapse
    'MANAGEMENT_THEATER',
    'OVERWHELMED',
    'OLIGARCHIC_DECAY',
    'DEATH_SPIRAL',
  ];

  for (const archetype of archetypeOrder) {
    const examples = representatives[archetype];
    if (!examples || examples.length === 0) continue;

    const desc = ARCHETYPE_DESCRIPTIONS[archetype];
    if (!desc) continue;

    output.push('─'.repeat(80));
    output.push(`\n## ${desc.name.toUpperCase()}`);
    output.push(`   (${archetype})`);
    output.push('');
    output.push(wrapText(desc.story, 80, '   '));
    output.push('');
    output.push('   Key Characteristics:');
    for (const char of desc.characteristics) {
      output.push(`   • ${char}`);
    }
    output.push('');

    // Show representative example
    const example = examples[0];
    const mu_total = example.params.mu_env + example.params.mu_choice;
    output.push('   Representative Parameters:');
    output.push(`   ┌────────────────────────────────────────────────────────────────────────┐`);
    output.push(`   │ μ_env (Environment) = ${pad(example.params.mu_env, 4)}  │  μ_choice (Chosen) = ${pad(example.params.mu_choice, 4)}  │  μ_total = ${pad(mu_total, 4)} │`);
    output.push(`   │ L (Li/Ritual)       = ${pad(example.params.L, 4)}  │  R₀ (Initial Trust) = ${pad(example.params.R0, 4)} │  ρ = ${pad(example.params.rho, 4)}   │`);
    output.push(`   │ β (Beauty)          = ${pad(example.params.beta, 4)}  │  τ (Toxicity)       = ${pad(example.params.tau, 4)} │              │`);
    output.push(`   └────────────────────────────────────────────────────────────────────────┘`);
    output.push('');
    output.push('   Outcomes (averaged over Monte Carlo trials):');
    output.push(`   ┌────────────────────────────────────────────────────────────────────────┐`);
    output.push(`   │ Final Reach (S)     = ${pad(example.summary.finalS.toFixed(1), 8)} │  Competitive Margin = ${pad(example.summary.competitiveMargin.toFixed(1), 8)}       │`);
    output.push(`   │ Final Trust (R)     = ${pad(example.summary.finalR.toFixed(1), 8)} │  ΔR = ${pad((example.summary.finalR - example.params.R0).toFixed(1), 8)}                  │`);
    output.push(`   │ Internal Collapse   = ${pad((example.summary.internalCollapseRate * 100).toFixed(0) + '%', 8)} │  Competitive Collapse = ${pad((example.summary.competitiveCollapseRate * 100).toFixed(0) + '%', 5)}      │`);
    output.push(`   │ Steady-State C      = ${pad(example.summary.steadyStateC.toFixed(2), 8)} │  Survival = ${pad((example.summary.survivalRate * 100).toFixed(0) + '%', 5)}                │`);
    output.push(`   └────────────────────────────────────────────────────────────────────────┘`);
    output.push('');
  }

  // Summary statistics
  output.push('─'.repeat(80));
  output.push('\n## SUMMARY STATISTICS\n');

  const counts = {};
  for (const [arch, ex] of Object.entries(representatives)) {
    counts[arch] = ex.length;
  }

  const totalFound = Object.values(representatives).reduce((s, arr) => s + arr.length, 0);
  output.push(`   Total parameter sets explored: ${totalFound}`);
  output.push('   Archetype distribution:');
  for (const arch of archetypeOrder) {
    if (representatives[arch]) {
      const count = representatives[arch].length;
      output.push(`   • ${ARCHETYPE_DESCRIPTIONS[arch]?.name || arch}: ${count} examples found`);
    }
  }

  output.push('');
  output.push('═'.repeat(80));
  output.push('END OF REPORT');
  output.push('═'.repeat(80));

  return output.join('\n');
}

// ============================================================================
// Utility Functions
// ============================================================================

function seededRandom(seed) {
  return function() {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function pad(val, width) {
  const str = String(val);
  return str + ' '.repeat(Math.max(0, width - str.length));
}

function wrapText(text, width, indent = '') {
  const words = text.split(' ');
  const lines = [];
  let currentLine = indent;

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine === indent ? '' : ' ') + word;
    } else {
      lines.push(currentLine);
      currentLine = indent + word;
    }
  }
  if (currentLine.trim()) {
    lines.push(currentLine);
  }

  return lines.join('\n');
}

// ============================================================================
// JSON Export for Further Analysis
// ============================================================================

function exportJSON(representatives, allResults) {
  const archetypeSummary = {};

  for (const [archetype, examples] of Object.entries(representatives)) {
    const desc = ARCHETYPE_DESCRIPTIONS[archetype];
    if (!desc) continue;

    archetypeSummary[archetype] = {
      name: desc.name,
      story: desc.story,
      characteristics: desc.characteristics,
      exampleCount: examples.length,
      representativeExample: {
        parameters: examples[0].params,
        outcomes: {
          finalReach: examples[0].summary.finalS,
          finalTrust: examples[0].summary.finalR,
          finalS_threshold: examples[0].summary.finalS_threshold,
          competitiveMargin: examples[0].summary.competitiveMargin,
          deltaReach: examples[0].summary.deltaS,
          deltaTrust: examples[0].summary.finalR - examples[0].params.R0,
          internalCollapseRate: examples[0].summary.internalCollapseRate,
          competitiveCollapseRate: examples[0].summary.competitiveCollapseRate,
          avgInternalCollapseTime: examples[0].summary.avgInternalCollapseTime,
          avgCompetitiveCollapseTime: examples[0].summary.avgCompetitiveCollapseTime,
          survivalRate: examples[0].summary.survivalRate,
          steadyStateC: examples[0].summary.steadyStateC,
          avgGrowth: examples[0].summary.avgGrowth,
          avgDecay: examples[0].summary.avgDecay,
        },
      },
      additionalExamples: examples.slice(1, 3).map(ex => ({
        parameters: ex.params,
        outcomes: {
          finalReach: ex.summary.finalS,
          finalTrust: ex.summary.finalR,
          competitiveMargin: ex.summary.competitiveMargin,
          internalCollapseRate: ex.summary.internalCollapseRate,
          competitiveCollapseRate: ex.summary.competitiveCollapseRate,
        },
      })),
    };
  }

  return JSON.stringify(archetypeSummary, null, 2);
}

// ============================================================================
// Main Execution
// ============================================================================

function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  DIONYSUS PROGRAM: ARCHETYPE EXPLORER');
  console.log('  Mapping the space of organizational fates');
  console.log('═'.repeat(60) + '\n');

  const { archetypeExamples, allResults } = exploreArchetypes();
  const representatives = selectRepresentatives(archetypeExamples);

  // Generate and print report
  const report = formatArchetypeReport(representatives);
  console.log(report);

  // Export JSON for further analysis
  const jsonOutput = exportJSON(representatives, allResults);
  const fs = require('fs');
  const jsonPath = 'archetypes.json';
  fs.writeFileSync(jsonPath, jsonOutput);
  console.log(`\nJSON data exported to: ${jsonPath}`);
}

main();
