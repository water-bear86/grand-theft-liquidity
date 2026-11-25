export const INCIDENT_THRESHOLD = 60;
export const INCIDENT_START_SUSPICION = [16, 28, 44] as const;
export const INCIDENT_DISCLAIMER =
  "In-game fiction. This is not a real post, wallet, or signature.";

export type IncidentStep =
  | "skim"
  | "tweet"
  | "route"
  | "discord"
  | "bounty"
  | "result";
export type IncidentResult = "cover" | "exposed";

export interface IncidentOption {
  id: string;
  label: string;
  detail: string;
}

export interface IncidentHop {
  id: string;
  label: string;
  done: boolean;
  available: boolean;
}

export interface IncidentView {
  step: IncidentStep;
  suspicion: number;
  heading: string;
  body: string;
  disclaimer: string;
  options: IncidentOption[];
  hops: IncidentHop[];
  result: IncidentResult | null;
  status: string;
  action: string;
}

const SKIM_COPY = [
  {
    heading: "Pocket a consultant fee",
    body: "A modest, very professional misappropriation from the protocol treasury into a wallet labeled Founder Wallet (unrelated).",
  },
  {
    heading: "Redirect the marketing budget",
    body: "The billboards were a security risk anyway. Slide the budget into Founder Wallet (unrelated) and keep a straight face.",
  },
  {
    heading: "Empty the treasury",
    body: "Move the whole stack into Founder Wallet (unrelated). You cannot be fired if a sophisticated attacker took the keys.",
  },
] as const;

const TWEETS: (IncidentOption & { suspicion: number })[] = [
  {
    id: "calm",
    label: "Post the classic incident note",
    detail:
      "“We are aware of an incident and are working with the appropriate channels. Further updates will follow.” — @TreasuryDesk",
    suspicion: -15,
  },
  {
    id: "nation",
    label: "Blame a nation-state",
    detail:
      "“Preliminary findings point to a sophisticated nation-state actor. We are not naming names, but you know the usual suspects.” — @TreasuryDesk",
    suspicion: -8,
  },
  {
    id: "clown",
    label: "Laugh it off",
    detail:
      "“Can't believe we got hacked lol. Anyway, merch restock at noon.” — @TreasuryDesk",
    suspicion: 22,
  },
];

const DISCORD: (IncidentOption & { suspicion: number; bounty?: boolean })[] = [
  {
    id: "patient",
    label: "Ask the lounge to wait",
    detail:
      "In Liquidity Lounge: “Please keep discussion in #official-updates. The team is investigating and will not comment on unofficial traces.”",
    suspicion: -14,
  },
  {
    id: "bounty",
    label: "Offer a whitehat bounty",
    detail:
      "“We're offering a 10% whitehat bounty for the safe return of funds.” You already know who is going to claim it.",
    suspicion: 0,
    bounty: true,
  },
  {
    id: "gm",
    label: "Post gm and leave",
    detail:
      "“The real exploit is the friends we made along the way. gm.” The lounge does not take this well.",
    suspicion: 18,
  },
];

const BOUNTY: (IncidentOption & { suspicion: number })[] = [
  {
    id: "cutout",
    label: "Have a totally unrelated wallet claim it",
    detail: "The wallet is named UnrelatedResearcher_4. It was created four minutes ago.",
    suspicion: 6,
  },
  {
    id: "claim",
    label: "Claim it as @SafeHarbor_99 (this is you)",
    detail: "You thank the team for their cooperation and invoice yourself.",
    suspicion: 20,
  },
];

const HOP_LABELS: Record<string, string> = {
  pond: "Foggy Pond mixer",
  mistport: "Mistport Relay",
  pocket: "Wallet labeled definitely_not_me",
  wire: "Direct wire",
  cold: "Cold wallet we definitely don't control",
};

const GOOD_ROUTE = ["pond", "mistport", "cold"] as const;

export function isIncidentJumpRequest(
  search = "",
  hash = "",
): boolean {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const value = (params.get("mission") ?? params.get("task") ?? "").toLowerCase();
  const fragment = hash.startsWith("#") ? hash.slice(1).toLowerCase() : hash.toLowerCase();
  return value === "incident" || fragment === "incident";
}

export class IncidentJob {
  step: IncidentStep = "skim";
  suspicion: number;
  skimIndex: number;
  route: string[] = [];
  result: IncidentResult | null = null;

  constructor(skimIndex: number) {
    this.skimIndex = Math.min(2, Math.max(0, Math.trunc(skimIndex)));
    this.suspicion = INCIDENT_START_SUSPICION[this.skimIndex];
  }

  get done() {
    return this.result !== null;
  }

