import { ALON, AIRDROP_TASK_ID, PAYROLL_TASK_ID } from "./bagworker.ts";
export type TaskAction = "interact" | "jump" | "hype" | "airdrop" | "launch";
export type TaskSceneId = "spread" | "contract" | "peel" | "hotdog" | "crown";
export type PropKey = "peanut-butter-jar" | "gull" | "bin" | "banana" | "crown";
export interface TaskChoice {
  label: string;
  detail: string;
  reward: number;
  reaction: string;
  scene?: TaskSceneId;
}
export interface TaskDef {
  id: number;
  place: string;
  title: string;
  intro: string;
  action: TaskAction;
  actionHint: string;
  scene?: TaskSceneId;
  prop: PropKey | null;
  position: { x: number; z: number };
  choices: TaskChoice[];
}
export const ROUTE_STOPS = {
  motel: { x: -6, z: -28 },
  boardwalk: { x: 12, z: -74 },
  utility: { x: -14, z: -118 },
  apology: { x: 11, z: -164 },
  streetTeam: { x: -7, z: -207 },
  laundromat: { x: -8, z: -250 },
  hotdog: { x: 13, z: -293 },
  finale: { x: 0, z: -342 },
};
export const AUDIT_TASK_ID = 7;

export const TASKS: TaskDef[] = [
  {
    id: 0,
    place: "01 / SUNSET MOTEL",
    title: "Find your audience.",
    intro:
      "Your coin is pumping. Unfortunately, nobody knows what you actually do. Give them something to talk about.",
    action: "interact",
    actionHint: "E · apply the business strategy",
    prop: "peanut-butter-jar",
    position: ROUTE_STOPS.motel,
    choices: [
      {
        label: "Attempt an impressive stunt",
        detail: "You have no insurance and mediocre knees.",
        reward: 100,
        reaction: "technically that was a stunt",
      },
      {
        label: "Rage-bait the tourists",
        detail: "“The beach is actually overrated.”",
        reward: 250,
        reaction: "engagement is engagement",
      },
      {
        label: "Cover yourself in peanut butter",
        detail: "Finally. A founder with skin in the game.",
        reward: 500,
        reaction: "WHITEPAPER UPDATED: CRUNCHY.",
        scene: "spread",
      },
    ],
  },
  {
    id: 1,
    place: "02 / THE BOARDWALK",
    title: "Hire a CEO.",
    intro:
      "The group chat wants leadership. A seagull has been watching you with suspicious confidence.",
    action: "hype",
    actionHint: "Q · announce your leadership team",
    prop: "gull",
    position: ROUTE_STOPS.boardwalk,
    choices: [
      {
        label: "Announce a roadmap",
        detail: "Q1: roadmap. Q2: longer roadmap.",
        reward: 100,
        reaction: "roadmap looks like a napkin",
      },
      {
        label: "Appoint an influencer",
        detail: "His only reference is another influencer.",
        reward: 250,
        reaction: "our new CEO has a ring light",
      },
      {
        label: "Declare the seagull your CEO",
        detail: "Already experienced in hostile takeovers of chips.",
        reward: 500,
        reaction: "CEO HAS STOLEN A CHIP.",
        scene: "contract",
      },
    ],
  },
  {
    id: 2,
    place: "03 / UTILITY ALLEY",
    title: "Show them the utility.",
    intro:
      "People keep asking what the coin does. There is a perfectly good bin here. The answer feels obvious.",
    action: "jump",
    actionHint: "Space · jump and land inside the bin",
    prop: "bin",
    position: ROUTE_STOPS.utility,
    choices: [
      {
        label: "Explain the product",
        detail: "Make confident gestures at nothing.",
        reward: 100,
        reaction: "can someone explain that explanation",
      },
      {
        label: "Unveil the merch",
        detail: "A shirt that says “the utility is the shirt”.",
        reward: 250,
        reaction: "finally a wearable roadmap",
      },
      {
        label: "Wear the bin. Become infrastructure.",
        detail: "Decentralised waste management starts with you.",
        reward: 500,
        reaction: "FOUNDER IS LITERALLY THE INFRASTRUCTURE.",
      },
    ],
  },
  {
    id: 3,
    place: "04 / APOLOGY PROMENADE",
    title: "Address the allegations.",
    intro:
      "A jar of peanut butter has accused you of weak hands. The community demands a public response.",
    action: "interact",
    actionHint: "E · deliver your very sincere apology",
    prop: "peanut-butter-jar",
    position: ROUTE_STOPS.apology,
    choices: [
      {
        label: "Publish the accounts",
        detail: "A screenshot of a calculator, mostly.",
        reward: 100,
        reaction: "the numbers are certainly numbers",
      },
      {
        label: "Host an emergency AMA",
        detail: "Mute everybody. Say “great question”.",
        reward: 250,
        reaction: "AMA stands for avoid most answers",
      },
      {
        label: "Apologise to the peanut-butter jar",
        detail: "“I have let you down. And your shareholders.”",
        reward: 500,
        reaction: "HE APOLOGISED TO THE JAR. WE ARE SO BACK.",
      },
    ],
  },
  {
    id: 4,
    place: "05 / CLUB LIQUID STREET TEAM",
    title: "Secure a partnership.",
    intro:
      "The bouncer says you need a strategic partner. An inflatable banana is currently available for a meeting.",
    action: "hype",
    actionHint: "Q · open the board meeting",
    prop: "banana",
    position: ROUTE_STOPS.streetTeam,
    choices: [
      {
        label: "Pay a promoter",
        detail: "He charges extra to remember your name.",
        reward: 100,
        reaction: "organic paid enthusiasm",
      },
      {
        label: "Promise an airdrop",
        detail: "Nobody asks what is being dropped.",
        reward: 250,
        reaction: "wen drop wen drop wen drop",
      },
      {
        label: "Hold a board meeting with the banana",
        detail: "Unanimous approval. Nobody said a word.",
        reward: 500,
        reaction: "STRATEGIC BANANA PARTNERSHIP CONFIRMED.",
        scene: "peel",
      },
    ],
  },
  {
    id: AIRDROP_TASK_ID,
    place: "06 / BAGWORKER BLVD",
    title: "Go get the airdrop.",
    intro:
      "Alon points down the street. ‘Over the van, across the rooftops. Airdrop at the end. Easy money.’",
    action: "airdrop",
    actionHint: "Follow the numbered rooftops",
    prop: null,
    position: ALON,
    choices: [
      {
        label: "Ask if this is paid work",
        detail: "‘Let's not get ahead of ourselves.’",
        reward: 0,
        reaction: "THE AIRDROP WAS A MEETING THAT COULD HAVE BEEN A TEXT.",
      },
      {
        label: "Request the eligibility criteria",
        detail: "‘Having legs. Next question.’",
        reward: 0,
        reaction: "PROOF OF WALK COMPLETED.",
      },
      {
        label: "Run the entire roadmap",
        detail: "Finally, a roadmap you can fall off.",
        reward: 0,
        reaction: "NO AIRDROP. PLEASE RETURN TO YOUR EMPLOYER.",
      },
    ],
  },
  {
    id: PAYROLL_TASK_ID,
    place: "07 / BAGWORKER PAYROLL",
    title: "Become the airdrop.",
    intro:
      "Alon points at a parcel cannon and a giant wallet. ‘You misunderstood. You ARE the airdrop. Land in the wallet, then come get your cash.’",
    action: "launch",
    actionHint: "E · get in the parcel cannon",
    prop: null,
    position: ALON,
    choices: [
      {
        label: "Invoice for emotional damages",
        detail: "Payment upon successful deposit.",
        reward: 500,
        reaction: "THERE'S NO AIRDROP. THIS IS PAYROLL.",
      },
      {
        label: "Request hazard pay",
        detail: "‘The hazard is priced in.’",
        reward: 750,
        reaction: "CASH RECEIVED. WORKPLACE CONCERNS REMAIN.",
      },
      {
        label: "Become a direct deposit",
        detail: "Aim. Launch. Collect a very normal wad of cash.",
        reward: 1000,
        reaction: "YOU ARE NOW A SALARIED PROJECTILE.",
      },
    ],
  },
  {
    id: AUDIT_TASK_ID,
    place: "08 / EXIT LIQUIDITY LAUNDROMAT",
    title: "Prove the books are clean.",
    intro:
      "Buyers are asking for an audit. The laundromat has one load left before closing.",
    action: "interact",
    actionHint: "E · start the audit cycle",
    prop: "bin",
    position: ROUTE_STOPS.laundromat,
    choices: [
      {
        label: "Show them the receipts",
        detail: "Mostly coins for the dryer.",
        reward: 100,
        reaction: "at least the receipts smell like lavender",
      },
      {
        label: "Buy the premium rinse",
        detail: "The auditor recommends fabric softener.",
        reward: 250,
        reaction: "profit margins noticeably fluffier",
      },
      {
        label: "Put the whitepaper on spin cycle",
        detail: "Guaranteed to remove all trace of fundamentals.",
        reward: 500,
        reaction: "AUDIT PASSED. 40°C, DELICATES.",
      },
    ],
  },
  {
    id: 8,
    place: "09 / QUANTUM HOT DOGS",
    title: "Observe an actual lunch.",
    intro:
      "The vendor offers three specials. One is a hot dog. All three are listed as hot dogs for accounting purposes.",
    action: "interact",
    actionHint: "E · inspect the specials",
    scene: "hotdog",
    prop: null,
    position: ROUTE_STOPS.hotdog,
    choices: [
      {
        label: "Order one regular hot dog",
        detail: "The vendor asks what you mean by ‘one’.",
        reward: 100,
        reaction: "LUNCH CONFIRMED BY AN INDEPENDENT OBSERVER.",
      },
      {
        label: "Ask for the superposition special",
        detail: "Everything on it. Also nothing.",
        reward: 250,
        reaction: "CONDIMENT STATE HAS BEEN RESOLVED.",
      },
      {
        label: "Put the theoretical bun on the menu",
        detail: "Print the menu before the bun can object.",
        reward: 500,
        reaction: "THE BUN EXISTS IN OUR ROADMAP.",
      },
    ],
  },
  {
    id: 9,
    place: "10 / THE COIN SIGN",
    title: "Become the Slopmeister.",
    intro:
      "Club Liquid has a crown and a horseshoe court. They insist this is how succession works.",
    action: "interact",
    actionHint: "E · take the crown",
    scene: "crown",
    prop: "crown",
    position: ROUTE_STOPS.finale,
    choices: [
      {
        label: "Thank the community",
        detail: "They would like their money back.",
        reward: 100,
        reaction: "he thanked us. that fixes everything",
      },
      {
        label: "Promise even more utility",
        detail: "The bin was just phase one.",
        reward: 250,
        reaction: "UTILITY ALLEY EXPANSION PACK WHEN",
      },
      {
        label: "Crown yourself the Slopmeister",
        detail: "Stick the landing. Blame the wind if you miss.",
        reward: 500,
        reaction: "ALL HAIL THE SLOPMEISTER.",
      },
    ],
  },
];

