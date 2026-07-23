export type StaticBoardMember = {
  name: string;
  title: string;
  organization: string;
  biography: string;
};

export type StaticEndorsement = {
  attribution: string;
  title: string;
  organization: string;
  quote: string;
  featured: boolean;
};

// This versioned, text-only continuity snapshot is deliberately reviewed with
// the public rebuild. Strapi remains canonical during normal operation; these
// records only prevent a total blank state when Strapi is unavailable.
export const STATIC_BOARD_MEMBERS: readonly StaticBoardMember[] = [
  {
    name: "Bryant Wright",
    title: "Chairman",
    organization: "Right From the Heart Ministries / Send Relief",
    biography: "Founder, Right From the Heart Ministries; President, Send Relief; Past President, Southern Baptist Convention. Marietta, Georgia.",
  },
  {
    name: "David Pattillo",
    title: "Treasurer",
    organization: "Endava",
    biography: "Director, Endava. Atlanta, Georgia.",
  },
  {
    name: "Jan Donaldson",
    title: "Board member",
    organization: "",
    biography: "Atlanta, Georgia.",
  },
  {
    name: "David White",
    title: "Board member",
    organization: "",
    biography: "Douglasville, Georgia.",
  },
  {
    name: "Andrew Wood",
    title: "Head of School",
    organization: "St. Andrews School at Wears Valley Ranch",
    biography: "Head of School, St. Andrews School at Wears Valley Ranch. Maryville, Tennessee.",
  },
  {
    name: "Jim Wood",
    title: "Founder",
    organization: "Wears Valley Ranch",
    biography: "Founder, Wears Valley Ranch. Wears Valley, Tennessee.",
  },
  {
    name: "James Wellman",
    title: "Emeritus",
    organization: "",
    biography: "Atlanta, Georgia.",
  },
] as const;

export const STATIC_ENDORSEMENTS: readonly StaticEndorsement[] = [
  {
    attribution: "Franklin Graham",
    title: "President and CEO",
    organization: "Samaritan's Purse / Billy Graham Evangelistic Association",
    quote: "Christ in us is what gives us power to live in the world without compromise. I hope you'll read Three Questions. You'll be glad you did.",
    featured: true,
  },
  {
    attribution: "Dr. Voddie Baucham, Jr.",
    title: "",
    organization: "Voddie Baucham Ministries",
    quote: "If you are a fan of Jim Wood's radio program, you'll love Three Questions. With his usual insightful, biblical, accessible style, Jim takes the reader on a journey through three age-old questions that have eternal significance.",
    featured: true,
  },
  {
    attribution: "Bryant Wright",
    title: "President",
    organization: "Send Relief / Right From the Heart Ministries",
    quote: "When I'm reading a book on the Christian life, I'm often wondering, 'Does this guy really live what he says?' I assure you, when it comes to prayer, Jim Wood practices what he preaches.",
    featured: true,
  },
  {
    attribution: "Randy Davis",
    title: "President and Executive Director",
    organization: "Tennessee Baptist Mission Board",
    quote: "Jim Wood is one of the most effective communicators I have heard in the last 25 years. He is solidly anchored to the word of God in the principles and precepts he teaches.",
    featured: true,
  },
  {
    attribution: "Scott Sauls",
    title: "Senior Pastor",
    organization: "Christ Presbyterian Church, Nashville",
    quote: "Jim Wood is a dynamic communicator that loves deeply the call of James 1:27, to care for widows and orphans in their distress.",
    featured: false,
  },
  {
    attribution: "Mary Beth Chapman",
    title: "President",
    organization: "Show Hope",
    quote: "When I heard Jim speak and spent time with him listening to his story, I was reminded again that God is woven into every fabric of our story, be it one of joy or pain.",
    featured: false,
  },
  {
    attribution: "Dr. Billy and Ruth Graham",
    title: "",
    organization: "Billy Graham Evangelistic Association",
    quote: "Wears Valley Ranch has helped to meet a desperate situation, and the caring couple, Jim and Susan Wood, bring normalcy, love and joy into many devastated young lives.",
    featured: false,
  },
  {
    attribution: "Dr. Charles Swindoll",
    title: "Pastor",
    organization: "Living Ministries, Dallas Theological Seminary, and Stonebriar Community Church",
    quote: "Wears Valley Ranch is a noble ministry, nestled in one of the most beautiful and serene settings in the State of Tennessee.",
    featured: false,
  },
] as const;
