// categorize.js — automatische categorie- en privé/zakelijk-inschatting.
// Pas de trefwoorden gerust aan; de eerste match wint.

// Trefwoorden → categorie (voor UITGAVEN). Alles in kleine letters.
const EXPENSE_RULES = [
  ["Boodschappen", ["albert heijn", "ah to go", "ah ", "jumbo", "lidl", "aldi", "plus ", "dirk", "spar", "ekoplaza", "picnic", "hoogvliet", "vomar", "coop", "supermarkt"]],
  ["Vervoer", ["ns ", "ns-", "ov-chipkaart", "ovpay", "shell", "bp ", "esso", "tango", "tinq", "q8", "anwb", "greenwheels", "uber", "bolt.eu", "gvb", "ret ", "htm", "connexxion", "parkeren", "q-park", "parkmobile", "yellowbrick"]],
  ["Abonnementen", ["netflix", "spotify", "disney", "videoland", "hbo", "ziggo", "kpn", "vodafone", "t-mobile", "odido", "youfone", "simyo", "apple.com/bill", "google storage", "icloud", "patreon"]],
  ["Wonen", ["vattenfall", "eneco", "essent", "greenchoice", "budget energie", "vesteda", "hypotheek", "huur", "waternet", "vitens", "dunea", "pwn", "brabant water", "gemeente", "waterschap", "vve"]],
  ["Zorg", ["apotheek", "huisarts", "tandarts", "fysio", "zilveren kruis", "cz ", "vgz", "menzis", "ziekenhuis", "ggz", "optiek", "hans anders", "specsavers"]],
  ["Verzekeringen", ["verzekering", "centraal beheer", "inshared", "fbto", "allianz", "nationale-nederlanden", "nn ", "aegon", "ohra", "ditzo", "univé", "interpolis", "anwb verzekeren"]],
  ["Vrije tijd", ["pathe", "kinepolis", "restaurant", "cafe", "café", "bar ", "thuisbezorgd", "uber eats", "deliveroo", "dominos", "mcdonald", "kfc", "starbucks", "basic-fit", "basic fit", "fitness", "sportschool", "bol.com", "coolblue", "zalando", "bioscoop"]],
];

// Trefwoorden → ZAKELIJKE categorie. Match hierop zet scope op 'zakelijk'.
const BUSINESS_RULES = [
  ["Software & tools", ["adobe", "figma", "vercel", "netlify", "github", "openai", "anthropic", "google workspace", "notion", "linear", "slack", "transip", "vimexx", "mijndomein", "namecheap", "aws", "amazon web services", "digitalocean", "hetzner", "cloudflare", "framer", "webflow"]],
  ["Belasting & BTW", ["belastingdienst", "btw", "omzetbelasting", "inkomstenbelasting"]],
  ["Uitbesteding", ["fiverr", "upwork", "freelancer"]],
  ["Marketing", ["google ads", "meta platforms", "facebook ", "linkedin ads", "mailchimp"]],
];

const INCOME_RULES = [
  ["Salaris", ["salaris", "loon", "salary", "periode-uitkering"]],
  ["Toeslagen", ["belastingdienst toeslagen", "huurtoeslag", "zorgtoeslag", "kinderopvangtoeslag", "kindgebonden"]],
];

function matchRules(text, rules) {
  for (const [cat, words] of rules) if (words.some((w) => text.includes(w))) return cat;
  return null;
}

// Geeft { category, scope } op basis van omschrijving en of het inkomst is.
export function guessCategory(description, isIncome) {
  const t = (description || "").toLowerCase();
  if (isIncome) {
    return { category: matchRules(t, INCOME_RULES) || "Overig", scope: "prive" };
  }
  const biz = matchRules(t, BUSINESS_RULES);
  if (biz) return { category: biz, scope: "zakelijk" };
  return { category: matchRules(t, EXPENSE_RULES) || "Overig", scope: "prive" };
}