export function coinName(random: () => number = Math.random): {
  name: string;
  ticker: string;
} {
  const first = [
    "Crunchy",
    "Unemployed",
    "Emotional",
    "Unlicensed",
    "Suspicious",
    "Liquid",
  ];
  const second = ["Seagull", "Banana", "Motel", "Goblin", "Peanut", "Landlord"];
  const a =
    first[Math.min(first.length - 1, Math.floor(random() * first.length))];
  const b =
    second[Math.min(second.length - 1, Math.floor(random() * second.length))];
  return {
    name: `${a} ${b}`,
    ticker: (a.slice(0, 3) + b.slice(0, 4)).toUpperCase(),
  };
}

export function defenceThread(input: {
  coin: string;
  banked: number;
  completed: number;
  slopmeister: boolean;
  choiceLabels: string[];
}): string[] {
  const deeds = input.choiceLabels.length
    ? input.choiceLabels.map((x) => `“${x}”`).join(", ")
    : "being in the vicinity of a promising opportunity";
  const amount = Math.floor(input.banked).toLocaleString("en-US");
  return [
    `A few thoughts on ${input.coin}. Please read the entire thread before spreading misinformation. I have seen some deeply unfair descriptions of today's events, most of them attached to extremely accurate video footage. Accuracy without context is still a narrative, and I will be addressing that narrative with a considerably longer narrative.`,
    `Yes, my documented decisions included ${deeds}. Every one of these was part of a deliberate community activation strategy. Some of you are treating the absence of a written strategy as evidence that there was no strategy. That is precisely the kind of conventional thinking this project was founded to disrupt.`,
    `Regarding the ${amount} bucks: this was a personal liquidity event. It should not be interpreted as a statement about the long-term fundamentals, medium-term vibes, or short-term availability of me in the group chat. The timing was coincidental in the very specific sense that I chose the time.`,
    `I completed ${input.completed} of ${TASKS.length} public commitments. ${input.slopmeister ? "The community witnessed my transformation into the Slopmeister, a title carrying significant responsibilities that are still being defined." : "The remaining commitments have entered a period of strategic reflection. This is not the same as abandoning them, although the immediate practical experience may feel similar."} We must leave room for founders to iterate.`,
    `To everyone who chased me down the promenade: I hear you. Mostly because you were shouting. Physical pursuit was never part of our governance framework. Please submit feedback through the proper channels, once we have agreed what those channels are and whether I will be monitoring them.`,
    `I remain incredibly excited about what comes next. The community is the product, the journey is the roadmap, and the screenshots are taken out of context even when they show the whole screen. Thank you to the real ones who understand. Replies are now limited while the team focuses on building.`,
  ];
}
