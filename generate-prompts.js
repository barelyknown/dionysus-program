#!/usr/bin/env node
/**
 * Generate researcher prompts for finding historical examples of each archetype.
 *
 * Usage: node generate-prompts.js
 * Output: Creates prompts/*.md files
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Dionysus Program Overview (shared across all prompts)
// ============================================================================

const PROGRAM_OVERVIEW = `## The Dionysus Program: Overview

The Dionysus Program is a framework for understanding how organizations metabolize change. It draws on Nietzsche's distinction between the Apollonian (order, control, prediction) and the Dionysian (dissolution, renewal, collective transformation).

The core insight: as knowledge compounds, organizations face increasing "melt"—the dissolution of existing roles, norms, and identities. Organizations that can metabolize this melt into new structure thrive. Those that can't either collapse internally (trust evaporates) or collapse competitively (they fall behind).

### The Epimetabolic Equation

The mathematical model tracks three state variables:

1. **Explanatory Reach (S)**: The organization's accumulated capability—what problems it can solve, what value it creates.

2. **Trust (R, for "Ren")**: The social capital that allows hard conversations and collective action. Trust is earned slowly through successful metabolism and burned quickly through dysfunction.

3. **Stewardship (C)**: The integrity of those who tend the organization's rituals. Without rotation, stewardship drifts toward zero as incumbents capture the forms.

Key dynamics:

- **Melt (μ)**: The rate at which the environment (μ_env) and deliberate choices (μ_choice) dissolve existing structure. Melt is the raw material for growth—but only if it can be metabolized.

- **Metabolic Capacity (Ω)**: min(L·C, R)—the lesser of ritual capacity times stewardship, or available trust. This is the bottleneck for processing melt.

- **Growth (G)**: Successfully metabolized melt, amplified by beauty (aesthetic quality of rituals).

- **Decay (D)**: Damage from overflow (melt exceeding capacity) and theater (rituals exceeding trust).

- **Competitive Threshold (S̄)**: Rises with cumulative environmental melt. Fall below it and you're outcompeted, regardless of internal health.

### Two Failure Modes

1. **Internal Collapse**: Trust → 0. The team dissolves even if competitively viable.
2. **Competitive Collapse**: S < S̄. The organization falls behind, even with healthy trust.

Survival requires both R > 0 AND S ≥ S̄.`;

// ============================================================================
// Archetype Definitions
// ============================================================================

const ARCHETYPES = {
  DIONYSIAN_IDEAL: {
    name: 'The Dionysian Ideal',
    category: 'Thriving',
    narrative: `A research lab that runs weekly "murder boards" where any project can be challenged, but the challenges come wrapped in genuine curiosity and the room shares wine afterward. A startup where the postmortem for a failed launch becomes the origin story everyone tells with pride. An investment committee that rotates the devil's advocate role and treats the best dissent as a gift. These organizations have learned to *want* the melt—to seek out the hardest problems and the sharpest critics—because they've built the ritual capacity to turn that heat into growth. They get stronger every time something breaks.`,
    situation: `High environmental melt (μ_env), high ritual capacity (L), high beauty (β), adequate rotation (ρ), and robust initial trust (R₀). The organization faces real challenges and has built the infrastructure to metabolize them.`,
    dynamics: `Each cycle, Omega (min(L·C, R)) is large enough to absorb most of the melt. Growth G compounds because beauty amplifies it (1 + λβ). Decay D stays low because overflow is minimal and there's no theater (rituals don't exceed trust). Trust actually *grows* because αβG > γD—successful metabolism deposits new social capital.`,
    outcome: `Explanatory reach S climbs well above the competitive threshold S̄. Trust R increases over time. The organization gets stronger the more disruption it faces. This is the goal state of the Dionysus Program.`,
  },

  HIGH_PERFORMER: {
    name: 'The High Performer',
    category: 'Thriving',
    narrative: `A well-run engineering team that ships consistently, holds decent retros, and maintains a healthy culture—but the retros are a bit rote, the celebrations a bit perfunctory. A consulting firm where partners trust each other and clients keep coming back, but nobody would call the work environment *beautiful*. These organizations do most things right. They're not broken. They're just not transcendent. They win by showing up and executing, not by turning disruption into fuel.`,
    situation: `Similar to the Dionysian Ideal but with slightly lower beauty or less frequent rotation. The fundamentals are sound but not optimized.`,
    dynamics: `Growth exceeds decay consistently. Trust remains stable or grows modestly. Some inefficiency creeps in—perhaps stewardship drifts a bit between rotations, or lower beauty means less amplification—but nothing breaks.`,
    outcome: `Strong positive trajectory on S, staying ahead of S̄. Sustainable but leaving performance on the table. The organizational B+.`,
  },

  VIRTUOUS_CYCLE: {
    name: 'The Virtuous Cycle',
    category: 'Thriving',
    narrative: `Three founders in a garage who barely know each other but commit from day one to radical honesty and beautiful ritual—Friday demos with real feedback, Monday planning with real dissent, and a norm that the person who was most wrong last week opens the next meeting. They start with almost no trust, but every successful collision deposits more. Within a year, they can have conversations that would destroy most teams. The early investment in *how* they work together compounds into a capacity that lets them take on problems far above their weight class.`,
    situation: `High beauty, high rotation, but starting from low initial trust (R₀). A young team or new initiative that hasn't accumulated social capital yet.`,
    dynamics: `The key is that αβG is large relative to γD. Each successful metabolism deposits significant trust because beauty amplifies the earn rate. As R grows, Omega grows, allowing more melt to be processed, generating more growth, depositing more trust. Positive feedback takes hold.`,
    outcome: `Both S and R curve upward together. The organization bootstraps from fragility to robustness. Often seen in tight founding teams who invest heavily in ritual and aesthetics from day one.`,
  },

  MODERATE_GROWTH: {
    name: 'Moderate Growth',
    category: 'Thriving',
    narrative: `A mid-sized company where things basically work. Meetings happen, decisions get made, products ship. Nobody writes blog posts about the culture, but nobody dreads Monday either. The organization grows, solves problems, maintains its position. It's the statistical middle of the distribution—neither optimized nor dysfunctional, neither inspiring nor dispiriting. Most healthy organizations live here most of the time.`,
    situation: `Adequate capacity across the board, nothing exceptional. Moderate beauty, moderate rotation, reasonable trust.`,
    dynamics: `Growth exceeds decay by a comfortable margin. No single parameter is a bottleneck, but none is a lever either. The system hums along.`,
    outcome: `Steady positive trajectory. S stays above S̄ with margin to spare. Not exciting, but sustainable. Many healthy mature organizations live here.`,
  },

  FRAGILE_SURVIVOR: {
    name: 'The Fragile Survivor',
    category: 'Edge Case',
    narrative: `A team operating right at the edge—enough capacity to handle normal variation, but no buffer for bad luck. When the critical leader happens to be present during the crisis, they pull through. When the crisis hits during a transition, they don't. Run the tape ten times and you get five survivals and five collapses. The organization isn't broken; it's just one unlucky quarter away from breaking. Every success feels like a near miss because it was.`,
    situation: `Parameters are tuned such that outcomes depend heavily on stochastic factors—particularly the timing of stewardship resets. Rotation rate is moderate, and the system is operating near its limits.`,
    dynamics: `In good runs, C resets at fortuitous moments, keeping Omega high when it matters. In bad runs, C drifts low during high-melt periods, causing overflow and decay spikes. The margin between growth and decay is thin.`,
    outcome: `Sometimes survives, sometimes collapses—depending on luck. No margin for error. A gust of wind in the wrong direction and it falls.`,
  },

  GAMBLER: {
    name: 'The Gambler',
    category: 'Edge Case',
    narrative: `A startup that deliberately takes on more disruption than anyone asked for—pivoting quarterly, rewriting the core product annually, treating every assumption as a hypothesis to be destroyed. When the bets pay off, they leapfrog competitors who were playing it safe. When the bets don't pay off, they burn through runway, trust, and talent simultaneously. The founders will later either be on magazine covers or cautionary tales, and the difference has as much to do with timing and luck as with skill.`,
    situation: `Chosen melt (μ_choice) exceeds environmental melt (μ_env). The organization deliberately takes on more disruption than the environment demands—aggressive R&D, constant experimentation, "move fast and break things."`,
    dynamics: `High total melt creates high potential growth but also high overflow risk. When capacity keeps up, growth is spectacular. When it doesn't, decay compounds. The variance across runs is enormous.`,
    outcome: `Bimodal: either dramatic success or dramatic failure. When it works, it looks like genius. When it fails, it looks like recklessness. The startup death-or-glory trajectory.`,
  },

  PYRRHIC_LEADER: {
    name: 'The Pyrrhic Leader',
    category: 'Pyrrhic',
    narrative: `The company that's crushing its quarterly numbers while hemorrhaging talent. Glassdoor reviews mention "great for your resume, terrible for your soul." The exec team points to market share; the HR team quietly tracks the attrition. Every all-hands meeting celebrates wins that everyone knows came at a cost nobody will name out loud. The organization is winning—and everyone inside knows it can't last. They're spending down a trust account that took years to build and will take years to rebuild, if it can be rebuilt at all.`,
    situation: `High melt, high capacity, but very low beauty (β). The organization can process disruption but does so brutally—no aesthetic buffer, no warmth in the rituals.`,
    dynamics: `Growth happens because Omega is adequate. But trust erodes because the earn rate (αβG) is suppressed by low beauty while the burn rate (γD) isn't. Each cycle, the organization gains reach but loses social capital. Critically, S stays above S̄—they're winning competitively.`,
    outcome: `Market success masking internal dysfunction. "We're number one... and no one wants to work here." Eventually R depletes and the team dissolves, but until then, the dashboards look great.`,
  },

  CHURN_MACHINE: {
    name: 'The Churn Machine',
    category: 'Pyrrhic',
    narrative: `A company that reorganizes every six months. New leaders, new priorities, new structures—the org chart is a living document that nobody bothers to memorize. This prevents any particular faction from calcifying into permanence, which is good. But it also means nobody accumulates the deep context needed to make hard tradeoffs wisely. Every new leader starts from scratch, reinvents wheels, makes mistakes their predecessor already learned from. The organization never gets captured by an oligarchy, but it also never builds on its own history. Progress is real but feels like running on a treadmill.`,
    situation: `Very high rotation rate (ρ), low beauty. Stewardship resets constantly—new leaders, new initiatives, perpetual reorganization.`,
    dynamics: `C never drifts far because it's always being reset. This prevents oligarchic decay. But it also prevents institutional memory from accumulating. Low beauty means trust doesn't grow even when metabolism succeeds. The organization is always starting over.`,
    outcome: `Survives but never compounds. No calcification, but no depth either. Growth is real but feels Sisyphean.`,
  },

  SLOW_DECLINE: {
    name: 'The Slow Decline',
    category: 'Decline',
    narrative: `A department that used to be central and is now a backwater. Nothing dramatic happened—no layoffs, no scandals, no visible failure. Just a slow fade. The best people quietly transferred to other teams. The rituals got a little staler each year. The problems got a little less interesting. Nobody decided to let it die; it just stopped mattering. Ten years from now, someone will ask why this team still exists, and nobody will have a good answer. The decline is so gradual that at no single moment does intervention feel urgent—which is exactly why intervention never comes.`,
    situation: `Low environmental melt, low chosen melt, modest capacity. The organization isn't facing much disruption and isn't seeking any.`,
    dynamics: `With low total melt, growth is modest. But decay, while also low, slightly exceeds growth—perhaps due to theater from underutilized ritual capacity, or stewardship drift in a low-rotation environment. The gap is small but persistent.`,
    outcome: `S falls slowly relative to S̄ (which rises slowly given low μ_env). Survivable for a long time. The organization doesn't notice it's dying because quarterly changes are within noise. The frog in warming water.`,
  },

  SITTING_DUCK: {
    name: 'The Sitting Duck',
    category: 'Competitive Collapse',
    narrative: `A newspaper that had a great newsroom, loyal subscribers, and a culture reporters loved—and decided not to invest in digital because "our readers prefer print." A retailer with excellent customer service and deep community roots that watched e-commerce grow and chose not to compete. A law firm with brilliant partners who dismissed legal tech as "not how serious work gets done." The world changed; they didn't. Their trust was fine. Their rituals were fine. Their culture was fine. They just became irrelevant. When the end came, longtime employees were genuinely confused: "But we were doing everything right." They were—by the standards of a world that no longer existed.`,
    situation: `High environmental melt (μ_env) but near-zero chosen melt (μ_choice). The world is changing rapidly, but the organization has decided not to engage with it.`,
    dynamics: `With low total melt, the organization avoids overflow and decay. Trust may even be healthy. But S̄ rises by μ_env every cycle while S barely grows. The gap widens inexorably.`,
    outcome: `Competitive collapse with trust intact. "We had a great team. Then the industry moved on without us." The organization chose stability while the world chose disruption. Disruption happened *to* them, not *with* them.`,
  },

  OUTPACED: {
    name: 'The Outpaced',
    category: 'Competitive Collapse',
    narrative: `A company that saw the disruption coming and tried to respond—hired consultants, launched initiatives, created innovation labs. They *wanted* to transform. But they couldn't metabolize change fast enough. The new skills took longer to build than the market gave them. The pilots succeeded but couldn't scale. The culture adapted but not at the pace the environment demanded. Unlike the Sitting Duck, they engaged; unlike the winners, they couldn't keep up. There's no villain in this story, no decision that was obviously wrong at the time. They simply lost a race where second place and last place pay the same.`,
    situation: `Moderate environmental melt, some chosen melt—the organization is trying to keep up. But capacity (L) or trust (R₀) is insufficient for the pace the environment sets.`,
    dynamics: `The organization engages with change but can't metabolize it fast enough. Overflow generates some decay. Growth is positive but slower than μ_env. Each cycle, S̄ pulls further ahead.`,
    outcome: `Lost the race with dignity intact. Trust didn't collapse; they simply couldn't learn fast enough. Good team, wrong decade. Sometimes the world just moves faster than you can adapt.`,
  },

  MANAGEMENT_THEATER: {
    name: 'Management Theater',
    category: 'Internal Collapse',
    narrative: `The calendar is full of meetings with important names: Strategy Reviews, Alignment Sessions, Culture Conversations. Slide decks are polished. Facilitators are trained. The problem is that no one believes any of it. Everyone knows the real decisions happen elsewhere—in Slack DMs, in the CEO's head, in the politics between two SVPs. The rituals continue because stopping them would be an admission, and admissions are dangerous. So people show up, say the expected things, and leave. Each hollow ceremony makes the next one harder to take seriously. The organization is dying of its own process—not because it has too much structure, but because the structure has become untethered from any actual collective sense-making. The forms are observed; the substance is absent.`,
    situation: `High ritual capacity (L) relative to available trust (R₀). The organization has elaborate ceremonies—postmortems, all-hands, planning cycles—but not the social capital to fill them authentically.`,
    dynamics: `Theater = max(0, L·C - R) is large. This generates decay via κ·Theater/β, which burns trust directly. Each hollow ritual makes the next one worse. The gap between L·C and R widens as R falls.`,
    outcome: `Rapid trust collapse. The rituals that were supposed to build alignment instead accelerate dissolution. Death by meeting culture. The forms are observed; the substance is absent.`,
  },

  OVERWHELMED: {
    name: 'The Overwhelmed',
    category: 'Internal Collapse',
    narrative: `The pitch deck promised hypergrowth and the market delivered. Now the team is doubling every quarter, the product is being rebuilt while customers use it, and the competitive landscape shifts weekly. There's no time to document anything, no time to onboard properly, no time to process the last pivot before the next one. Good people are burning out or quitting. Institutional knowledge walks out the door faster than it accumulates. The founders know this is unsustainable, but the alternative—slowing down—feels like death. They're not wrong: in their market, it might be. This is the tragedy of organizations that succeed too fast for their own infrastructure. The melt rate isn't a choice; it's a condition of survival. The only question is whether they can build capacity faster than complexity accumulates.`,
    situation: `Very high melt (environmental, chosen, or both) relative to capacity. A hyper-growth startup, or an organization facing massive external disruption without time to build infrastructure.`,
    dynamics: `Overflow = max(0, μ - Ω) is persistently large. This generates decay via Overflow²·τ—the quadratic term makes high overflow devastating. Even good intentions can't keep up. Trust burns faster than metabolism can deposit it.`,
    outcome: `Rapid internal collapse. The melt rate simply exceeds what the system can handle. The only solutions are: reduce melt (if possible), massively increase L (takes time), or accept that this configuration is unsurvivable.`,
  },

  OLIGARCHIC_DECAY: {
    name: 'Oligarchic Decay',
    category: 'Internal Collapse',
    narrative: `The founding team was brilliant. They built the culture, designed the rituals, embodied the values. The problem is that they never left. Twenty years later, the same people run the same meetings, and something has calcified. The rituals still happen, but they've become performances for an audience of one—the permanent leadership—rather than genuine collective sense-making. New ideas get filtered through "what will the founders think." Talented people join, realize the ceiling, and leave. The organization has become a court, not a team. Michels called this the iron law of oligarchy: every organization tends toward rule by a self-perpetuating elite. The only antidote is rotation, but by the time the pattern is visible, the incumbents have every incentive to resist it. They're not bad people; they're just people who've confused their presence with the organization's health.`,
    situation: `Very low rotation rate (ρ), substantial ritual capacity. Leaders stay in place; stewardship is not refreshed.`,
    dynamics: `C drifts toward zero as (1-δ)^t compounds. Omega shrinks even though L and R haven't changed. Overflow grows. The rituals nominally exist but have been captured by a permanent priesthood who cannot allow their own forms to be questioned. Weber and Michels were right.`,
    outcome: `Internal collapse via stewardship failure. The iron law of oligarchy in action. The solution is rotation—but by the time this pattern is visible, the incumbents have strong incentives to resist it.`,
  },

  DEATH_SPIRAL: {
    name: 'The Death Spiral',
    category: 'Internal Collapse',
    narrative: `It started with a bad quarter. Then the best engineer left. Then the budget got cut, which meant fewer resources for the rituals that might have helped, which meant more informal politics, which meant more burnout, which meant more departures. Each problem makes the next one worse. The organization is caught in a vortex where declining trust reduces capacity, reduced capacity increases overflow, overflow accelerates decay, and decay burns what trust remains. No single parameter is fatal. The death spiral is an emergent property of their interaction—a system that has crossed into a regime where all the feedback loops point the same direction: down. By the time leadership recognizes the pattern, the intervention required is usually larger than what the remaining trust can support. This is the generic attractor for undercapitalized organizations facing disruption. Most organizations that fail, fail this way.`,
    situation: `Multiple compounding failures: high melt, low capacity, low beauty, some theater. No single parameter is catastrophic, but the combination is.`,
    dynamics: `Decay exceeds growth consistently. Trust falls, which shrinks Omega, which increases overflow, which accelerates decay, which burns more trust. Negative feedback takes hold.`,
    outcome: `Rapid collapse. Each cycle makes the next one harder until the system cannot continue. This is the generic attractor for undercapitalized organizations facing disruption without adequate ritual infrastructure.`,
  },
};

// ============================================================================
// Prompt Generation
// ============================================================================

function generatePrompt(key, archetype) {
  return `# Research Prompt: Historical Examples of "${archetype.name}"

${PROGRAM_OVERVIEW}

---

## The Archetype: ${archetype.name}

**Category:** ${archetype.category}

### Narrative Description

${archetype.narrative}

### Situation

${archetype.situation}

### Dynamics

${archetype.dynamics}

### Outcome

${archetype.outcome}

---

## Research Task

Please identify **3 compelling historical examples** of organizations, institutions, movements, or groups that exemplify the "${archetype.name}" archetype.

For each example, provide:

1. **The Organization/Entity**: Name and brief context (what it was, when it operated)

2. **Why It Fits This Archetype**: Explain how the organization's situation, dynamics, and outcome match the archetype pattern. Be specific about:
   - What was the "melt" (environmental disruption or chosen change) they faced?
   - What was their metabolic capacity (ritual infrastructure, trust levels, leadership quality)?
   - How did the key dynamics play out?

3. **The Trajectory**: What actually happened? How did the story end (or where is it now)?

4. **Key Evidence**: What specific events, decisions, or observable patterns support this classification?

5. **Lessons**: What does this example teach us about this archetype that generalizes beyond the specific case?

### Selection Criteria

Prefer examples that are:
- **Well-documented**: Enough historical record to analyze meaningfully
- **Illustrative**: Clearly demonstrate the archetype's key dynamics
- **Diverse**: Draw from different domains (business, government, military, religious, scientific, artistic, etc.) and different eras
- **Non-obvious**: Go beyond the most famous examples if possible; depth of analysis matters more than name recognition

### Format

Present each example as a mini case study (300-500 words each). After the three examples, include a brief synthesis (100-200 words) discussing what these cases collectively reveal about the archetype.
`;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const outputDir = path.join(__dirname, 'prompts');

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate a prompt file for each archetype
  for (const [key, archetype] of Object.entries(ARCHETYPES)) {
    const prompt = generatePrompt(key, archetype);
    const filename = `${key.toLowerCase()}.md`;
    const filepath = path.join(outputDir, filename);

    fs.writeFileSync(filepath, prompt);
    console.log(`Generated: prompts/${filename}`);
  }

  console.log(`\nGenerated ${Object.keys(ARCHETYPES).length} prompt files in prompts/`);
}

main();