  view(): IncidentView {
    const hops = this.step === "route" || this.step === "result" ? this.hopList() : [];
    if (this.step === "result" && this.result) {
      const cover = this.result === "cover";
      return {
        step: this.step,
        suspicion: this.suspicion,
        heading: cover ? "Cover story holds." : "The sleuths posted a thread.",
        body: cover
          ? "Liquidity Lounge has accepted the official statement. OnChainOlive typed “interesting,” then deleted it. The bag is yours. Do not check the hops."
          : "OnChainOlive posted a twelve-hop thread. Every hop ends at a wallet labeled definitely_not_me. The lounge wants a refund and a new intern.",
        disclaimer: INCIDENT_DISCLAIMER,
        options: [],
        hops,
        result: this.result,
        status: cover
          ? "THE INCIDENT HAS BEEN CONTAINED. MOSTLY IN YOUR POCKET."
          : "THE COVER IS GLASS. WALK IT OFF.",
        action: cover ? "Pocket the bag" : "Walk it off",
      };
    }
    if (this.step === "skim") {
      const copy = SKIM_COPY[this.skimIndex];
      return {
        step: this.step,
        suspicion: this.suspicion,
        heading: copy.heading,
        body: copy.body,
        disclaimer: INCIDENT_DISCLAIMER,
        options: [
          {
            id: "skim",
            label: "Move funds to Founder Wallet (unrelated)",
            detail: "No real wallet opens. This pile of fictional money just changes pockets.",
          },
        ],
        hops,
        result: null,
        status: "The treasury is looking temptingly liquid.",
        action: "Safest move",
      };
    }
    if (this.step === "tweet") {
      return {
        step: this.step,
        suspicion: this.suspicion,
        heading: "Post the incident thread",
        body: "Draft a statement from the in-game desk @TreasuryDesk. This stays in the game. It is not a real post and does not open a real account.",
        disclaimer: INCIDENT_DISCLAIMER,
        options: TWEETS.map(({ id, label, detail }) => ({ id, label, detail })),
        hops,
        result: null,
        status: "The timeline is already writing your story for you.",
        action: "Safest move",
      };
    }
    if (this.step === "route") {
      return {
        step: this.step,
        suspicion: this.suspicion,
        heading: "Route the bag",
        body: "Tap the next hop. Foggy Pond, then Mistport Relay, then the cold wallet we definitely don't control. A direct wire looks sloppy. So does a wallet named definitely_not_me.",
        disclaimer: INCIDENT_DISCLAIMER,
        options: [],
        hops,
        result: null,
        status: "The hops are fictional. The suspicion is not.",
        action: "Safest move",
      };
    }
    if (this.step === "discord") {
      return {
        step: this.step,
        suspicion: this.suspicion,
        heading: "Face Liquidity Lounge",
        body: "@where_is_my_bag and @rugwatcher_88 are already posting charts. Pick a reply for the in-game lounge. It is not a real Discord.",
        disclaimer: INCIDENT_DISCLAIMER,
        options: DISCORD.map(({ id, label, detail }) => ({ id, label, detail })),
        hops,
        result: null,
        status: "The lounge would like a word.",
        action: "Safest move",
      };
    }
    return {
      step: "bounty",
      suspicion: this.suspicion,
      heading: "Someone has to claim the bounty",
      body: "The 10% whitehat bounty is live in the lounge. You can have a brand-new “unrelated” wallet grab it, or invoice yourself as @SafeHarbor_99.",
      disclaimer: INCIDENT_DISCLAIMER,
      options: BOUNTY.map(({ id, label, detail }) => ({ id, label, detail })),
      hops,
      result: null,
      status: "The safest thief is a slightly subtler thief.",
      action: "Safest move",
    };
  }

  choose(id: string) {
    if (this.result || !id) return false;
    if (this.step === "skim") {
      if (id !== "skim") return false;
      this.step = "tweet";
      return true;
    }
    if (this.step === "tweet") {
      const option = TWEETS.find((entry) => entry.id === id);
      if (!option) return false;
      this.bump(option.suspicion);
      this.step = "route";
      return true;
    }
    if (this.step === "route") return this.takeHop(id);
    if (this.step === "discord") {
      const option = DISCORD.find((entry) => entry.id === id);
      if (!option) return false;
      this.bump(option.suspicion);
      if (option.bounty) this.step = "bounty";
      else this.close();
      return true;
    }
    if (this.step === "bounty") {
      const option = BOUNTY.find((entry) => entry.id === id);
      if (!option) return false;
      this.bump(option.suspicion);
      this.close();
      return true;
    }
    return false;
  }

  assist() {
    if (this.result) return false;
    if (this.step === "skim") return this.choose("skim");
    if (this.step === "tweet") return this.choose("calm");
    if (this.step === "route") {
      const next = GOOD_ROUTE.find((id) => this.available().has(id));
      return next ? this.choose(next) : false;
    }
    if (this.step === "discord") return this.choose("patient");
    if (this.step === "bounty") return this.choose("cutout");
    return false;
  }

  private hopList(): IncidentHop[] {
    const available = this.available();
    const done = new Set(this.route);
    return (["pond", "mistport", "wire", "pocket", "cold"] as const).map((id) => ({
      id,
      label: HOP_LABELS[id],
      done: done.has(id),
      available: this.step === "route" && !this.result && available.has(id),
    }));
  }

  private available() {
    const next = new Set<string>();
    if (this.step !== "route" || this.result) return next;
    const last = this.route[this.route.length - 1];
    if (!last) {
      next.add("pond");
      next.add("wire");
    } else if (last === "pond") {
      next.add("mistport");
      next.add("pocket");
    } else if (last === "mistport" || last === "pocket") {
      next.add("cold");
    }
    return next;
  }

  private takeHop(id: string) {
    if (!this.available().has(id)) return false;
    this.route.push(id);
    if (id === "wire") this.bump(28);
    if (id === "pocket") this.bump(24);
    if (id === "wire" || id === "cold") this.step = "discord";
    return true;
  }

  private bump(delta: number) {
    this.suspicion = Math.min(100, Math.max(0, this.suspicion + delta));
  }

  private close() {
    this.result = this.suspicion >= INCIDENT_THRESHOLD ? "exposed" : "cover";
    this.step = "result";
  }
}
